import { env } from '../env';
import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import type { GenerateRequest, GenerateResult, Provider } from './types';

export * from './types';

/**
 * The configured provider. AI_PROVIDER picks one explicitly; otherwise whichever key is set
 * (Anthropic first when both are).
 */
export function provider(role: 'writer' | 'planner' = 'writer'): Provider {
  const name = role === 'planner' ? env.plannerProvider : env.provider;
  if (name === 'openai') return openaiProvider;
  if (name === 'anthropic') return anthropicProvider;
  throw new Error('No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
}

export function generate<T = unknown>(req: GenerateRequest): Promise<GenerateResult<T>> {
  return provider(req.role ?? 'writer').generate<T>(req);
}
