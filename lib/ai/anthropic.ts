import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';
import { ModelRefusal, OutputTruncated, type GenerateRequest, type GenerateResult, type Provider } from './types';

// USD per million tokens [input, output]. Override with ANTHROPIC_PRICE_IN / ANTHROPIC_PRICE_OUT.
const PRICES: Record<string, [number, number]> = {
  'claude-fable-5-1': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};
const WEB_SEARCH_USD = 0.01;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: env.anthropicKey, maxRetries: 4 }));

export const anthropicProvider: Provider = {
  name: 'anthropic',
  async generate<T>(req: GenerateRequest): Promise<GenerateResult<T>> {
    const model = req.role === 'planner' ? env.anthropicPlannerModel : env.anthropicModel;
    const canFallback = !model.startsWith('claude-haiku');

    const params: Anthropic.Beta.MessageCreateParamsStreaming = {
      model,
      max_tokens: req.maxTokens ?? 32000,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      stream: true,
      output_config: {
        effort: req.effort ?? 'medium',
        ...(req.schema ? { format: { type: 'json_schema', schema: req.schema } } : {}),
      },
      ...(req.webSearch
        ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: req.webSearch }] }
        : {}),
      // Server-side refusal fallback: a classifier false positive reruns on another model
      // instead of failing the step.
      ...(canFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    } as Anthropic.Beta.MessageCreateParamsStreaming;

    let message: Anthropic.Beta.BetaMessage | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let searches = 0;
    for (let turn = 0; turn < 5; turn++) {
      message = await getClient().beta.messages.stream(params).finalMessage();
      const u = message.usage;
      inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
      outputTokens += u.output_tokens ?? 0;
      searches += u.server_tool_use?.web_search_requests ?? 0;
      if (message.stop_reason !== 'pause_turn') break;
      // A long server-tool turn paused; hand it back so the model can continue.
      params.messages = [...params.messages, { role: 'assistant', content: message.content }];
    }
    if (!message) throw new Error('no response');

    const [pin, pout] = env.anthropicPrices ?? PRICES[model] ?? PRICES['claude-opus-5-5'];
    const usage = {
      provider: 'anthropic',
      model: message.model ?? model,
      inputTokens: Math.round(inputTokens),
      outputTokens,
      searches,
      usd: (inputTokens * pin + outputTokens * pout) / 1e6 + searches * WEB_SEARCH_USD,
    };

    if (message.stop_reason === 'refusal') {
      throw new ModelRefusal(`[${req.step}] model declined (${message.stop_details?.category ?? 'unknown'})`);
    }
    if (message.stop_reason === 'max_tokens') {
      throw new OutputTruncated(`[${req.step}] output hit max_tokens (${params.max_tokens})`);
    }

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return { text, json: req.schema ? (JSON.parse(text) as T) : undefined, usage };
  },
};
