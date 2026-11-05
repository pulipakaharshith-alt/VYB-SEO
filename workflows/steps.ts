/**
 * Durable steps of one SEO run. Each "use step" function runs as its own short invocation,
 * is retried on transient errors, and passes only small serializable values. Files are
 * committed to the run's working branch as each step finishes, so nothing large lives in
 * workflow state and a crash loses at most one step.
 */
import { FatalError } from 'workflow';
import type { Usage } from '@/lib/ai';
import { auditPosts, fixPosts, summarize } from '@/lib/audit';
import {
  loadContext,
  loadQueue,
  loadState,
  pendingByPriority,
  PATHS,
  postFile,
  postPath,
  postUrl,
  type AgentState,
  type QueueItem,
} from '@/lib/config';
import { buildPostFile, closestPost, loadPosts, parsePost, relatedPosts, splitRaw, validatePostFile, type PostInfo } from '@/lib/content';
import { env } from '@/lib/env';
import { agentPulls, changedOnBranch, commitFiles, createBranch, deleteBranch, mergeAndDelete, openPull, pullFiles, readFile } from '@/lib/github';
import { linkChecker, sitemapPaths } from '@/lib/links';
import { research } from '@/lib/research';
import { isLive, pingGoogle, pingIndexNow, searchConsole, type GscData } from '@/lib/search';
import { addLink, draftArticle, newArticlePrompt, refreshPrompt, rewriteMeta, serpBrief } from '@/lib/writer';

const usd = (u: Usage[]) => u.reduce((s, x) => s + x.usd, 0);
const today = () => new Date().toISOString().slice(0, 10);
const recent = (map: Record<string, string>, slug: string, days: number) =>
  Boolean(map[slug]) && (Date.now() - new Date(map[slug]).getTime()) / 864e5 < days;

export interface RunInput {
  trigger: 'cron' | 'manual';
  newArticles?: number;
  refreshes?: number;
  metaRewrites?: number;
}

export interface Plan {
  runId: string;
  date: string;
  branch: string;
  mode: 'pr' | 'direct';
  maxSpendUsd: number;
  index: PostInfo[];
  sitemap: string[];
  refresh: { slug: string; reason: string; queries: { query: string; impressions: number; position: number }[] }[];
  metas: { slug: string; impressions: number; ctr: number; position: number; queries: string[] }[];
  writes: QueueItem[];
  ping: { pulls: number[]; urls: string[] };
  summary: {
    paced: string | null;
    issuesBefore: { code: string; severity: string; count: number }[];
    fixed: Record<string, number>;
    fixedFiles: number;
    researched: { keyword: string; title: string; priority?: number; why?: string }[];
    gsc: GscData['totals'] | null;
    gscRange: GscData['range'] | null;
  };
  usd: number;
}

export interface StepResult {
  kind: 'new' | 'refresh' | 'meta';
  slug: string;
  ok: boolean;
  title?: string;
  detail?: string;
  words?: number;
  warnings?: string[];
  errors?: string[];
  linkedFrom?: string[];
  post?: PostInfo;
  usd: number;
}

async function saveBookkeeping(files: { queue?: QueueItem[]; state?: AgentState; extra?: Record<string, string> }, message: string) {
  const out: Record<string, string> = { ...(files.extra ?? {}) };
  if (files.queue) out[PATHS.queue] = JSON.stringify(files.queue, null, 2) + '\n';
  if (files.state) out[PATHS.state] = JSON.stringify(files.state, null, 2) + '\n';
  await commitFiles(out, message);
}

// ── 1. Prepare: audit, fix, Search Console, research, choose today's work ─────────

export async function prepareRun(input: RunInput & { runId: string }): Promise<Plan> {
  'use step';
  const ctx = await loadContext();
  if (!ctx.configured) throw new FatalError('No .seo-agent/config.json in the content repo yet. Open the dashboard → Settings and save once.');
  const { config } = ctx;
  const [queue, state] = await Promise.all([loadQueue(), loadState()]);
  const date = today();
  const branch = `seo-agent/${date}-${input.runId.slice(-8).toLowerCase()}`;
  await createBranch(branch);

  // Pull requests from earlier runs: merged → ping search engines; closed unmerged → re-open the item.
  const pulls = await agentPulls('closed').catch(() => []);
  const ping = { pulls: [] as number[], urls: [] as string[] };
  for (const pr of pulls) {
    if (state.pingedPulls.includes(pr.number)) continue;
    if (pr.mergedAt) {
      const files = await pullFiles(pr.number).catch(() => []);
      const dir = config.contentDir.replace(/\/$/, '') + '/';
      ping.urls.push(...files.filter((f) => f.startsWith(dir) && /\.mdx?$/.test(f)).map((f) => postUrl(config, f.slice(dir.length).replace(/\.mdx?$/, ''))));
      ping.pulls.push(pr.number);
    } else {
      for (const item of queue) if (item.note?.includes(`#${pr.number}`) && item.status === 'done') Object.assign(item, { status: 'skipped', note: `PR #${pr.number} closed without merging` });
      state.pingedPulls.push(pr.number);
    }
  }
  // Items left "writing" by a run that died: put them back.
  for (const item of queue) if (item.status === 'writing') item.status = 'pending';

  const { posts, raw } = await loadPosts(config, branch);
  const sitemap = await sitemapPaths(config.site);
  const check = linkChecker(config, posts, sitemap);
  const issuesBefore = summarize(auditPosts(config, posts, check));

  const fixes = fixPosts(config, posts, raw);
  await commitFiles(fixes.files, `SEO agent: mechanical fixes (${Object.keys(fixes.files).length} files)`, branch);
  const index = Object.keys(fixes.files).length ? posts.map((p) => (fixes.files[p.file] ? parsePost(config, p.file, fixes.files[p.file]) : p)) : posts;

  const prefix = config.urlPattern.split('{slug}')[0];
  const slugOf = (url: string) => {
    try {
      const path = new URL(url).pathname;
      if (!path.startsWith(prefix)) return null;
      const slug = path.slice(prefix.length).replace(/\/$/, '');
      return slug && !slug.includes('/') ? slug : null;
    } catch {
      return null;
    }
  };
  let gsc: GscData | null = null;
  try {
    gsc = await searchConsole(config.site, slugOf);
  } catch (e) {
    console.warn('Search Console unavailable:', (e as Error).message);
  }

  let researchUsd = 0;
  let researched: QueueItem[] = [];
  if (config.run.research) {
    try {
      const r = await research(ctx, index, queue, gsc);
      researched = r.added;
      researchUsd = usd(r.usage);
      queue.push(...r.added);
    } catch (e) {
      console.warn('research failed:', (e as Error).message);
    }
  }

  const n = {
    write: input.newArticles ?? config.run.newArticles,
    refresh: input.refreshes ?? config.run.refreshes,
    meta: input.metaRewrites ?? config.run.metaRewrites,
  };
  const slugs = new Set(index.map((p) => p.slug));
  // Never rewrite the pages that already earn the most clicks: the downside outweighs the upside.
  const protectedPages = new Set(gsc?.topPages.slice(0, config.safety.protectTopPages) ?? []);
  const okRefresh = (s: string | null): s is string =>
    Boolean(s && slugs.has(s) && !protectedPages.has(s) && !recent(state.refreshed, s, 75));

  let refresh: Plan['refresh'] = [];
  if (gsc) {
    const score = new Map<string, number>();
    const why = new Map<string, string>();
    for (const s of gsc.striking) {
      if (!okRefresh(s.slug)) continue;
      score.set(s.slug, (score.get(s.slug) ?? 0) + (s.impressions * (21 - s.position)) / 16);
      if (!why.has(s.slug)) why.set(s.slug, `"${s.query}" at #${s.position.toFixed(0)}`);
    }
    for (const d of gsc.decaying) {
      if (!okRefresh(d.slug)) continue;
      score.set(d.slug, (score.get(d.slug) ?? 0) + (d.prevClicks - d.clicks) * 20);
      why.set(d.slug, `clicks down ${d.prevClicks} → ${d.clicks}`);
    }
    refresh = [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n.refresh)
      .map(([slug]) => ({ slug, reason: why.get(slug)!, queries: gsc!.striking.filter((x) => x.slug === slug).slice(0, 15).map(({ query, impressions, position }) => ({ query, impressions, position })) }));
  } else {
    refresh = index
      .filter((p) => okRefresh(p.slug) && p.updated)
      .sort((a, b) => new Date(a.updated).getTime() - new Date(b.updated).getTime())
      .slice(0, n.refresh)
      .map((p) => ({ slug: p.slug, reason: `oldest content (updated ${p.updated}); no Search Console data`, queries: [] }));
  }

  const metas: Plan['metas'] = (gsc?.lowCtr ?? [])
    .filter((p) => slugs.has(p.slug) && !recent(state.meta, p.slug, 45) && !refresh.some((r) => r.slug === p.slug))
    .slice(0, n.meta)
    .map((p) => ({ ...p, queries: gsc!.striking.filter((s) => s.slug === p.slug).slice(0, 8).map((s) => s.query) }));

  // Publishing pace cap: new articles in the last 7 days (including ones waiting in open PRs).
  const weekAgo = Date.now() - 7 * 864e5;
  const recentNew = queue.filter((k) => k.status === 'done' && k.doneAt && new Date(k.doneAt).getTime() > weekAgo).length;
  const allowed = Math.max(0, Math.min(n.write, config.safety.maxNewPerWeek - recentNew));
  const writes: QueueItem[] = [];
  for (const item of pendingByPriority(queue)) {
    if (writes.length >= allowed) break;
    const close = closestPost(item.keyword, index);
    if (slugs.has(item.slug) || close.score >= config.qa.cannibalizationThreshold) {
      Object.assign(item, { status: 'skipped', note: `covered by ${close.post?.slug ?? item.slug}` });
      continue;
    }
    item.status = 'writing';
    writes.push({ ...item });
  }

  await saveBookkeeping({ queue, state }, `SEO agent: plan run ${date}`);

  return {
    runId: input.runId,
    date,
    branch,
    mode: config.publish.mode,
    maxSpendUsd: env.maxSpendUsd ?? config.run.maxSpendUsd,
    index,
    sitemap,
    refresh,
    metas,
    writes,
    ping,
    summary: {
      paced: allowed < n.write ? `new articles limited to ${allowed} (safety.maxNewPerWeek = ${config.safety.maxNewPerWeek}, ${recentNew} in the last 7 days)` : null,
      issuesBefore,
      fixed: fixes.counts,
      fixedFiles: Object.keys(fixes.files).length,
      researched: researched.map(({ keyword, title, priority, why }) => ({ keyword, title, priority, why })),
      gsc: gsc?.totals ?? null,
      gscRange: gsc?.range ?? null,
    },
    usd: researchUsd,
  };
}

// ── 2. Content steps ───────────────────────────────────────────────────────────

export async function writeArticle(a: { branch: string; item: QueueItem; index: PostInfo[]; sitemap: string[] }): Promise<StepResult> {
  'use step';
  const ctx = await loadContext();
  const { config } = ctx;
  const usage: Usage[] = [];
  try {
    const { brief, usage: u1 } = await serpBrief(a.item.keyword);
    usage.push(u1);
    const check = linkChecker(config, a.index, a.sitemap, [a.item.slug]);
    const { draft, qa, usage: u2 } = await draftArticle(ctx, {
      step: 'write',
      prompt: newArticlePrompt(ctx, a.item, brief, a.index),
      keyword: a.item.keyword,
      checkLink: check,
      otherTitles: a.index.flatMap((p) => [p.title, p.metaTitle]),
    });
    usage.push(...u2);
    if (qa.errors.length) return { kind: 'new', slug: a.item.slug, ok: false, errors: qa.errors, usd: usd(usage) };
    const file = postFile(config, a.item.slug);
    const text = buildPostFile(config, {
      slug: a.item.slug,
      title: draft.title,
      metaTitle: draft.metaTitle,
      description: draft.metaDescription,
      excerpt: draft.excerpt,
      body: draft.body,
      keyword: a.item.keyword,
      published: today(),
      updated: today(),
    });
    const invalid = validatePostFile(config, file, text);
    if (invalid.length) return { kind: 'new', slug: a.item.slug, ok: false, errors: invalid, usd: usd(usage) };
    await commitFiles({ [file]: text }, `SEO agent: new article "${draft.title}"`, a.branch);
    return { kind: 'new', slug: a.item.slug, ok: true, title: draft.title, detail: a.item.keyword, words: qa.words, warnings: qa.warnings, post: parsePost(config, file, text), usd: usd(usage) };
  } catch (e) {
    if (FatalError.is(e)) throw e;
    return { kind: 'new', slug: a.item.slug, ok: false, errors: [(e as Error).message], usd: usd(usage) };
  }
}
writeArticle.maxRetries = 1;

export async function refreshArticle(a: { branch: string; target: Plan['refresh'][number]; index: PostInfo[]; sitemap: string[] }): Promise<StepResult> {
  'use step';
  const ctx = await loadContext();
  const { config } = ctx;
  const post = a.index.find((p) => p.slug === a.target.slug);
  const usage: Usage[] = [];
  try {
    const raw = post && (await readFile(post.file, a.branch));
    if (!post || !raw) return { kind: 'refresh', slug: a.target.slug, ok: false, errors: ['post not found'], usd: 0 };
    const { body } = splitRaw(raw);
    const kw = post.keyword || post.title;
    const extra = a.target.queries.length ? `Also look at: ${a.target.queries.slice(0, 3).map((q) => `"${q.query}"`).join(', ')}.` : '';
    const { brief, usage: u1 } = await serpBrief(kw, extra);
    usage.push(u1);
    const { draft, qa, usage: u2 } = await draftArticle(ctx, {
      step: 'refresh',
      prompt: refreshPrompt(ctx, post, body, brief, a.index, a.target.queries),
      keyword: kw,
      checkLink: linkChecker(config, a.index, a.sitemap),
      otherTitles: a.index.filter((p) => p.slug !== post.slug).flatMap((p) => [p.title, p.metaTitle]),
      originalWords: post.words,
    });
    usage.push(...u2);
    if (qa.errors.length) return { kind: 'refresh', slug: post.slug, ok: false, errors: qa.errors, usd: usd(usage) };
    const text = buildPostFile(config, {
      slug: post.slug,
      title: draft.title,
      metaTitle: draft.metaTitle,
      description: draft.metaDescription,
      excerpt: draft.excerpt,
      body: draft.body,
      keyword: kw,
      published: post.published || today(),
      updated: today(),
    }, raw);
    const invalid = validatePostFile(config, post.file, text);
    if (invalid.length) return { kind: 'refresh', slug: post.slug, ok: false, errors: invalid, usd: usd(usage) };
    await commitFiles({ [post.file]: text }, `SEO agent: refresh "${draft.title}"`, a.branch);
    return { kind: 'refresh', slug: post.slug, ok: true, title: draft.title, detail: a.target.reason, words: qa.words, warnings: qa.warnings, usd: usd(usage) };
  } catch (e) {
    if (FatalError.is(e)) throw e;
    return { kind: 'refresh', slug: a.target.slug, ok: false, errors: [(e as Error).message], usd: usd(usage) };
  }
}
refreshArticle.maxRetries = 1;

export async function rewriteSnippet(a: { branch: string; page: Plan['metas'][number]; index: PostInfo[] }): Promise<StepResult> {
  'use step';
  const ctx = await loadContext();
  const post = a.index.find((p) => p.slug === a.page.slug);
  const raw = post && (await readFile(post.file, a.branch));
  if (!post || !raw) return { kind: 'meta', slug: a.page.slug, ok: false, errors: ['post not found'], usd: 0 };
  try {
    const r = await rewriteMeta(ctx, post, raw, a.page, a.page.queries);
    if (!r.file) return { kind: 'meta', slug: post.slug, ok: false, errors: [r.why], usd: r.usage.usd };
    await commitFiles({ [post.file]: r.file }, `SEO agent: new title/description for ${post.slug}`, a.branch);
    return {
      kind: 'meta',
      slug: post.slug,
      ok: true,
      title: r.after,
      detail: `#${a.page.position.toFixed(1)}, ${a.page.impressions} impressions, ${(a.page.ctr * 100).toFixed(1)}% CTR. "${r.before}" → "${r.after}". ${r.why}`,
      usd: r.usage.usd,
    };
  } catch (e) {
    return { kind: 'meta', slug: a.page.slug, ok: false, errors: [(e as Error).message], usd: 0 };
  }
}
rewriteSnippet.maxRetries = 1;

/** Link the new article from its most related existing posts. */
export async function interlinkArticle(a: { branch: string; target: PostInfo; index: PostInfo[] }): Promise<{ linkedFrom: string[]; usd: number }> {
  'use step';
  const { config } = await loadContext();
  const href = postPath(config, a.target.slug);
  const sources = relatedPosts(`${a.target.keyword} ${a.target.title}`, a.index, [a.target.slug], 10)
    .filter((p) => !p.links.includes(href))
    .slice(0, 3);
  const files: Record<string, string> = {};
  const usage: Usage[] = [];
  for (const src of sources) {
    try {
      const raw = await readFile(src.file, a.branch);
      if (!raw) continue;
      const r = await addLink(raw, a.target.title, href);
      if (r.usage) usage.push(r.usage);
      if (r.file) files[src.file] = r.file;
    } catch (e) {
      console.warn(`interlink ${src.slug}:`, (e as Error).message);
    }
  }
  await commitFiles(files, `SEO agent: link to ${a.target.slug} from related posts`, a.branch);
  return { linkedFrom: Object.keys(files).map((f) => f.split('/').pop()!.replace(/\.mdx?$/, '')), usd: usd(usage) };
}
interlinkArticle.maxRetries = 1;

// ── 3. Finish: report, open the PR (or merge), update the queue and state ────────

export async function finishRun(a: { plan: Omit<Plan, 'index' | 'sitemap'>; results: StepResult[]; usd: number; stopped: string | null }): Promise<{ prUrl?: string; directUrls: string[]; report: string }> {
  'use step';
  const ctx = await loadContext();
  const { config } = ctx;
  const { plan, results } = a;
  const changed = await changedOnBranch(plan.branch);

  const { posts } = await loadPosts(config, changed.length ? plan.branch : undefined);
  const after = summarize(auditPosts(config, posts, linkChecker(config, posts, await sitemapPaths(config.site))));
  const count = (s: typeof after, sev: string) => s.filter((x) => x.severity === sev).reduce((n, x) => n + x.count, 0);

  const news = results.filter((r) => r.kind === 'new' && r.ok);
  const refs = results.filter((r) => r.kind === 'refresh' && r.ok);
  const metas = results.filter((r) => r.kind === 'meta' && r.ok);
  const fails = results.filter((r) => !r.ok);
  const L: string[] = [`# SEO agent run, ${plan.date}`, ''];
  L.push(`**${news.length} new · ${refs.length} refreshed · ${metas.length} snippet rewrites · ${plan.summary.fixedFiles} files auto-fixed** · AI spend ≈ $${a.usd.toFixed(2)}`, '');
  if (a.stopped) L.push(`> ⚠️ Stopped early: ${a.stopped}`, '');
  if (plan.summary.paced) L.push(`> ℹ️ Pace limit: ${plan.summary.paced}`, '');
  if (plan.summary.gsc) {
    const t = plan.summary.gsc;
    const delta = t.prevClicks ? `${(((t.clicks - t.prevClicks) / t.prevClicks) * 100).toFixed(0)}%` : 'n/a';
    L.push('## Search Console (28 days)', '', `Clicks **${t.clicks}** (${delta} vs prior 28 days) · Impressions **${t.impressions}**`, '');
  } else L.push('_No Search Console data. Add GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY to rank by opportunity._', '');
  const link = (slug: string) => postUrl(config, slug);
  if (news.length) {
    L.push('## New articles', '');
    for (const r of news) L.push(`- [${r.title}](${link(r.slug)}): "${r.detail}", ${r.words} words${r.linkedFrom?.length ? `, linked from ${r.linkedFrom.join(', ')}` : ''}${r.warnings?.length ? `. ⚠️ ${r.warnings.join('; ')}` : ''}`);
    L.push('');
  }
  if (refs.length) {
    L.push('## Refreshed', '');
    for (const r of refs) L.push(`- [${r.title}](${link(r.slug)}): ${r.detail}, now ${r.words} words${r.warnings?.length ? `. ⚠️ ${r.warnings.join('; ')}` : ''}`);
    L.push('');
  }
  if (metas.length) {
    L.push('## Snippet rewrites (low click-through)', '');
    for (const r of metas) L.push(`- ${r.slug}: ${r.detail}`);
    L.push('');
  }
  if (plan.summary.fixedFiles) L.push('## Auto-fixes', '', `${JSON.stringify(plan.summary.fixed)} across ${plan.summary.fixedFiles} files`, '');
  if (fails.length) {
    L.push('## Not published', '');
    for (const r of fails) L.push(`- ${r.kind} ${r.slug}: ${r.errors?.join('; ')}`);
    L.push('');
  }
  if (plan.summary.researched.length) {
    L.push('## Newly queued keywords', '');
    for (const k of plan.summary.researched) L.push(`- [${k.priority}] **${k.keyword}**: ${k.title}${k.why ? ` _(${k.why})_` : ''}`);
    L.push('');
  }
  L.push('## Before you merge', '', '- Read each new or refreshed article: facts, tone, advice.', '- Check every external link opens and is reputable.', '- Open the preview deployment and confirm the posts render.', '- Anything wrong? Edit it in this PR, or close the PR to discard the run.', '');
  L.push('## Content health', '', '| | before | after |', '|---|---|---|');
  L.push(`| errors | ${count(plan.summary.issuesBefore, 'error')} | ${count(after, 'error')} |`, `| warnings | ${count(plan.summary.issuesBefore, 'warn')} | ${count(after, 'warn')} |`, '');
  const report = L.join('\n');

  let prUrl: string | undefined;
  let prNumber: number | undefined;
  const directUrls: string[] = [];
  const title = `SEO agent ${plan.date}: ${news.length} new, ${refs.length} refreshed, ${metas.length} snippets`;
  if (!changed.length) {
    await deleteBranch(plan.branch);
  } else if (plan.mode === 'pr') {
    const pr = await openPull(plan.branch, title, `${report}\n---\nMerge to publish. The next run pings search engines once these URLs are live.`);
    prUrl = pr.url;
    prNumber = pr.number;
  } else {
    await mergeAndDelete(plan.branch, title);
    const dir = config.contentDir.replace(/\/$/, '') + '/';
    directUrls.push(...changed.filter((f) => f.startsWith(dir)).map((f) => postUrl(config, f.slice(dir.length).replace(/\.mdx?$/, ''))));
  }

  const [queue, state] = await Promise.all([loadQueue(), loadState()]);
  for (const r of results.filter((x) => x.kind === 'new')) {
    const item = queue.find((k) => k.slug === r.slug);
    if (!item) continue;
    if (r.ok) Object.assign(item, { status: 'done', doneAt: new Date().toISOString(), note: prNumber ? `PR #${prNumber}` : 'published' });
    else Object.assign(item, { status: 'failed', note: r.errors?.join('; ').slice(0, 300) });
  }
  for (const item of queue) if (item.status === 'writing') item.status = 'pending';
  for (const r of refs) state.refreshed[r.slug] = plan.date;
  for (const r of metas) state.meta[r.slug] = plan.date;
  state.runs = [{ id: plan.runId, date: plan.date, summary: title, usd: Number(a.usd.toFixed(2)), pr: prUrl }, ...state.runs].slice(0, 100);
  await saveBookkeeping({ queue, state, extra: { [PATHS.report(plan.date)]: report } }, `SEO agent: report ${plan.date}`);
  return { prUrl, directUrls, report };
}

/** Ping search engines for URLs once they're live, and remember which PRs are done. */
export async function pingLive(a: { site: string; urls: string[]; pulls: number[] }): Promise<string[]> {
  'use step';
  const live: string[] = [];
  for (const u of a.urls) if (await isLive(u)) live.push(u);
  const out = [await pingIndexNow(a.site, live), await pingGoogle(live)];
  if (a.pulls.length) {
    const state = await loadState();
    state.pingedPulls = [...new Set([...state.pingedPulls, ...a.pulls])].slice(-500);
    await saveBookkeeping({ state }, 'SEO agent: record pinged PRs');
  }
  return out;
}
