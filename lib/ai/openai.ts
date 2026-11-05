import OpenAI from 'openai';
import { env } from '../env';
import { ModelRefusal, OutputTruncated, type GenerateRequest, type GenerateResult, type Provider } from './types';

// USD per million tokens [input, output]. Conservative defaults; override with
// OPENAI_PRICE_IN / OPENAI_PRICE_OUT if your model or rates differ.
const PRICES: Record<string, [number, number]> = {
  'gpt-6.1-sol': [2, 10],
  'gpt-6.1-terra': [1, 5],
  'gpt-6-luna': [0.1, 0.5],
};
const WEB_SEARCH_USD = 0.01;

let client: OpenAI | null = null;
const getClient = () =>
  (client ??= new OpenAI({
    apiKey: env.openaiKey,
    ...(env.openaiBaseUrl ? { baseURL: env.openaiBaseUrl } : {}),
    maxRetries: 4,
  }));

export const openaiProvider: Provider = {
  name: 'openai',
  async generate<T>(req: GenerateRequest): Promise<GenerateResult<T>> {
    const model = req.role === 'planner' ? env.openaiPlannerModel : env.openaiModel;
    const stream = getClient().responses.stream({
      model,
      instructions: req.system,
      input: req.prompt,
      max_output_tokens: req.maxTokens ?? 32000,
      reasoning: { effort: req.effort ?? 'medium' },
      ...(req.webSearch ? { tools: [{ type: 'web_search' as const }], max_tool_calls: req.webSearch } : {}),
      ...(req.schema
        ? { text: { format: { type: 'json_schema' as const, name: 'output', schema: req.schema, strict: true } } }
        : {}),
    });
    const res = await stream.finalResponse();

    const searches = res.output.filter((o) => o.type === 'web_search_call').length;
    const inputTokens = res.usage?.input_tokens ?? 0;
    const outputTokens = res.usage?.output_tokens ?? 0;
    const [pin, pout] = env.openaiPrices ?? PRICES[model] ?? PRICES['gpt-6.1-sol'];
    const usage = {
      provider: 'openai',
      model: res.model ?? model,
      inputTokens,
      outputTokens,
      searches,
      usd: (inputTokens * pin + outputTokens * pout) / 1e6 + searches * WEB_SEARCH_USD,
    };

    const refusal = res.output
      .flatMap((o) => (o.type === 'message' ? o.content : []))
      .find((c) => c.type === 'refusal');
    if (refusal) throw new ModelRefusal(`[${req.step}] model declined: ${'refusal' in refusal ? refusal.refusal : ''}`);
    if (res.status === 'incomplete') {
      throw new OutputTruncated(`[${req.step}] response incomplete (${res.incomplete_details?.reason ?? 'unknown'})`);
    }

    const text = res.output_text.trim();
    return { text, json: req.schema ? (JSON.parse(text) as T) : undefined, usage };
  },
};
