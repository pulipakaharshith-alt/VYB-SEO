import { readFile } from './github';

/** Where the agent keeps its files inside the content repo. */
export const AGENT_DIR = '.seo-agent';
export const PATHS = {
  config: `${AGENT_DIR}/config.json`,
  brand: `${AGENT_DIR}/brand.md`,
  queue: `${AGENT_DIR}/queue.json`,
  state: `${AGENT_DIR}/state.json`,
  report: (date: string) => `${AGENT_DIR}/reports/${date}.md`,
};

export interface SiteConfig {
  /** Public site URL, no trailing slash. */
  site: string;
  /** Folder in the repo holding posts, e.g. "content/blog" or "src/content/blog". */
  contentDir: string;
  /** File extension for new posts. */
  extension: 'md' | 'mdx';
  /** Public URL path of a post. {slug} is replaced. */
  urlPattern: string;
  /** Appended to every page title by the site layout (e.g. " | Acme"), used to judge title length. */
  titleSuffix: string;
  /** True when the blog template already renders the title as <h1> (then the body must not have one). */
  templateRendersTitle: boolean;
  /** Frontmatter field names your blog uses. Leave one empty ("") to not write it. */
  frontmatter: {
    title: string;
    description: string;
    metaTitle: string;
    excerpt: string;
    date: string;
    updated: string;
    keyword: string;
    /** If your template renders a JSON-LD string from frontmatter, name the field; FAQ schema goes there. */
    schema: string;
    /** Static fields added to every new post, e.g. { "draft": false, "author": "Team" }. */
    extra: Record<string, string | number | boolean>;
  };
  /** Pages articles may link to and mention, with a one-line description each. */
  productPages: { path: string; about: string }[];
  /** Internal links to rewrite (a 404 or a login-walled page → its public equivalent). */
  linkRemaps: Record<string, string>;

  publish: {
    /** "pr": open a pull request you merge. "direct": commit straight to the branch. */
    mode: 'pr' | 'direct';
  };
  /** Guard rails. See SAFETY.md. */
  safety: {
    /** Most new articles published in any 7 days (open PRs count). Start low and raise slowly. */
    maxNewPerWeek: number;
    /** Never rewrite the N pages with the most clicks (needs Search Console). */
    protectTopPages: number;
    /** A refresh must keep at least this share of the original word count. */
    minRetainRatio: number;
    /** Second AI pass that checks every draft against the brand notes for unsupported claims. */
    claimsCheck: boolean;
    /** Most external links an article may contain. */
    maxExternalLinks: number;
  };
  run: {
    newArticles: number;
    refreshes: number;
    metaRewrites: number;
    research: boolean;
    /** Hard cap on AI spend per run, USD. */
    maxSpendUsd: number;
  };
  qa: {
    minWords: number;
    maxWords: number;
    minInternalLinks: number;
    metaTitleMax: number;
    metaDescriptionMin: number;
    metaDescriptionMax: number;
    maxFillerPhrases: number;
    staleDays: number;
    cannibalizationThreshold: number;
  };
  research: {
    hl: string;
    gl: string;
    seeds: string[];
    modifiers: string[];
    picksPerRun: number;
  };
}

export const DEFAULT_CONFIG: SiteConfig = {
  site: 'https://example.com',
  contentDir: 'content/blog',
  extension: 'md',
  urlPattern: '/blog/{slug}',
  titleSuffix: '',
  templateRendersTitle: true,
  frontmatter: {
    title: 'title',
    description: 'description',
    metaTitle: '',
    excerpt: '',
    date: 'date',
    updated: 'updated',
    keyword: 'keyword',
    schema: '',
    extra: {},
  },
  productPages: [{ path: '/', about: 'Home page' }],
  linkRemaps: {},
  publish: { mode: 'pr' },
  safety: { maxNewPerWeek: 3, protectTopPages: 10, minRetainRatio: 0.7, claimsCheck: true, maxExternalLinks: 6 },
  run: { newArticles: 1, refreshes: 1, metaRewrites: 2, research: true, maxSpendUsd: 5 },
  qa: {
    minWords: 1200,
    maxWords: 4500,
    minInternalLinks: 3,
    metaTitleMax: 60,
    metaDescriptionMin: 110,
    metaDescriptionMax: 160,
    maxFillerPhrases: 2,
    staleDays: 240,
    cannibalizationThreshold: 0.6,
  },
  research: {
    hl: 'en',
    gl: 'us',
    seeds: [],
    modifiers: ['', 'how to', 'best', 'what is', 'for', 'vs', 'examples', 'free'],
    picksPerRun: 10,
  },
};

export const DEFAULT_BRAND = `# Brand & product notes

The agent sends this file with every article it writes. Anything here can end up in a published post, so keep it true.

## What we are
One paragraph: what the product is, who it is for, the problem it solves.

## Features
- Feature: what it does, in plain words.

## Facts you may state
- Pricing or free-trial facts that are safe to publish.

## Audience
Who reads the blog and what they are trying to get done.

## Voice
Direct, warm, practical. Short sentences. No hype.

## Hard rules
- Never invent statistics, studies or quotes.
- Never promise results.
- Never claim features not listed above.
`;

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object' || Array.isArray(base)) return (over as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v) ? merge(b, v) : v;
  }
  return out as T;
}

export interface AgentContext {
  config: SiteConfig;
  brand: string;
  configured: boolean;
}

/** Load settings from the content repo, falling back to defaults for anything unset. */
export async function loadContext(): Promise<AgentContext> {
  const [raw, brand] = await Promise.all([readFile(PATHS.config), readFile(PATHS.brand)]);
  let parsed: unknown = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${PATHS.config} is not valid JSON`);
    }
  }
  const config = merge(DEFAULT_CONFIG, parsed);
  config.site = config.site.replace(/\/$/, '');
  return { config, brand: brand ?? DEFAULT_BRAND, configured: Boolean(raw) };
}

export const postUrl = (config: SiteConfig, slug: string) => `${config.site}${config.urlPattern.replace('{slug}', slug)}`;
export const postPath = (config: SiteConfig, slug: string) => config.urlPattern.replace('{slug}', slug);
export const postFile = (config: SiteConfig, slug: string) => `${config.contentDir.replace(/\/$/, '')}/${slug}.${config.extension}`;

// ── Queue & state (also files in the repo) ───────────────────────────────────

export interface QueueItem {
  slug: string;
  keyword: string;
  title: string;
  intent?: string;
  cluster?: string;
  priority?: number;
  why?: string;
  source?: string;
  status: 'pending' | 'writing' | 'done' | 'skipped' | 'failed';
  note?: string;
  addedAt?: string;
  doneAt?: string;
}

export interface AgentState {
  refreshed: Record<string, string>;
  meta: Record<string, string>;
  pingedPulls: number[];
  runs: { id: string; date: string; summary: string; usd: number; pr?: string }[];
}

export async function loadQueue(): Promise<QueueItem[]> {
  const raw = await readFile(PATHS.queue);
  return raw ? (JSON.parse(raw) as QueueItem[]) : [];
}

export async function loadState(): Promise<AgentState> {
  const raw = await readFile(PATHS.state);
  const s = raw ? (JSON.parse(raw) as Partial<AgentState>) : {};
  return { refreshed: s.refreshed ?? {}, meta: s.meta ?? {}, pingedPulls: s.pingedPulls ?? [], runs: s.runs ?? [] };
}

export const pendingByPriority = (q: QueueItem[]) =>
  q.filter((k) => k.status === 'pending').sort((a, b) => (b.priority ?? 40) - (a.priority ?? 40));
