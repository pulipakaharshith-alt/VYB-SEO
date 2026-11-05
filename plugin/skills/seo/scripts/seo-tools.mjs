#!/usr/bin/env node
/**
 * VYB-SEO tools for Claude Code. Dependency-free (Node 18+). Run from the website repo root.
 * Shares .seo-agent/ (config, brand, queue, state, reports) with the Vercel app.
 *
 *   node seo-tools.mjs context                 settings, pace allowance, queue, existing posts
 *   node seo-tools.mjs audit [--live]          content audit (+ crawl the live sitemap)
 *   node seo-tools.mjs fix [--write]           mechanical fixes (dry run unless --write)
 *   node seo-tools.mjs research                Autocomplete candidates not already covered
 *   node seo-tools.mjs links "<keyword>"       pages an article may link to
 *   node seo-tools.mjs template <slug>         frontmatter skeleton for a new post
 *   node seo-tools.mjs check <file> [--refresh-of <words>]   quality gate (exit 1 on errors)
 *   node seo-tools.mjs queue-add "<keyword>" "<title>" [priority]
 *   node seo-tools.mjs record new|refresh|skip <slug> [note]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIR = path.join(ROOT, '.seo-agent');
const P = {
  config: path.join(DIR, 'config.json'),
  brand: path.join(DIR, 'brand.md'),
  queue: path.join(DIR, 'queue.json'),
  state: path.join(DIR, 'state.json'),
};

// Keep in sync with lib/config.ts DEFAULT_CONFIG.
const DEFAULTS = {
  site: 'https://example.com',
  contentDir: 'content/blog',
  extension: 'md',
  urlPattern: '/blog/{slug}',
  titleSuffix: '',
  templateRendersTitle: true,
  frontmatter: { title: 'title', description: 'description', metaTitle: '', excerpt: '', date: 'date', updated: 'updated', keyword: 'keyword', schema: '', extra: {} },
  productPages: [{ path: '/', about: 'Home page' }],
  linkRemaps: {},
  publish: { mode: 'pr' },
  safety: { maxNewPerWeek: 3, protectTopPages: 10, minRetainRatio: 0.7, claimsCheck: true, maxExternalLinks: 6 },
  run: { newArticles: 1, refreshes: 1, metaRewrites: 2, research: true, maxSpendUsd: 5 },
  qa: { minWords: 1200, maxWords: 4500, minInternalLinks: 3, metaTitleMax: 60, metaDescriptionMin: 110, metaDescriptionMax: 160, maxFillerPhrases: 2, staleDays: 240, cannibalizationThreshold: 0.6 },
  research: { hl: 'en', gl: 'us', seeds: [], modifiers: ['', 'how to', 'best', 'what is', 'for', 'vs', 'examples', 'free'], picksPerRun: 10 },
};

const FILLER = ["in today's", 'delve', 'game-changer', 'game changer', 'unlock', 'elevate your', 'navigate the world', 'navigating the world', "it's important to note", 'it is important to note', 'in conclusion', 'in the realm of', 'tapestry', 'look no further', "whether you're", 'whether you’re', 'embark on', 'supercharge', 'seamless'];

const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(2);
};
const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : fallback);
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
};
const today = () => new Date().toISOString().slice(0, 10);

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(base)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v) ? merge(b, v) : v;
  }
  return out;
}

function loadConfig() {
  if (!fs.existsSync(P.config)) die('.seo-agent/config.json not found. Run setup first (see SETUP.md), from the website repo root.');
  const c = merge(DEFAULTS, readJson(P.config, {}));
  c.site = c.site.replace(/\/$/, '');
  return c;
}

// ── Minimal YAML frontmatter reader (top-level scalars; enough to read posts) ──

function splitRaw(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : { fm: null, body: raw };
}

function parseFrontmatter(fm) {
  const data = {};
  const lines = fm.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (!m) continue;
    let [, key, v] = m;
    v = v.trim();
    if (/^[>|][-+]?$/.test(v)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i].trim());
      data[key] = v.startsWith('>') ? block.join(' ').trim() : block.join('\n').trim();
      continue;
    }
    if (v === '') {
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) i++; // nested list/map: skip
      data[key] = '';
      continue;
    }
    if (/^".*"$/.test(v)) {
      try {
        v = JSON.parse(v);
      } catch {
        v = v.slice(1, -1);
      }
    } else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    data[key] = v;
  }
  return data;
}

function countWords(md) {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#>*_`|-]/g, ' ').split(/\s+/).filter(Boolean).length;
}

function internalLinks(md, site) {
  const host = site.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const abs = new RegExp(`^https?://(www\\.)?${host.replace(/\./g, '\\.')}`, 'i');
  const out = [];
  for (const m of md.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = m[1];
    let p = null;
    if (href.startsWith('/') && !href.startsWith('//')) p = href;
    else if (abs.test(href)) p = href.replace(abs, '') || '/';
    if (p) out.push({ href, path: p.split(/[?#]/)[0].replace(/(.)\/$/, '$1') });
  }
  return out;
}

function faqCount(body) {
  const sec = body.match(/^##\s+(?:FAQ|FAQs|Frequently Asked Questions)[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  return sec ? sec[1].split(/^###\s+/m).slice(1).filter((x) => x.trim().split('\n').slice(1).join('').trim()).length : 0;
}

function loadPosts(c) {
  const dir = path.join(ROOT, c.contentDir);
  if (!fs.existsSync(dir)) return [];
  const f = c.frontmatter;
  return fs
    .readdirSync(dir)
    .filter((n) => /\.(md|mdx)$/.test(n))
    .map((n) => {
      const raw = fs.readFileSync(path.join(dir, n), 'utf-8');
      const { fm, body } = splitRaw(raw);
      const d = fm ? parseFrontmatter(fm) : {};
      const first = body.split('\n').find((l) => l.trim()) ?? '';
      return {
        slug: n.replace(/\.(md|mdx)$/, ''),
        file: path.join(c.contentDir, n),
        title: String(d[f.title] ?? ''),
        metaTitle: String((f.metaTitle && d[f.metaTitle]) || d[f.title] || ''),
        description: String(d[f.description] ?? ''),
        keyword: String((f.keyword && d[f.keyword]) || ''),
        published: String(d[f.date] ?? ''),
        updated: String((f.updated && d[f.updated]) || d[f.date] || ''),
        headings: [...body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim()),
        links: [...new Set(internalLinks(body, c.site).map((l) => l.path))],
        words: countWords(body),
        faq: faqCount(body),
        bodyH1: first.startsWith('# '),
        noFrontmatter: !fm,
        body,
        raw,
      };
    });
}

// ── Similarity ────────────────────────────────────────────────────────────────

const STOP = new Set('a an the to for of on in and or with your you my me i is are be do does how what why when who which that this it at by from vs best top guide tips ways examples ideas'.split(' '));
const stem = (w) => (w.length < 4 ? w : w.replace(/ies$/, 'y').replace(/([sxz]|ch|sh)es$/, '$1').replace(/([^su])s$/, '$1').replace(/(.{3,})ing$/, '$1'));
const tokens = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((w) => w && !STOP.has(w) && !/^20\d\d$/.test(w)).map(stem);
function jaccard(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / (A.size + B.size - n);
}
const closest = (kw, posts) => posts.reduce((best, p) => {
  const s = Math.max(jaccard(kw, p.keyword || p.title), jaccard(kw, p.slug.replace(/-/g, ' ')));
  return s > best.score ? { score: s, post: p } : best;
}, { score: 0, post: null });

function related(text, posts, exclude = [], limit = 15) {
  const docs = posts.filter((p) => !exclude.includes(p.slug)).map((p) => ({ p, t: tokens(`${p.title} ${p.keyword} ${p.keyword} ${p.headings.join(' ')}`) }));
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.t)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length + 1;
  const vec = (toks) => {
    const v = new Map();
    for (const t of toks) v.set(t, (v.get(t) ?? 0) + 1);
    for (const [t, n] of v) v.set(t, n * (1 + Math.log(N / (1 + (df.get(t) ?? 0)))));
    return v;
  };
  const cos = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (const [t, x] of a) { na += x * x; if (b.has(t)) dot += x * b.get(t); }
    for (const [, y] of b) nb += y * y;
    return dot && na && nb ? dot / Math.sqrt(na * nb) : 0;
  };
  const q = vec(tokens(text));
  return docs.map((d) => ({ p: d.p, s: cos(q, vec(d.t)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.p);
}

const postPath = (c, slug) => c.urlPattern.replace('{slug}', slug);

async function sitemapPaths(site) {
  const get = async (u) => {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      return r.ok ? await r.text() : '';
    } catch {
      return '';
    }
  };
  const locs = (x) => [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const root = await get(`${site}/sitemap.xml`);
  let urls = locs(root);
  if (/<sitemapindex/i.test(root)) urls = (await Promise.all(urls.slice(0, 20).map(get))).flatMap(locs);
  return urls.map((u) => {
    try {
      return new URL(u).pathname.replace(/(.)\/$/, '$1') || '/';
    } catch {
      return u;
    }
  });
}

async function linkChecker(c, posts, extraSlugs = []) {
  const known = new Set(await sitemapPaths(c.site));
  for (const p of posts) known.add(postPath(c, p.slug));
  for (const s of extraSlugs) known.add(postPath(c, s));
  for (const p of c.productPages) known.add(p.path.replace(/(.)\/$/, '$1'));
  known.add('/');
  return (p) => (c.linkRemaps[p] ? { status: 'remap', to: c.linkRemaps[p] } : known.has(p) ? { status: 'ok' } : { status: 'unknown' });
}

// ── Commands ──────────────────────────────────────────────────────────────────

function paceAllowance(c, queue) {
  const weekAgo = Date.now() - 7 * 864e5;
  const recent = queue.filter((k) => k.status === 'done' && k.doneAt && new Date(k.doneAt).getTime() > weekAgo).length;
  return { recent, allowed: Math.max(0, c.safety.maxNewPerWeek - recent), max: c.safety.maxNewPerWeek };
}

function cmdContext() {
  const c = loadConfig();
  const queue = readJson(P.queue, []);
  const state = readJson(P.state, { refreshed: {}, meta: {}, runs: [] });
  const posts = loadPosts(c);
  const pace = paceAllowance(c, queue);
  const pending = queue.filter((k) => k.status === 'pending').sort((a, b) => (b.priority ?? 40) - (a.priority ?? 40));
  const recentlyRefreshed = Object.entries(state.refreshed ?? {}).filter(([, d]) => (Date.now() - new Date(d).getTime()) / 864e5 < 75).map(([s]) => s);
  const refreshCandidates = posts
    .filter((p) => !recentlyRefreshed.includes(p.slug) && p.updated)
    .sort((a, b) => new Date(a.updated) - new Date(b.updated))
    .slice(0, 5)
    .map((p) => `${p.slug} (updated ${p.updated}, ${p.words} words)`);
  console.log(JSON.stringify({
    site: c.site,
    contentDir: c.contentDir,
    urlPattern: c.urlPattern,
    publishMode: c.publish.mode,
    pace: { ...pace, note: `You may publish at most ${pace.allowed} new article(s) this run (safety.maxNewPerWeek = ${pace.max}).` },
    perRun: c.run,
    safety: c.safety,
    brandNotes: fs.existsSync(P.brand) ? '.seo-agent/brand.md' : 'MISSING: create .seo-agent/brand.md before writing anything',
    queueNext: pending.slice(0, 8).map((k) => ({ slug: k.slug, keyword: k.keyword, title: k.title, priority: k.priority })),
    refreshCandidates,
    doNotRefresh: recentlyRefreshed,
    posts: posts.map((p) => `${p.slug} | ${p.title} | ${p.keyword}`),
  }, null, 2));
}

async function cmdAudit(live) {
  const c = loadConfig();
  const posts = loadPosts(c);
  const check = await linkChecker(c, posts);
  const issues = [];
  const add = (slug, sev, code, detail) => issues.push({ slug, sev, code, detail });
  const inbound = new Map(posts.map((p) => [p.slug, 0]));
  const bySlugPath = new Map(posts.map((p) => [postPath(c, p.slug), p.slug]));
  for (const p of posts) {
    if (p.noFrontmatter) add(p.slug, 'error', 'no-frontmatter', '');
    if (!p.title) add(p.slug, 'error', 'missing-title', '');
    if (!p.description) add(p.slug, 'error', 'missing-description', '');
    if (p.metaTitle.length + c.titleSuffix.length > 65) add(p.slug, 'warn', 'title-long', `${p.metaTitle.length + c.titleSuffix.length} chars with suffix`);
    if (c.templateRendersTitle && p.bodyH1) add(p.slug, 'error', 'duplicate-h1', 'body starts with an H1');
    if (p.words < 700) add(p.slug, 'warn', 'thin', `${p.words} words`);
    if (p.updated && (Date.now() - new Date(p.updated).getTime()) / 864e5 > c.qa.staleDays) add(p.slug, 'warn', 'stale', p.updated);
    if (!p.faq) add(p.slug, 'warn', 'no-faq', '');
    for (const l of p.links) {
      const r = check(l);
      if (r.status === 'remap') add(p.slug, 'error', 'remapped-link', `${l} → ${r.to}`);
      if (r.status === 'unknown') add(p.slug, 'error', 'broken-link', l);
      const t = bySlugPath.get(l);
      if (t && t !== p.slug) inbound.set(t, inbound.get(t) + 1);
    }
  }
  for (const [s, n] of inbound) if (!n) add(s, 'warn', 'orphan', 'no other post links here');
  for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++)
    if (posts[i].keyword && posts[j].keyword && jaccard(posts[i].keyword, posts[j].keyword) >= 0.8) add(posts[i].slug, 'warn', 'cannibalization', `same keyword as ${posts[j].slug}`);
  const summary = {};
  for (const i of issues) summary[`${i.sev}:${i.code}`] = (summary[`${i.sev}:${i.code}`] ?? 0) + 1;
  const out = { posts: posts.length, summary, issues: issues.slice(0, 300) };
  if (live) {
    const xml = await fetch(`${c.site}/sitemap.xml`).then((r) => r.text()).catch(() => '');
    const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]).slice(0, 200);
    const bad = [];
    for (const u of urls) {
      const r = await fetch(u, { redirect: 'manual' }).catch(() => null);
      if (!r || r.status !== 200) bad.push(`${u} → ${r?.status ?? 'failed'}`);
    }
    out.live = { checked: urls.length, notOk: bad };
  }
  console.log(JSON.stringify(out, null, 2));
}

async function cmdFix(write) {
  const c = loadConfig();
  const posts = loadPosts(c);
  const changed = [];
  for (const p of posts) {
    const { fm, body: b0 } = splitRaw(p.raw);
    if (fm == null) continue;
    let body = b0;
    for (const l of internalLinks(body, c.site)) {
      const to = c.linkRemaps[l.path];
      if (to) body = body.split(`](${l.href})`).join(`](${to}${l.href.match(/[?#].*$/)?.[0] ?? ''})`);
    }
    if (c.templateRendersTitle) {
      const lines = body.split('\n');
      const first = lines.findIndex((x) => x.trim());
      if (first >= 0 && lines[first].startsWith('# ')) lines.splice(first, 1);
      let inCode = false;
      body = lines.map((x) => {
        if (x.startsWith('```')) inCode = !inCode;
        return !inCode && /^# /.test(x) ? `#${x}` : x;
      }).join('\n');
    }
    if (body !== b0) {
      changed.push(p.file);
      if (write) fs.writeFileSync(path.join(ROOT, p.file), `---\n${fm}\n---\n\n${body.replace(/^\s+/, '')}`.replace(/\s*$/, '\n'));
    }
  }
  console.log(JSON.stringify({ wrote: write, files: changed }, null, 2));
}

async function cmdResearch() {
  const c = loadConfig();
  if (!c.research.seeds.length) die('research.seeds is empty in .seo-agent/config.json');
  const posts = loadPosts(c);
  const queue = readJson(P.queue, []);
  const known = [...posts.map((p) => p.keyword || p.title), ...queue.map((k) => k.keyword)];
  const found = new Map();
  for (const seed of c.research.seeds) {
    for (const mod of [...c.research.modifiers, '']) {
      const q = mod ? `${mod} ${seed}` : `${seed} `;
      try {
        const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=${c.research.hl}&gl=${c.research.gl}&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
        const j = JSON.parse(await r.text());
        for (const s of j[1] ?? []) if (!found.has(s)) found.set(s, seed);
      } catch {}
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  const fresh = [...found.entries()].filter(([q]) => q.split(' ').length >= 2 && !known.some((k) => jaccard(q, k) >= c.qa.cannibalizationThreshold));
  console.log(JSON.stringify({ candidates: fresh.slice(0, 300).map(([q, seed]) => `${q}  [${seed}]`), alreadyCovered: known.length }, null, 2));
}

function cmdLinks(keyword) {
  const c = loadConfig();
  const posts = loadPosts(c);
  console.log(['Product pages (link only to these, related posts, or pages in the sitemap):', ...c.productPages.map((p) => `- ${p.path} — ${p.about}`), '', 'Related posts:', ...related(keyword ?? '', posts).map((p) => `- ${postPath(c, p.slug)} — ${p.title}`)].join('\n'));
}

function cmdTemplate(slug) {
  if (!slug) die('usage: template <slug>');
  const c = loadConfig();
  const f = c.frontmatter;
  const lines = [`${f.title}: "…"`];
  if (f.metaTitle) lines.push(`${f.metaTitle}: "… (≤ ${c.qa.metaTitleMax - c.titleSuffix.length} chars)"`);
  lines.push(`${f.description}: "… (${c.qa.metaDescriptionMin}-${c.qa.metaDescriptionMax} chars)"`);
  if (f.excerpt) lines.push(`${f.excerpt}: "…"`);
  lines.push(`${f.date}: "${today()}"`);
  if (f.updated) lines.push(`${f.updated}: "${today()}"`);
  if (f.keyword) lines.push(`${f.keyword}: "…"`);
  for (const [k, v] of Object.entries(f.extra)) lines.push(`${k}: ${JSON.stringify(v)}`);
  console.log(`File: ${path.join(c.contentDir, `${slug}.${c.extension}`)}\n\n---\n${lines.join('\n')}\n---\n\n<intro paragraph that answers the query; ${c.templateRendersTitle ? 'no # H1, the template renders the title' : 'start with # Title'}>`);
}

async function cmdCheck(file, refreshOf) {
  if (!file || !fs.existsSync(file)) die(`file not found: ${file}`);
  const c = loadConfig();
  const posts = loadPosts(c);
  const slug = path.basename(file).replace(/\.(md|mdx)$/, '');
  const raw = fs.readFileSync(file, 'utf-8');
  const { fm, body } = splitRaw(raw);
  const errors = [];
  const warnings = [];
  if (fm == null) errors.push('no YAML frontmatter (--- … ---)');
  const d = fm ? parseFrontmatter(fm) : {};
  const f = c.frontmatter;
  const title = String(d[f.title] ?? '');
  const metaTitle = String((f.metaTitle && d[f.metaTitle]) || title);
  const desc = String(d[f.description] ?? '');
  if (!title) errors.push(`frontmatter "${f.title}" is empty`);
  if (!desc) errors.push(`frontmatter "${f.description}" is empty`);
  if (!d[f.date]) errors.push(`frontmatter "${f.date}" is empty`);
  for (const k of Object.keys(f.extra)) if (!(k in d)) errors.push(`frontmatter "${k}" missing (frontmatter.extra)`);
  const tl = metaTitle.length + c.titleSuffix.length;
  if (tl > c.qa.metaTitleMax + 5) errors.push(`title is ${tl} chars with the site suffix (max ${c.qa.metaTitleMax})`);
  else if (tl > c.qa.metaTitleMax) warnings.push(`title is ${tl} chars with suffix`);
  if (desc.length > c.qa.metaDescriptionMax + 10 || desc.length < c.qa.metaDescriptionMin - 20) errors.push(`description is ${desc.length} chars (want ${c.qa.metaDescriptionMin}-${c.qa.metaDescriptionMax})`);
  const others = posts.filter((p) => p.slug !== slug);
  const taken = new Set(others.flatMap((p) => [p.title, p.metaTitle]).map((t) => t.trim().toLowerCase()).filter(Boolean));
  if (taken.has(title.trim().toLowerCase()) || taken.has(metaTitle.trim().toLowerCase())) errors.push('title duplicates an existing post');
  if (c.templateRendersTitle && /^#\s/m.test(body)) errors.push('body has an H1; use ## and ### (the template renders the title)');
  if (!/^##\s/m.test(body)) errors.push('no ## sections');
  const words = countWords(body);
  if (words < c.qa.minWords) errors.push(`only ${words} words (min ${c.qa.minWords})`);
  if (refreshOf && words < refreshOf * c.safety.minRetainRatio) errors.push(`refresh shrank the post from ${refreshOf} to ${words} words (keep ≥ ${Math.round(refreshOf * c.safety.minRetainRatio)})`);
  const check = await linkChecker(c, posts, [slug]);
  const links = internalLinks(body, c.site);
  const bad = [...new Set(links.filter((l) => check(l.path).status !== 'ok').map((l) => l.href))];
  if (bad.length) errors.push(`internal links that aren't pages on the site: ${bad.join(', ')}`);
  const distinct = new Set(links.map((l) => l.path)).size;
  if (distinct < c.qa.minInternalLinks) errors.push(`only ${distinct} distinct internal links (min ${c.qa.minInternalLinks})`);
  const external = [...body.matchAll(/(?<!!)\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]).filter((u) => !internalLinks(`[x](${u})`, c.site).length);
  if (external.length > c.safety.maxExternalLinks) errors.push(`${external.length} external links (max ${c.safety.maxExternalLinks})`);
  if (external.some((u) => u.startsWith('http://'))) errors.push('non-https external links');
  if (external.length) warnings.push(`verify external links: ${external.join(', ')}`);
  const hits = FILLER.filter((x) => body.toLowerCase().includes(x));
  if (hits.length > c.qa.maxFillerPhrases) errors.push(`filler phrases: ${hits.join(', ')}`);
  else if (hits.length) warnings.push(`filler: ${hits.join(', ')}`);
  if (faqCount(body) < 3) errors.push('needs "## FAQ" with 3+ "### Question?" entries');
  const kw = String((f.keyword && d[f.keyword]) || '');
  if (kw && !refreshOf) {
    const close = closest(kw, others);
    if (close.score >= c.qa.cannibalizationThreshold) errors.push(`keyword overlaps existing post ${close.post.slug}; refresh that one instead`);
  }
  if ((body.match(/\b\d{1,3}(\.\d+)?%/g) ?? []).length > 3) warnings.push('several percentage claims: confirm none are invented');
  if (/\b(study|survey|research) (shows|found|finds)\b/i.test(body)) warnings.push('cites a study: confirm it is real and named');
  if (/guarantee/i.test(body)) warnings.push('uses "guarantee"');
  console.log(JSON.stringify({ file, words, ok: !errors.length, errors, warnings }, null, 2));
  process.exit(errors.length ? 1 : 0);
}

function cmdQueueAdd(keyword, title, priority) {
  if (!keyword) die('usage: queue-add "<keyword>" "<title>" [priority]');
  const c = loadConfig();
  const queue = readJson(P.queue, []);
  const slug = String(title || keyword).toLowerCase().replace(/['’]/g, '').replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-+$/, '');
  const close = closest(keyword, loadPosts(c));
  if (close.score >= c.qa.cannibalizationThreshold) die(`"${keyword}" is already covered by ${close.post.slug}`);
  if (queue.some((k) => k.slug === slug)) die(`already queued: ${slug}`);
  queue.push({ slug, keyword: keyword.toLowerCase(), title: title || keyword, priority: Number(priority) || 60, source: 'claude-code', status: 'pending', addedAt: new Date().toISOString() });
  writeJson(P.queue, queue);
  console.log(`queued ${slug}`);
}

function cmdRecord(kind, slug, note) {
  if (!kind || !slug) die('usage: record new|refresh|skip <slug> [note]');
  const queue = readJson(P.queue, []);
  const state = readJson(P.state, { refreshed: {}, meta: {}, pingedPulls: [], runs: [] });
  if (kind === 'new' || kind === 'skip') {
    let item = queue.find((k) => k.slug === slug);
    if (!item) queue.push((item = { slug, keyword: slug.replace(/-/g, ' '), title: slug, status: 'pending', source: 'claude-code' }));
    Object.assign(item, kind === 'new' ? { status: 'done', doneAt: new Date().toISOString(), note: note || 'written in Claude Code' } : { status: 'skipped', note: note || 'skipped' });
    writeJson(P.queue, queue);
  } else if (kind === 'refresh') {
    state.refreshed = { ...state.refreshed, [slug]: today() };
    writeJson(P.state, state);
  } else die('kind must be new, refresh or skip');
  console.log(`recorded ${kind} ${slug}`);
}

const [cmd, ...args] = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const run = {
  context: cmdContext,
  audit: () => cmdAudit(flag('live')),
  fix: () => cmdFix(flag('write')),
  research: cmdResearch,
  links: () => cmdLinks(args.join(' ')),
  template: () => cmdTemplate(args[0]),
  check: () => cmdCheck(args[0], Number(opt('refresh-of')) || 0),
  'queue-add': () => cmdQueueAdd(args[0], args[1], args[2]),
  record: () => cmdRecord(args[0], args[1], args.slice(2).join(' ')),
}[cmd];
if (!run) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf-8').split('\n').slice(2, 15).join('\n').replace(/^ \* ?/gm, ''));
  process.exit(cmd ? 2 : 0);
}
await run();
