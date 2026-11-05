import matter from 'gray-matter';
import { postPath, type SiteConfig } from './config';
import { listFiles, readMany } from './github';

/** Compact, serializable view of one post (what workflow steps pass around). */
export interface PostInfo {
  slug: string;
  file: string;
  title: string;
  metaTitle: string;
  description: string;
  keyword: string;
  published: string;
  updated: string;
  headings: string[];
  /** Internal link paths found in the body. */
  links: string[];
  words: number;
  faqCount: number;
  bodyH1: boolean;
  parseError?: string;
}

export function splitRaw(raw: string): { fm: string | null; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : { fm: null, body: raw };
}

export const joinRaw = (fm: string, body: string) => `---\n${fm}\n---\n\n${body.replace(/^\s+/, '')}`.replace(/\s*$/, '\n');

/** Replace (or append) a scalar field in verbatim YAML frontmatter, keeping everything else as is. */
export function setFmField(fm: string, key: string, value: string): string {
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*$`, 'm');
  const line = `${key}: ${JSON.stringify(value)}`;
  return re.test(fm) ? fm.replace(re, line) : `${fm}\n${line}`;
}

export function countWords(md: string): number {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Internal link paths in markdown, normalized (no query/hash/trailing slash). */
export function internalLinks(md: string, site: string): { href: string; path: string }[] {
  const host = site.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const abs = new RegExp(`^https?://(www\\.)?${host.replace(/\./g, '\\.')}`, 'i');
  const out: { href: string; path: string }[] = [];
  for (const m of md.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = m[1];
    let p: string | null = null;
    if (href.startsWith('/') && !href.startsWith('//')) p = href;
    else if (abs.test(href)) p = href.replace(abs, '') || '/';
    if (p) out.push({ href, path: p.split(/[?#]/)[0].replace(/(.)\/$/, '$1') });
  }
  return out;
}

export function extractFaq(body: string): { question: string; answer: string }[] {
  const sec = body.match(/^##\s+(?:FAQ|FAQs|Frequently Asked Questions)[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  if (!sec) return [];
  return sec[1]
    .split(/^###\s+/m)
    .slice(1)
    .map((part) => {
      const [q, ...rest] = part.split('\n');
      return {
        question: q.replace(/[*_`]/g, '').trim(),
        answer: rest.join('\n').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim(),
      };
    })
    .filter((f) => f.question && f.answer);
}

export function faqSchema(url: string, faq: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
  };
}

const str = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v));

export function parsePost(config: SiteConfig, file: string, raw: string): PostInfo {
  const slug = file.split('/').pop()!.replace(/\.(md|mdx)$/, '');
  const f = config.frontmatter;
  let data: Record<string, unknown> = {};
  let parseError: string | undefined;
  try {
    data = matter(raw).data;
  } catch (e) {
    parseError = (e as Error).message;
  }
  const { body } = splitRaw(raw);
  const first = body.split('\n').find((l) => l.trim()) ?? '';
  return {
    slug,
    file,
    title: str(data[f.title]),
    metaTitle: str(f.metaTitle ? data[f.metaTitle] : '') || str(data[f.title]),
    description: str(data[f.description]),
    keyword: str(f.keyword ? data[f.keyword] : ''),
    published: str(data[f.date]),
    updated: str(f.updated ? data[f.updated] : '') || str(data[f.date]),
    headings: [...body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim()),
    links: [...new Set(internalLinks(body, config.site).map((l) => l.path))],
    words: countWords(body),
    faqCount: extractFaq(body).length,
    bodyH1: first.startsWith('# '),
    parseError,
  };
}

/** Load every post in the content folder. Returns parsed info plus raw text keyed by path. */
export async function loadPosts(config: SiteConfig, ref?: string): Promise<{ posts: PostInfo[]; raw: Map<string, string> }> {
  const dir = config.contentDir.replace(/\/$/, '') + '/';
  const entries = (await listFiles(ref)).filter((e) => e.path.startsWith(dir) && /\.(md|mdx)$/.test(e.path) && !e.path.slice(dir.length).includes('/'));
  const raw = await readMany(entries);
  const posts = entries.map((e) => parsePost(config, e.path, raw.get(e.path)!));
  return { posts, raw };
}

/**
 * Build the full markdown file for a new or rewritten post.
 * With `existingRaw` (a refresh), every frontmatter field the post already has is kept (tags,
 * images, authors, draft state…); only the fields the agent owns are updated, and `extra` only
 * fills in fields that are missing, so a refresh can never unpublish or strip a live post.
 */
export function buildPostFile(
  config: SiteConfig,
  a: { slug: string; title: string; metaTitle: string; description: string; excerpt: string; body: string; keyword: string; published: string; updated: string },
  existingRaw?: string,
): string {
  const f = config.frontmatter;
  let existing: Record<string, unknown> = {};
  if (existingRaw) {
    try {
      existing = { ...matter(existingRaw).data };
    } catch {
      existing = {};
    }
  }
  const data: Record<string, unknown> = { ...existing };
  data[f.title] = a.title;
  if (f.metaTitle) data[f.metaTitle] = a.metaTitle;
  data[f.description] = a.description;
  if (f.excerpt) data[f.excerpt] = a.excerpt;
  if (!existingRaw || data[f.date] == null) data[f.date] = a.published;
  if (f.updated) data[f.updated] = a.updated;
  if (f.keyword) data[f.keyword] = a.keyword;
  for (const [k, v] of Object.entries(f.extra)) if (!(k in existing)) data[k] = v;
  if (f.schema) {
    const faq = extractFaq(a.body);
    if (faq.length) data[f.schema] = JSON.stringify(faqSchema(`${config.site}${postPath(config, a.slug)}`, faq), null, 2);
  }
  return matter.stringify(`\n${a.body.trim()}\n`, data);
}

/** Re-parse a generated file and confirm it is valid before it is committed. */
export function validatePostFile(config: SiteConfig, file: string, text: string): string[] {
  const p = parsePost(config, file, text);
  const errors: string[] = [];
  if (p.parseError) errors.push(`generated frontmatter does not parse: ${p.parseError}`);
  if (!p.title) errors.push('generated file has no title');
  if (!p.description) errors.push('generated file has no description');
  if (!p.published) errors.push('generated file has no date');
  if (p.words < 200) errors.push('generated file body is nearly empty');
  return errors;
}

// ── Similarity ───────────────────────────────────────────────────────────────

const STOP = new Set(
  'a an the to for of on in and or with your you my me i is are be do does how what why when who which that this it at by from vs best top guide tips ways examples ideas'.split(' '),
);
const stem = (w: string) => (w.length < 4 ? w : w.replace(/ies$/, 'y').replace(/([sxz]|ch|sh)es$/, '$1').replace(/([^su])s$/, '$1').replace(/(.{3,})ing$/, '$1'));

export function tokens(s: string): string[] {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && !STOP.has(w) && !/^20\d\d$/.test(w))
    .map(stem);
}

export function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function closestPost(keyword: string, posts: PostInfo[]): { score: number; post: PostInfo | null } {
  let best: { score: number; post: PostInfo | null } = { score: 0, post: null };
  for (const p of posts) {
    const s = Math.max(jaccard(keyword, p.keyword || p.title), jaccard(keyword, p.slug.replace(/-/g, ' ')));
    if (s > best.score) best = { score: s, post: p };
  }
  return best;
}

/** TF-IDF cosine over title + keyword + headings. */
export function relatedPosts(text: string, posts: PostInfo[], exclude: string[] = [], limit = 8): PostInfo[] {
  const docs = posts.filter((p) => !exclude.includes(p.slug)).map((p) => ({ p, t: tokens(`${p.title} ${p.keyword} ${p.keyword} ${p.headings.join(' ')}`) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.t)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length + 1;
  const vec = (toks: string[]) => {
    const v = new Map<string, number>();
    for (const t of toks) v.set(t, (v.get(t) ?? 0) + 1);
    // Smoothed IDF: never zero, so a term every post shares still counts on small sites.
    for (const [t, c] of v) v.set(t, c * (1 + Math.log(N / (1 + (df.get(t) ?? 0)))));
    return v;
  };
  const cos = (a: Map<string, number>, b: Map<string, number>) => {
    let dot = 0, na = 0, nb = 0;
    for (const [t, x] of a) { na += x * x; const y = b.get(t); if (y) dot += x * y; }
    for (const [, y] of b) nb += y * y;
    return dot && na && nb ? dot / Math.sqrt(na * nb) : 0;
  };
  const q = vec(tokens(text));
  return docs
    .map((d) => ({ p: d.p, s: cos(q, vec(d.t)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p);
}

export function slugify(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}
