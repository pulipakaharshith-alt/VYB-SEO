import Link from 'next/link';
import { getRun } from 'workflow/api';
import { runNow } from './actions';
import { GuideSummary } from './guide-summary';
import { attempt, Badge, Button, Card, ErrorBox, Notice, Stat } from './ui';
import { loadContext, loadQueue, loadState, pendingByPriority } from '@/lib/config';
import { env, missingSetup } from '@/lib/env';
import { agentPulls, checkAccess, listFiles } from '@/lib/github';
import { riskySettings } from '@/lib/guide';
import { googleConfigured } from '@/lib/search';

async function runStatus(id: string): Promise<string> {
  const r = await attempt(() => getRun(id).status);
  return r.ok ? r.data : 'unknown';
}

export default async function Overview({ searchParams }: PageProps<'/'>) {
  const sp = await searchParams;
  const startedRun = typeof sp.run === 'string' ? sp.run : null;
  const missing = missingSetup();
  const access = env.githubRepo && env.githubToken ? await checkAccess() : { ok: false, detail: 'GITHUB_REPO / GITHUB_TOKEN not set' };

  const checklist = [
    { ok: Boolean(env.provider), label: 'AI key', detail: env.provider ? `${env.provider} (${env.provider === 'openai' ? env.openaiModel : env.anthropicModel})` : 'set ANTHROPIC_API_KEY or OPENAI_API_KEY' },
    { ok: access.ok, label: 'GitHub repo', detail: access.detail },
    { ok: Boolean(env.cronSecret), label: 'Daily schedule', detail: env.cronSecret ? 'CRON_SECRET set; runs daily via Vercel Cron' : 'set CRON_SECRET' },
    { ok: googleConfigured(), label: 'Search Console', detail: googleConfigured() ? 'connected' : 'optional: lets the agent pick pages by ranking opportunity', optional: true },
    { ok: Boolean(env.dataforseoKey), label: 'DataForSEO', detail: env.dataforseoKey ? 'connected: keyword volumes, rankings, AI visibility' : 'optional: real search volumes, rankings and AI-answer tracking (pay per use)', optional: true },
    { ok: Boolean(env.indexNowKey), label: 'IndexNow', detail: env.indexNowKey ? 'key set' : 'optional: instant Bing/Yandex indexing', optional: true },
  ];

  if (!access.ok) return <Setup checklist={checklist} missing={missing} />;

  const r = await attempt(async () => {
    const [ctx, queue, state, pulls, files] = await Promise.all([loadContext(), loadQueue(), loadState(), agentPulls('open'), listFiles()]);
    const dir = ctx.config.contentDir.replace(/\/$/, '') + '/';
    const month = new Date().toISOString().slice(0, 7);
    return {
      ctx,
      state,
      pulls,
      postCount: files.filter((f) => f.path.startsWith(dir) && /\.mdx?$/.test(f.path)).length,
      pending: pendingByPriority(queue),
      status: startedRun ? await runStatus(startedRun) : null,
      monthSpend: state.runs.filter((x) => x.date.slice(0, 7) === month).reduce((s, x) => s + x.usd, 0),
    };
  });
  if (!r.ok) return <ErrorBox error={r.error} />;
  const { ctx, state, pulls, postCount, pending, status, monthSpend } = r.data;
  const ai = state.aiVisibility[0];

  return (
    <div className="space-y-6">
      {startedRun && (
        <Notice tone="ok">
          Run started ({startedRun.slice(-8)}): <strong>{status}</strong>. A run takes a few minutes per article; refresh to update. Results arrive as a pull request.
        </Notice>
      )}
      {!ctx.configured && (
        <Notice tone="bad">
          No settings saved in your repo yet. <Link href="/settings" className="underline">Open Settings</Link> and save once before the first run.
        </Notice>
      )}
      {missing.length > 0 && <Setup checklist={checklist} missing={missing} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Articles in repo" value={postCount} hint={ctx.config.contentDir} />
        <Stat label="Keywords queued" value={pending.length} />
        <Stat label="Open agent PRs" value={pulls.length} />
        <Stat label="AI spend this month" value={`$${monthSpend.toFixed(2)}`} hint={`cap $${env.maxSpendUsd ?? ctx.config.run.maxSpendUsd}/run`} />
      </div>

      <GuideSummary risky={ctx.configured ? riskySettings(ctx.config) : []} />

      <Card title="Run now">
        <form action={runNow} className="flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-muted">New articles</span>
            <input name="newArticles" type="number" min={0} max={10} defaultValue={ctx.config.run.newArticles} className="w-24" />
          </label>
          <label className="grid gap-1">
            <span className="text-muted">Refreshes</span>
            <input name="refreshes" type="number" min={0} max={10} defaultValue={ctx.config.run.refreshes} className="w-24" />
          </label>
          <label className="grid gap-1">
            <span className="text-muted">Snippet rewrites</span>
            <input name="metaRewrites" type="number" min={0} max={20} defaultValue={ctx.config.run.metaRewrites} className="w-24" />
          </label>
          <Button type="submit" disabled={!ctx.configured || !env.provider}>
            Start run
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted">
          Publishing: {ctx.config.publish.mode === 'pr' ? 'opens a pull request for you to review and merge' : 'commits straight to your branch'}. The daily run uses the same settings.
        </p>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Waiting for review">
          {pulls.length ? (
            <ul className="space-y-2 text-sm">
              {pulls.map((p) => (
                <li key={p.number}>
                  <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
                    #{p.number} {p.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No open pull requests.</p>
          )}
        </Card>
        <Card title="Up next" actions={<Link href="/queue" className="text-sm text-accent">Queue →</Link>}>
          {pending.length ? (
            <ul className="space-y-2 text-sm">
              {pending.slice(0, 6).map((k) => (
                <li key={k.slug} className="flex justify-between gap-3">
                  <span>{k.keyword}</span>
                  <span className="tabular-nums text-muted">{k.priority ?? '–'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Queue is empty. Add research seeds in Settings, or add keywords by hand.</p>
          )}
        </Card>
      </div>

      {ai && (
        <Card title={`AI visibility · ${ai.date}`}>
          <p className="mb-3 text-sm">
            Mentioned in <strong>{ai.results.filter((x) => x.mentioned).length}</strong> of {ai.results.length} AI answers; your site cited in{' '}
            <strong>{ai.results.filter((x) => x.cited).length}</strong>.
            {state.aiVisibility[1] && (
              <span className="text-muted">
                {' '}
                Previous check ({state.aiVisibility[1].date}): {state.aiVisibility[1].results.filter((x) => x.mentioned).length} of {state.aiVisibility[1].results.length}.
              </span>
            )}
          </p>
          <ul className="space-y-3 text-sm">
            {ai.results.map((x, i) => (
              <li key={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={x.mentioned ? 'ok' : 'bad'}>{x.mentioned ? 'mentioned' : 'not mentioned'}</Badge>
                  {x.cited && <Badge tone="ok">cited</Badge>}
                  <span className="text-muted">{x.platform}</span>
                  <span className="font-medium">{x.prompt}</span>
                </div>
                {x.excerpt && <p className="mt-1 text-xs text-muted">“{x.excerpt}”</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Recent runs" actions={<Link href="/reports" className="text-sm text-accent">Reports →</Link>}>
        {state.runs.length ? (
          <table className="w-full text-sm">
            <tbody>
              {state.runs.slice(0, 10).map((x) => (
                <tr key={x.id} className="border-t border-line first:border-0">
                  <td className="py-2 pr-4 tabular-nums text-muted">{x.date}</td>
                  <td className="py-2 pr-4">{x.summary.replace(/^SEO agent [\d-]+: /, '')}</td>
                  <td className="py-2 pr-4 tabular-nums text-muted">${x.usd.toFixed(2)}</td>
                  <td className="py-2 text-right">
                    {x.pr ? (
                      <a href={x.pr} className="text-accent" target="_blank" rel="noreferrer">
                        PR
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">No runs yet.</p>
        )}
      </Card>
    </div>
  );
}

function Setup({ checklist, missing }: { checklist: { ok: boolean; label: string; detail: string; optional?: boolean }[]; missing: string[] }) {
  return (
    <Card title="Setup">
      <ul className="space-y-2 text-sm">
        {checklist.map((c) => (
          <li key={c.label} className="flex flex-wrap items-center gap-2">
            <Badge tone={c.ok ? 'ok' : c.optional ? 'muted' : 'bad'}>{c.ok ? '✓' : c.optional ? 'optional' : 'missing'}</Badge>
            <span className="font-medium">{c.label}</span>
            <span className="text-muted">{c.detail}</span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <p className="mt-4 text-sm text-muted">Add the missing values in Vercel → your project → Settings → Environment Variables, then redeploy. See the README for each one.</p>
      )}
    </Card>
  );
}
