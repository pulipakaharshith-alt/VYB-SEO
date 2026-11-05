import { getWorkflowMetadata, sleep } from 'workflow';
import {
  finishRun,
  interlinkArticle,
  pingLive,
  prepareRun,
  refreshArticle,
  rewriteSnippet,
  writeArticle,
  type RunInput,
  type StepResult,
} from './steps';

/**
 * One SEO run. The workflow only orchestrates: every unit of real work is a durable step, so a
 * slow model call or a timeout resumes from the last finished step instead of starting over.
 */
export async function seoRun(input: RunInput) {
  'use workflow';
  const { workflowRunId } = getWorkflowMetadata();
  const plan = await prepareRun({ ...input, runId: workflowRunId });
  const { index: startIndex, sitemap, ...lite } = plan;
  let index = startIndex;

  let usd = plan.usd;
  let stopped: string | null = null;
  const results: StepResult[] = [];
  const budgetLeft = () => {
    if (usd < plan.maxSpendUsd) return true;
    stopped ??= `spend cap reached ($${usd.toFixed(2)} of $${plan.maxSpendUsd})`;
    return false;
  };
  const failed = (kind: StepResult['kind'], slug: string, e: unknown): StepResult => ({
    kind,
    slug,
    ok: false,
    errors: [e instanceof Error ? e.message : String(e)],
    usd: 0,
  });

  if (plan.ping.urls.length || plan.ping.pulls.length) {
    const site = plan.ping.urls[0] ? new URL(plan.ping.urls[0]).origin : '';
    try {
      await pingLive({ site, urls: plan.ping.urls, pulls: plan.ping.pulls });
    } catch {
      // Pinging is best-effort; the sitemap still tells search engines.
    }
  }

  for (const target of plan.refresh) {
    if (!budgetLeft()) break;
    let r: StepResult;
    try {
      r = await refreshArticle({ branch: plan.branch, target, index, sitemap });
    } catch (e) {
      r = failed('refresh', target.slug, e);
    }
    usd += r.usd;
    results.push(r);
  }

  for (const page of plan.metas) {
    if (!budgetLeft()) break;
    let r: StepResult;
    try {
      r = await rewriteSnippet({ branch: plan.branch, page, index });
    } catch (e) {
      r = failed('meta', page.slug, e);
    }
    usd += r.usd;
    results.push(r);
  }

  for (const item of plan.writes) {
    if (!budgetLeft()) break;
    let r: StepResult;
    try {
      r = await writeArticle({ branch: plan.branch, item, index, sitemap });
    } catch (e) {
      r = failed('new', item.slug, e);
    }
    usd += r.usd;
    if (r.ok && r.post) {
      const target = r.post;
      index = [...index, target];
      try {
        const l = await interlinkArticle({ branch: plan.branch, target, index });
        usd += l.usd;
        r.linkedFrom = l.linkedFrom;
      } catch {
        r.linkedFrom = [];
      }
    }
    results.push({ ...r, post: undefined });
  }

  const done = await finishRun({ plan: lite, results, usd, stopped });

  // Direct mode publishes right away: give the site time to deploy, then notify search engines.
  if (done.directUrls.length) {
    await sleep('10m');
    try {
      await pingLive({ site: new URL(done.directUrls[0]).origin, urls: done.directUrls, pulls: [] });
    } catch {
      // best-effort
    }
  }
  return { prUrl: done.prUrl, usd: Number(usd.toFixed(2)), stopped };
}
