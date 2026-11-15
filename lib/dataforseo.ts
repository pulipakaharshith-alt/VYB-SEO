/**
 * DataForSEO: real keyword metrics, rankings and AI-answer visibility. Optional; enabled by
 * DATAFORSEO_API_KEY (the "Base64" credential from app.dataforseo.com/api-access).
 *
 * Endpoints, request fields and pinned model names follow OpenSEO
 * (github.com/every-app/open-seo, MIT), which verified them against the live API.
 * Every task reports its own USD cost, which we add to the run's spend.
 */
import { env } from './env';


export const dataforseoConfigured = () => Boolean(env.dataforseoKey);

export class DataForSeoError extends Error {
  constructor(message: string, public costUsd = 0) {
    super(message);
  }
}

interface Task<T> {
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: T[] | null;
}

async function post<T>(path: string, body: unknown, { retry5xx = 1 } = {}): Promise<{ result: T | null; cost: number }> {
  if (!env.dataforseoKey) throw new DataForSeoError('DATAFORSEO_API_KEY is not set');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${env.dataforseoApi}${path}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${env.dataforseoKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    // Live calls may already be billed on an ambiguous 5xx; callers decide whether to retry.
    if (res.status >= 500 && attempt < retry5xx) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new DataForSeoError('DataForSEO rejected the API key (check DATAFORSEO_API_KEY and account verification)');
    const json = (await res.json().catch(() => null)) as { status_code?: number; status_message?: string; tasks?: Task<T>[] } | null;
    if (!res.ok || !json) throw new DataForSeoError(`DataForSEO HTTP ${res.status} on ${path}`);
    if (json.status_code !== 20000) throw new DataForSeoError(`DataForSEO ${json.status_code}: ${json.status_message}`);
    const task = json.tasks?.[0];
    const cost = task?.cost ?? 0;
    if (!task || task.status_code !== 20000) {
      throw new DataForSeoError(`DataForSEO task ${task?.status_code}: ${task?.status_message ?? 'no task'}`, cost);
    }
    return { result: task.result?.[0] ?? null, cost };
  }
}

// ── Keyword metrics ────────────────────────────────────────────────────────────

export interface KeywordMetrics {
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  intent: string | null;
}

type KeywordItem = {
  keyword?: string | null;
  keyword_info?: { search_volume?: number | null; cpc?: number | null } | null;
  keyword_properties?: { keyword_difficulty?: number | null } | null;
  search_intent_info?: { main_intent?: string | null } | null;
};

/** Search volume, difficulty (0-100), CPC and intent for up to ~700 keywords per call. */
export async function keywordOverview(
  keywords: string[],
  loc: { locationCode: number; languageCode: string },
): Promise<{ metrics: Map<string, KeywordMetrics>; cost: number }> {
  const metrics = new Map<string, KeywordMetrics>();
  let cost = 0;
  const unique = [...new Set(keywords.map((k) => k.toLowerCase().trim()).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 700) {
    const { result, cost: c } = await post<{ items?: KeywordItem[] | null }>('/v3/dataforseo_labs/google/keyword_overview/live', [
      { keywords: unique.slice(i, i + 700), location_code: loc.locationCode, language_code: loc.languageCode, include_clickstream_data: false },
    ]);
    cost += c;
    for (const it of result?.items ?? []) {
      if (!it.keyword) continue;
      metrics.set(it.keyword.toLowerCase(), {
        volume: it.keyword_info?.search_volume ?? null,
        difficulty: it.keyword_properties?.keyword_difficulty ?? null,
        cpc: it.keyword_info?.cpc ?? null,
        intent: it.search_intent_info?.main_intent ?? null,
      });
    }
  }
  return { metrics, cost };
}

// ── Rankings (a Search Console substitute) ───────────────────────────────────────

export interface Ranking {
  keyword: string;
  url: string;
  position: number;
  volume: number;
}

type RankedItem = {
  keyword_data?: { keyword?: string | null; keyword_info?: { search_volume?: number | null } | null } | null;
  ranked_serp_element?: { serp_item?: { url?: string | null; rank_absolute?: number | null } | null; url?: string | null; rank_absolute?: number | null } | null;
};

/** Keywords the domain ranks for in Google organic results, highest-traffic first. */
export async function rankedKeywords(
  domain: string,
  loc: { locationCode: number; languageCode: string },
  limit = 1000,
): Promise<{ rankings: Ranking[]; cost: number }> {
  const { result, cost } = await post<{ items?: RankedItem[] | null }>('/v3/dataforseo_labs/google/ranked_keywords/live', [
    { target: domain, location_code: loc.locationCode, language_code: loc.languageCode, limit, order_by: ['ranked_serp_element.serp_item.etv,desc'] },
  ]);
  const rankings: Ranking[] = [];
  for (const it of result?.items ?? []) {
    const el = it.ranked_serp_element;
    const url = el?.serp_item?.url ?? el?.url;
    const position = el?.serp_item?.rank_absolute ?? el?.rank_absolute;
    const keyword = it.keyword_data?.keyword;
    if (url && keyword && position) rankings.push({ keyword, url, position, volume: it.keyword_data?.keyword_info?.search_volume ?? 0 });
  }
  return { rankings, cost };
}

// ── AI visibility: what ChatGPT / Perplexity / Claude answer ────────────────────

export type LlmSlug = 'chat_gpt' | 'perplexity' | 'claude';

/** Model names verified live by OpenSEO; an unknown model_name is billed as a failed task. */
export const DEFAULT_LLM_MODELS: Record<LlmSlug, string> = {
  chat_gpt: 'gpt-5.6-luna',
  perplexity: 'sonar-reasoning-pro',
  claude: 'claude-sonnet-5',
};

type LlmResult = {
  model_name?: string | null;
  items?: { type?: string | null; sections?: { text?: string | null; annotations?: { title?: string | null; url?: string | null }[] | null }[] | null }[] | null;
};

export interface AiAnswer {
  platform: LlmSlug;
  model: string;
  prompt: string;
  text: string;
  citations: string[];
  cost: number;
}

/** Ask an AI assistant a question (with web search) and return its answer and cited URLs. */
export async function llmAnswer(platform: LlmSlug, prompt: string, model = DEFAULT_LLM_MODELS[platform]): Promise<AiAnswer> {
  const { result, cost } = await post<LlmResult>(
    `/v3/ai_optimization/${platform}/llm_responses/live`,
    [{ user_prompt: prompt, model_name: model, web_search: true, ...(platform === 'claude' ? { force_web_search: true } : {}), max_output_tokens: 1024 }],
    { retry5xx: 0 }, // billed live call: never replay
  );
  const sections = (result?.items ?? []).flatMap((i) => i.sections ?? []);
  return {
    platform,
    model: result?.model_name ?? model,
    prompt,
    text: sections.map((s) => s.text ?? '').join('\n').trim(),
    citations: [...new Set(sections.flatMap((s) => (s.annotations ?? []).map((a) => a.url ?? '')).filter(Boolean))],
    cost,
  };
}
