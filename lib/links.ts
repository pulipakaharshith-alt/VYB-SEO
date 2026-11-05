import { postPath, type SiteConfig } from './config';
import type { PostInfo } from './content';

export type LinkStatus = { status: 'ok' } | { status: 'remap'; to: string } | { status: 'unknown' };

/** Paths listed in the live sitemap (follows one level of sitemap index). */
export async function sitemapPaths(site: string): Promise<string[]> {
  const get = async (url: string) => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'vyb-seo-agent' }, signal: AbortSignal.timeout(15000) });
      return r.ok ? await r.text() : '';
    } catch {
      return '';
    }
  };
  const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const root = await get(`${site}/sitemap.xml`);
  let urls = locs(root);
  if (/<sitemapindex/i.test(root)) {
    const nested = await Promise.all(urls.slice(0, 20).map(get));
    urls = nested.flatMap(locs);
  }
  return urls.map((u) => {
    try {
      return new URL(u).pathname.replace(/(.)\/$/, '$1') || '/';
    } catch {
      return u;
    }
  });
}

/**
 * Decide whether an internal link target exists. Known = live sitemap + posts in the repo
 * (including ones being written in this run) + configured product pages.
 */
export function linkChecker(config: SiteConfig, posts: Pick<PostInfo, 'slug'>[], sitemap: string[], extraSlugs: string[] = []) {
  const known = new Set<string>(sitemap);
  for (const p of posts) known.add(postPath(config, p.slug));
  for (const s of extraSlugs) known.add(postPath(config, s));
  for (const p of config.productPages) known.add(p.path.replace(/(.)\/$/, '$1'));
  known.add('/');
  return (path: string): LinkStatus => {
    if (config.linkRemaps[path]) return { status: 'remap', to: config.linkRemaps[path] };
    return known.has(path) ? { status: 'ok' } : { status: 'unknown' };
  };
}
