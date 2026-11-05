import type { SiteConfig } from './config';
import { internalLinks, jaccard, joinRaw, setFmField, splitRaw, type PostInfo } from './content';
import type { LinkStatus } from './links';

export interface Issue {
  slug: string;
  severity: 'error' | 'warn';
  code: string;
  detail: string;
}

const days = (d: string) => (Date.now() - new Date(d).getTime()) / 864e5;

/** Content audit over the repo's posts. No network, no AI. */
export function auditPosts(config: SiteConfig, posts: PostInfo[], checkLink: (p: string) => LinkStatus): Issue[] {
  const issues: Issue[] = [];
  const add = (slug: string, severity: Issue['severity'], code: string, detail: string) => issues.push({ slug, severity, code, detail });
  const inbound = new Map(posts.map((p) => [p.slug, 0]));
  const pathToSlug = new Map(posts.map((p) => [config.urlPattern.replace('{slug}', p.slug), p.slug]));

  for (const p of posts) {
    if (p.parseError) add(p.slug, 'error', 'frontmatter', p.parseError);
    if (!p.title) add(p.slug, 'error', 'missing-title', 'no title');
    if (!p.description) add(p.slug, 'error', 'missing-description', 'no meta description');
    const tl = p.metaTitle.length + config.titleSuffix.length;
    if (tl > 65) add(p.slug, 'warn', 'title-long', `${tl} chars with suffix; truncated in results`);
    if (config.titleSuffix && p.metaTitle.toLowerCase().endsWith(config.titleSuffix.trim().toLowerCase()))
      add(p.slug, 'warn', 'title-suffix-twice', `title already ends with "${config.titleSuffix.trim()}" and the layout adds it again`);
    if (p.description && (p.description.length > 165 || p.description.length < 90)) add(p.slug, 'warn', 'description-length', `${p.description.length} chars`);
    if (config.templateRendersTitle && p.bodyH1) add(p.slug, 'error', 'duplicate-h1', 'body starts with an H1 and the template renders the title as H1 too');
    if (p.words < 700) add(p.slug, 'warn', 'thin', `${p.words} words`);
    if (p.updated && days(p.updated) > config.qa.staleDays) add(p.slug, 'warn', 'stale', `last updated ${p.updated}`);
    if (!p.faqCount) add(p.slug, 'warn', 'no-faq', 'no FAQ section');

    const broken: string[] = [];
    const remap: string[] = [];
    for (const path of p.links) {
      const r = checkLink(path);
      if (r.status === 'remap') remap.push(path);
      else if (r.status === 'unknown') broken.push(path);
      const target = pathToSlug.get(path);
      if (target && target !== p.slug) inbound.set(target, (inbound.get(target) ?? 0) + 1);
    }
    if (broken.length) add(p.slug, 'error', 'broken-link', broken.join(', '));
    if (remap.length) add(p.slug, 'error', 'remapped-link', `${remap.join(', ')} (configured as 404/login-walled)`);
  }

  for (const [slug, n] of inbound) if (n === 0) add(slug, 'warn', 'orphan', 'no other article links here');

  for (let i = 0; i < posts.length; i++)
    for (let j = i + 1; j < posts.length; j++) {
      const a = posts[i], b = posts[j];
      if (a.keyword && b.keyword && jaccard(a.keyword, b.keyword) >= 0.8) add(a.slug, 'warn', 'cannibalization', `targets nearly the same keyword as ${b.slug}`);
    }

  const titles = new Map<string, string[]>();
  for (const p of posts) titles.set(p.metaTitle.toLowerCase(), [...(titles.get(p.metaTitle.toLowerCase()) ?? []), p.slug]);
  for (const [t, s] of titles) if (t && s.length > 1) add(s[0], 'error', 'duplicate-title', `same title as ${s.slice(1).join(', ')}`);
  return issues;
}

/**
 * Mechanical fixes that never change meaning: remapped links, a duplicate body H1, and a title
 * that repeats the layout's suffix. Returns changed files (path → new content).
 */
export function fixPosts(config: SiteConfig, posts: PostInfo[], raw: Map<string, string>): { files: Record<string, string>; counts: Record<string, number> } {
  const files: Record<string, string> = {};
  const counts = { links: 0, h1: 0, titles: 0 };
  const remapKeys = Object.keys(config.linkRemaps);

  for (const p of posts) {
    const original = raw.get(p.file);
    if (!original) continue;
    const { fm, body: b0 } = splitRaw(original);
    if (fm == null) continue;
    let body = b0;
    let front = fm;

    if (remapKeys.length) {
      const hrefs = internalLinks(body, config.site);
      for (const l of hrefs) {
        const to = config.linkRemaps[l.path];
        if (!to) continue;
        const suffix = l.href.match(/[?#].*$/)?.[0] ?? '';
        body = body.split(`](${l.href})`).join(`](${to}${suffix})`);
        counts.links++;
      }
    }

    if (config.templateRendersTitle) {
      const lines = body.split('\n');
      const first = lines.findIndex((l) => l.trim());
      if (first >= 0 && lines[first].startsWith('# ')) {
        lines.splice(first, 1);
        counts.h1++;
      }
      let inCode = false;
      body = lines.map((l) => {
        if (l.startsWith('```')) inCode = !inCode;
        return !inCode && /^# /.test(l) ? `#${l}` : l;
      }).join('\n');
    }

    const suffix = config.titleSuffix.trim();
    const field = config.frontmatter.metaTitle || config.frontmatter.title;
    if (suffix && p.metaTitle.toLowerCase().endsWith(suffix.toLowerCase())) {
      const cleaned = p.metaTitle.slice(0, -suffix.length).replace(/[\s|–-]+$/, '');
      if (cleaned) {
        front = setFmField(front, field, cleaned);
        counts.titles++;
      }
    }

    if (body !== b0 || front !== fm) files[p.file] = joinRaw(front, body);
  }
  return { files, counts };
}

export interface LiveIssue {
  url: string;
  severity: 'error' | 'warn';
  code: string;
  detail: string;
}

/** Crawl the live sitemap and check what search engines see. */
export async function auditLive(site: string, limit = 300): Promise<{ checked: number; ok: number; issues: LiveIssue[] }> {
  const issues: LiveIssue[] = [];
  const add = (url: string, severity: LiveIssue['severity'], code: string, detail = '') => issues.push({ url, severity, code, detail });
  const robots = await fetch(`${site}/robots.txt`).then((r) => r.text()).catch(() => '');
  if (!/sitemap:/i.test(robots)) add('/robots.txt', 'warn', 'robots-no-sitemap');
  if (/^disallow:\s*\/\s*$/im.test(robots)) add('/robots.txt', 'error', 'robots-disallow-all');
  const xml = await fetch(`${site}/sitemap.xml`).then((r) => r.text()).catch(() => '');
  let urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  if (/<sitemapindex/i.test(xml)) {
    const nested = await Promise.all(urls.slice(0, 20).map((u) => fetch(u).then((r) => r.text()).catch(() => '')));
    urls = nested.flatMap((x) => [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]));
  }
  if (!urls.length) add('/sitemap.xml', 'error', 'no-sitemap', 'sitemap missing or empty');
  urls = urls.slice(0, limit);

  let ok = 0;
  const titles = new Map<string, string[]>();
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        const t0 = Date.now();
        const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'vyb-seo-agent' }, signal: AbortSignal.timeout(20000) });
        const ms = Date.now() - t0;
        if (res.status !== 200) {
          add(url, 'error', 'status', `HTTP ${res.status} for a sitemap URL`);
          continue;
        }
        ok++;
        const h = await res.text();
        const title = h.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
        const desc = h.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] ?? '';
        const canonical = h.match(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i)?.[1] ?? '';
        const h1 = (h.match(/<h1[\s>]/gi) ?? []).length;
        if (!title) add(url, 'error', 'no-title');
        else if (title.length > 65) add(url, 'warn', 'title-long', `${title.length} chars`);
        if (!desc) add(url, 'error', 'no-description');
        if (!canonical) add(url, 'warn', 'no-canonical');
        else if (canonical.replace(/\/$/, '') !== url.replace(/\/$/, '')) add(url, 'warn', 'canonical-mismatch', canonical);
        if (/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(h)) add(url, 'error', 'noindex', 'in sitemap but noindex');
        if (h1 !== 1) add(url, h1 ? 'warn' : 'error', 'h1-count', `${h1} <h1> tags`);
        for (const m of h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
          try {
            JSON.parse(m[1]);
          } catch {
            add(url, 'error', 'jsonld-invalid');
          }
        }
        if (ms > 2500) add(url, 'warn', 'slow', `${ms} ms`);
        titles.set(title, [...(titles.get(title) ?? []), url]);
      } catch (e) {
        add(url, 'error', 'fetch-failed', (e as Error).message);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  for (const [t, us] of titles) if (t && us.length > 1) add(us[0], 'warn', 'duplicate-title', `${us.length} pages titled "${t}"`);
  return { checked: urls.length, ok, issues };
}

export function summarize(issues: { severity: string; code: string }[]): { code: string; severity: string; count: number }[] {
  const m = new Map<string, { code: string; severity: string; count: number }>();
  for (const i of issues) {
    const k = `${i.severity}:${i.code}`;
    m.set(k, { code: i.code, severity: i.severity, count: (m.get(k)?.count ?? 0) + 1 });
  }
  return [...m.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'error' ? -1 : 1));
}
