/** A JSON Schema object for structured output. Must use additionalProperties:false + required. */
export type JsonSchema = Record<string, unknown>;

export type Effort = 'low' | 'medium' | 'high';

export interface GenerateRequest {
  /** Label for cost reporting ("brief", "write", …). */
  step: string;
  system: string;
  prompt: string;
  /** Ask for JSON matching this schema; the result is parsed into `json`. */
  schema?: JsonSchema;
  /** Let the model run up to N live web searches before answering. */
  webSearch?: number;
  effort?: Effort;
  maxTokens?: number;
  /** Which configured model role to use. */
  role?: 'writer' | 'planner';
}

export interface Usage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  searches: number;
  usd: number;
}

export interface GenerateResult<T = unknown> {
  text: string;
  json?: T;
  usage: Usage;
}

export interface Provider {
  name: 'anthropic' | 'openai';
  generate<T = unknown>(req: GenerateRequest): Promise<GenerateResult<T>>;
}

export class ModelRefusal extends Error {}
export class OutputTruncated extends Error {}
