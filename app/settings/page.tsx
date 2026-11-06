import { createDefaults, saveSettings } from '../actions';
import { GuideSummary } from '../guide-summary';
import { Button, Card, attempt, ErrorBox, Notice } from '../ui';
import { loadContext, PATHS } from '@/lib/config';
import { env } from '@/lib/env';
import { riskySettings } from '@/lib/guide';

export default async function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  const sp = await searchParams;
  const r = await attempt(async () => {
    const ctx = await loadContext();
    return { ctx };
  });
  if (!r.ok) return <ErrorBox error={r.error} />;
  const { ctx } = r.data;
  return (
    <div className="space-y-6">
      {sp.saved && <Notice tone="ok">Saved to {env.githubRepo}.</Notice>}
      {typeof sp.error === 'string' && <Notice tone="bad">{sp.error}</Notice>}
      {ctx.configured && <GuideSummary risky={riskySettings(ctx.config)} compact />}
      {!ctx.configured && (
        <Card title="First time">
          <p className="mb-3 text-sm text-muted">
            Nothing is saved in your repo yet. Edit the defaults below (at least <code>site</code>, <code>contentDir</code>, <code>urlPattern</code> and the
            frontmatter field names your blog uses) and save, or start from the defaults.
          </p>
          <form action={createDefaults}>
            <Button variant="ghost" type="submit">Save defaults to repo</Button>
          </form>
        </Card>
      )}
      <form action={saveSettings} className="space-y-6">
        <Card title="Site config" actions={<span className="text-xs text-muted">{PATHS.config}</span>}>
          <textarea name="config" defaultValue={JSON.stringify(ctx.config, null, 2)} rows={28} spellCheck={false} className="w-full font-mono text-xs" />
          <details className="mt-3 text-sm text-muted">
            <summary className="cursor-pointer">What the fields mean</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><code>site</code>: public URL. <code>contentDir</code>: folder of .md/.mdx posts. <code>urlPattern</code>: e.g. <code>/blog/{'{slug}'}</code>.</li>
              <li><code>titleSuffix</code>: what your layout appends to titles (e.g. &quot; | Acme&quot;). <code>templateRendersTitle</code>: true if the post template shows the title as H1.</li>
              <li><code>frontmatter</code>: the field names your blog reads. Empty string = don&apos;t write it. <code>extra</code> is added to every new post.</li>
              <li><code>productPages</code>: pages articles may link and mention. <code>linkRemaps</code>: old/login-only paths → public pages.</li>
              <li><code>publish.mode</code>: &quot;pr&quot; (review first) or &quot;direct&quot;. <code>run</code>: how much each run does and the spend cap.</li>
              <li><code>research.seeds</code>: topics to expand through Google Autocomplete into new keywords.</li>
              <li><code>safety</code>: guard rails (weekly post limit, protected top pages, refresh shrink limit, claims check, external link limit). See <a href="/guide" className="underline">Dos &amp; don&apos;ts</a>.</li>
              <li><code>dataforseo</code>: used only with <code>DATAFORSEO_API_KEY</code>. Location (2840 US, 2356 India), minimum search volume, and <code>aiVisibility.prompts</code>: questions to ask ChatGPT and Perplexity weekly to see if they mention you.</li>
            </ul>
          </details>
        </Card>
        <Card title="Brand & product notes" actions={<span className="text-xs text-muted">{PATHS.brand}</span>}>
          <p className="mb-3 text-sm text-muted">Sent with every article. The agent only states product facts written here.</p>
          <textarea name="brand" defaultValue={ctx.brand} rows={22} className="w-full font-mono text-xs" />
        </Card>
        <Button type="submit">Save to repo</Button>
      </form>
    </div>
  );
}
