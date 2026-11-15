import { generate, type Usage } from './ai';
import type { AgentContext, QueueItem } from './config';
import { closestPost, jaccard, slugify, type PostInfo } from './content';
import type { GscData } from './search';
import { dataforseoConfigured, keywordOverview, type KeywordMetrics } from './dataforseo';

async function suggest(q: string, hl: string, gl: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const json = JSON.parse(await res.text());
    return Array.isArray(json[1]) ? json[1] : [];
  } catch {
    return [];
  }
}

/** Expand seeds through Google Autocomplete: real queries people type. */
export async function autocomplete(seeds: string[], modifiers: string[], hl: string, gl: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const jobs = seeds.flatMap((seed) => [...modifiers.map((m) => ({ seed, q: m ? `${m} ${seed}` : seed })), { seed, q: `${seed} ` }]);
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      for (const s of await suggest(j.q, hl, gl)) if (!out.has(s)) out.set(s, j.seed);
      await new Promise((r) => setTimeout(r, 120));
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}

const PICKS = {
  type: 'object',
  additionalProperties: false,
  required: ['picks'],
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['keyword', 'title', 'intent', 'cluster', 'priority', 'why'],
        properties: {
          keyword: { type: 'string', description: 'the exact query to target, lowercase' },
          title: { type: 'string', description: 'article title, natural, under 70 characters' },
          intent: { type: 'string', enum: ['informational', 'problem', 'commercial', 'comparison', 'examples'] },
          cluster: { type: 'string', description: 'short topic cluster slug' },
          priority: { type: 'integer', description: '1-100: demand x fit with the product x chance to rank' },
          why: { type: 'string', description: 'one sentence' },
        },
      },
    },
  },
};

/**
 * Find new article topics. Sources: Autocomplete expansion of the configured seeds, plus
 * Search Console queries with impressions. Drops anything already covered; the model ranks
 * the rest for fit with the brand.
 */
export async function research(
  ctx: AgentContext,
  posts: PostInfo[],
  queue: QueueItem[],
  gsc: GscData | null,
): Promise<{ added: QueueItem[]; usage: Usage[]; candidates: number; dataUsd: number; metricsNote?: string }> {
  const { config, brand } = ctx;
  const known = [...posts.map((p) => p.keyword || p.title || p.slug.replace(/-/g, ' ')), ...queue.map((k) => k.keyword)];
  const cands = new Map<string, string>();
  if (config.research.seeds.length) {
    for (const [q, seed] of await autocomplete(config.research.seeds, config.research.modifiers, config.research.hl, config.research.gl)) cands.set(q, `autocomplete:${seed}`);
  }
  for (const r of gsc?.queries.filter((x) => x.impressions >= 20) ?? []) cands.set(r.query, `search-console:${r.impressions} impressions, best position ${r.position.toFixed(0)}`);

  let fresh = [...cands.entries()]
    .filter(([q]) => q.split(' ').length >= 2)
    .filter(([q]) => !known.some((k) => jaccard(q, k) >= config.qa.cannibalizationThreshold))
    .slice(0, 400);
  if (!fresh.length) return { added: [], usage: [], candidates: 0, dataUsd: 0 };

  // Real demand data (DataForSEO, as used by OpenSEO): volume, difficulty, intent.
  let metrics = new Map<string, KeywordMetrics>();
  let dataUsd = 0;
  let metricsNote: string | undefined;
  if (dataforseoConfigured() && config.dataforseo.keywordMetrics) {
    try {
      const r = await keywordOverview(fresh.map(([q]) => q), config.dataforseo);
      metrics = r.metrics;
      dataUsd = r.cost;
      const min = config.dataforseo.minSearchVolume;
      const before = fresh.length;
      // Keep Search Console queries (proven impressions) even when the volume data says otherwise.
      fresh = fresh.filter(([q, src]) => src.startsWith('search-console') || (metrics.get(q.toLowerCase())?.volume ?? 0) >= min);
      metricsNote = `keyword metrics for ${metrics.size} candidates; ${before - fresh.length} dropped under ${min} searches/month`;
    } catch (e) {
      metricsNote = `keyword metrics unavailable: ${(e as Error).message}`;
    }
  }
  if (!fresh.length) return { added: [], usage: [], candidates: 0, dataUsd, metricsNote };
  const fmt = (q: string) => {
    const m = metrics.get(q.toLowerCase());
    if (!m) return '';
    const parts = [m.volume != null ? `${m.volume}/mo` : null, m.difficulty != null ? `KD ${m.difficulty}` : null, m.intent].filter(Boolean);
    return parts.length ? `, ${parts.join(', ')}` : '';
  };

  const { json, usage } = await generate<{ picks: Omit<QueueItem, 'slug' | 'status'>[] }>({
    step: 'research',
    role: 'planner',
    effort: 'medium',
    maxTokens: 16000,
    schema: PICKS,
    system: `You are the SEO strategist for this website. You pick which articles its blog should write next.\n\n${brand}`,
    prompt: `Candidate search queries (from Google Autocomplete and Search Console${metrics.size ? '; with monthly searches, keyword difficulty 0-100 and intent' : ''}):
${fresh.map(([q, src]) => `- ${q}  [${src}${fmt(q)}]`).join('\n')}

Topics the site ALREADY covers (never pick anything that would compete with these):
${known.slice(0, 600).map((k) => `- ${k}`).join('\n') || '- (none yet)'}

Pick the ${config.research.picksPerRun} best queries for NEW articles. Favor queries where this product is an honest, natural answer,
long-tail queries a smaller site can rank for, and Search Console queries the site already gets impressions for.${metrics.size ? '\nWhen metrics are shown, prefer real demand with low difficulty (KD under ~40) over high-volume head terms.' : ''}
Skip navigational queries for other brands, topics the product can't credibly help with, near-duplicates, and adult topics.
Keep each keyword as the real query wording.`,
  });

  const added: QueueItem[] = [];
  for (const p of json!.picks) {
    const slug = slugify(p.title.replace(/^\d+\s+/, '')) || slugify(p.keyword);
    if (!slug || queue.some((k) => k.slug === slug) || added.some((k) => k.slug === slug) || posts.some((x) => x.slug === slug)) continue;
    if (closestPost(p.keyword, posts).score >= config.qa.cannibalizationThreshold) continue;
    added.push({
      ...p,
      slug,
      keyword: p.keyword.toLowerCase(),
      priority: Math.max(1, Math.min(100, p.priority ?? 50)),
      source: cands.get(p.keyword) ?? 'research',
      volume: metrics.get(p.keyword.toLowerCase())?.volume ?? null,
      difficulty: metrics.get(p.keyword.toLowerCase())?.difficulty ?? null,
      status: 'pending',
      addedAt: new Date().toISOString(),
    });
  }
  return { added, usage: [usage], candidates: fresh.length, dataUsd, metricsNote };
}
