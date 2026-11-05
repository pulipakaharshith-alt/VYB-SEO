/**
 * Everything secret or deployment-specific comes from environment variables, so the code holds
 * no keys and each person who deploys it brings their own. See .env.example.
 */
const read = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

const prices = (inKey: string, outKey: string): [number, number] | null => {
  const a = Number(read(inKey));
  const b = Number(read(outKey));
  return a > 0 && b > 0 ? [a, b] : null;
};

function pickProvider(explicit?: string): 'anthropic' | 'openai' | null {
  if (explicit === 'anthropic' || explicit === 'openai') return explicit;
  if (read('ANTHROPIC_API_KEY')) return 'anthropic';
  if (read('OPENAI_API_KEY')) return 'openai';
  return null;
}

export const env = {
  get provider() {
    return pickProvider(read('AI_PROVIDER'));
  },
  /** Cheaper jobs (research, meta rewrites, interlinking) can use a different provider. */
  get plannerProvider() {
    return pickProvider(read('AI_PLANNER_PROVIDER') ?? read('AI_PROVIDER'));
  },

  get anthropicKey() {
    return read('ANTHROPIC_API_KEY');
  },
  get anthropicModel() {
    return read('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
  },
  get anthropicPlannerModel() {
    return read('ANTHROPIC_PLANNER_MODEL') ?? read('ANTHROPIC_MODEL') ?? 'claude-opus-5-5';
  },
  get anthropicPrices() {
    return prices('ANTHROPIC_PRICE_IN', 'ANTHROPIC_PRICE_OUT');
  },

  get openaiKey() {
    return read('OPENAI_API_KEY');
  },
  get openaiBaseUrl() {
    return read('OPENAI_BASE_URL');
  },
  get openaiModel() {
    return read('OPENAI_MODEL') ?? 'gpt-6.1-sol';
  },
  get openaiPlannerModel() {
    return read('OPENAI_PLANNER_MODEL') ?? read('OPENAI_MODEL') ?? 'gpt-6.1-sol';
  },
  get openaiPrices() {
    return prices('OPENAI_PRICE_IN', 'OPENAI_PRICE_OUT');
  },

  /** Content repo the agent reads and writes, e.g. "acme/website". */
  get githubRepo() {
    return read('GITHUB_REPO');
  },
  get githubToken() {
    return read('GITHUB_TOKEN');
  },
  /** Branch articles are published to (and PRs target). Defaults to the repo's default branch. */
  get githubBranch() {
    return read('GITHUB_BRANCH');
  },
  get githubApi() {
    return read('GITHUB_API_URL') ?? 'https://api.github.com';
  },

  get dashboardPassword() {
    return read('DASHBOARD_PASSWORD');
  },
  get cronSecret() {
    return read('CRON_SECRET');
  },

  get googleEmail() {
    return read('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  },
  get googleKey() {
    return read('GOOGLE_PRIVATE_KEY');
  },
  get gscSite() {
    return read('GSC_SITE_URL');
  },
  get indexNowKey() {
    return read('INDEXNOW_KEY');
  },
  get maxSpendUsd() {
    const n = Number(read('MAX_SPEND_USD'));
    return n > 0 ? n : null;
  },
};

export function missingSetup(): string[] {
  const out: string[] = [];
  if (!env.provider) out.push('ANTHROPIC_API_KEY or OPENAI_API_KEY');
  if (!env.githubRepo) out.push('GITHUB_REPO');
  if (!env.githubToken) out.push('GITHUB_TOKEN');
  if (!env.dashboardPassword) out.push('DASHBOARD_PASSWORD');
  if (!env.cronSecret) out.push('CRON_SECRET');
  return out;
}
