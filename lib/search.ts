import { createSign } from 'node:crypto';
import { env } from './env';

export const googleConfigured = () => Boolean(env.googleEmail && env.googleKey);

async function googleToken(scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: env.googleEmail, scope, aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })}`;
  const key = env.googleKey!.replace(/^"|"$/g, '').replace(/\\n/g, '\n');
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}`,
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) throw new Error(`Google auth failed: ${body.error_description ?? res.status}`);
  return body.access_token;
}

export interface GscData {
  range: { startDate: string; endDate: string };
  totals: { clicks: number; impressions: number; prevClicks: number };
  /** Queries at positions 5-20 for a page. */
  striking: { slug: string | null; url: string; query: string; impressions: number; position: number }[];
  /** Page-one pages earning far fewer clicks than their position should. */
  lowCtr: { slug: string; url: string; impressions: number; ctr: number; position: number }[];
  decaying: { slug: string; url: string; clicks: number; prevClicks: number }[];
  /** Post slugs with the most clicks, best first (protected from rewrites). */
  topPages: string[];
  /** Queries with impressions, summed across pages. */
  queries: { query: string; impressions: number; position: number }[];
}

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const expectedCtr = (p: number) => (p <= 1.5 ? 0.28 : p <= 2.5 ? 0.16 : p <= 3.5 ? 0.1 : p <= 5 ? 0.07 : p <= 7 ? 0.04 : p <= 10 ? 0.025 : 0.01);

/** Last 28 days from Search Console (ending 3 days ago; GSC lags), or null if not configured. */
export async function searchConsole(site: string, slugOf: (url: string) => string | null): Promise<GscData | null> {
  if (!googleConfigured()) return null;
  const property = env.gscSite ?? `sc-domain:${new URL(site).hostname.replace(/^www\./, '')}`;
  const token = await googleToken('https://www.googleapis.com/auth/webmasters.readonly');
  type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
  const q = async (body: object): Promise<Row[]> => {
    const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { rows?: Row[]; error?: { message: string } };
    if (!res.ok) throw new Error(`Search Console: ${json.error?.message ?? res.status}`);
    return json.rows ?? [];
  };
  const range = { startDate: daysAgo(31), endDate: daysAgo(3) };
  const [pq, pages, prev] = await Promise.all([
    q({ ...range, dimensions: ['page', 'query'], rowLimit: 25000 }),
    q({ ...range, dimensions: ['page'], rowLimit: 5000 }),
    q({ startDate: daysAgo(59), endDate: daysAgo(32), dimensions: ['page'], rowLimit: 5000 }),
  ]);
  const prevBy = new Map(prev.map((r) => [r.keys[0], r.clicks]));
  const queries = new Map<string, { query: string; impressions: number; position: number }>();
  for (const r of pq) {
    const cur = queries.get(r.keys[1]) ?? { query: r.keys[1], impressions: 0, position: 99 };
    cur.impressions += r.impressions;
    cur.position = Math.min(cur.position, r.position);
    queries.set(r.keys[1], cur);
  }
  return {
    range,
    totals: {
      clicks: pages.reduce((s, r) => s + r.clicks, 0),
      impressions: pages.reduce((s, r) => s + r.impressions, 0),
      prevClicks: prev.reduce((s, r) => s + r.clicks, 0),
    },
    striking: pq
      .filter((r) => r.position >= 5 && r.position <= 20 && r.impressions >= 30)
      .map((r) => ({ slug: slugOf(r.keys[0]), url: r.keys[0], query: r.keys[1], impressions: r.impressions, position: r.position }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 300),
    lowCtr: pages
      .map((r) => ({ slug: slugOf(r.keys[0]) ?? '', url: r.keys[0], impressions: r.impressions, ctr: r.ctr, position: r.position }))
      .filter((p) => p.slug && p.impressions >= 150 && p.position <= 10 && p.ctr < expectedCtr(p.position) * 0.5)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 50),
    decaying: pages
      .map((r) => ({ slug: slugOf(r.keys[0]) ?? '', url: r.keys[0], clicks: r.clicks, prevClicks: prevBy.get(r.keys[0]) ?? 0 }))
      .filter((p) => p.slug && p.prevClicks >= 10 && p.clicks <= p.prevClicks * 0.6)
      .slice(0, 50),
    topPages: pages
      .filter((r) => r.clicks > 0)
      .sort((a, b) => b.clicks - a.clicks)
      .map((r) => slugOf(r.keys[0]))
      .filter((x): x is string => Boolean(x))
      .slice(0, 100),
    queries: [...queries.values()].sort((a, b) => b.impressions - a.impressions).slice(0, 1000),
  };
}

/** IndexNow (Bing, Yandex, Seznam, Naver). Needs INDEXNOW_KEY and /<key>.txt served by the site. */
export async function pingIndexNow(site: string, urls: string[]): Promise<string> {
  if (!env.indexNowKey || !urls.length) return 'IndexNow: skipped (no INDEXNOW_KEY)';
  const host = new URL(site).hostname;
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key: env.indexNowKey, keyLocation: `${site}/${env.indexNowKey}.txt`, urlList: urls }),
  });
  return `IndexNow: HTTP ${res.status} for ${urls.length} URLs`;
}

/** Google Indexing API. Officially for job/livestream pages; best-effort for articles. */
export async function pingGoogle(urls: string[]): Promise<string> {
  if (!googleConfigured() || !urls.length || process.env.GOOGLE_INDEXING === '0') return 'Google Indexing API: skipped';
  const token = await googleToken('https://www.googleapis.com/auth/indexing');
  let ok = 0;
  for (const url of urls) {
    const r = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: 'URL_UPDATED' }),
    });
    if (r.ok) ok++;
  }
  return `Google Indexing API: ${ok}/${urls.length} accepted`;
}

export async function isLive(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    return r.status === 200;
  } catch {
    return false;
  }
}
