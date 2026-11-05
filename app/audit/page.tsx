import Link from 'next/link';
import { Badge, Card, attempt, ErrorBox } from '../ui';
import { auditLive, auditPosts, summarize } from '@/lib/audit';
import { loadContext } from '@/lib/config';
import { loadPosts } from '@/lib/content';
import { linkChecker, sitemapPaths } from '@/lib/links';

export const maxDuration = 300;

export default async function AuditPage({ searchParams }: PageProps<'/audit'>) {
  const sp = await searchParams;
  const r = await attempt(async () => {
    const { config } = await loadContext();
    const [{ posts }, sitemap] = await Promise.all([loadPosts(config), sitemapPaths(config.site)]);
    const issues = auditPosts(config, posts, linkChecker(config, posts, sitemap));
    const live = sp.live ? await auditLive(config.site) : null;
    return { posts, sitemap, issues, live };
  });
  if (!r.ok) return <ErrorBox error={r.error} />;
  const { posts, sitemap, issues, live } = r.data;
  return (
    <div className="space-y-6">
      <Card title={`Content (${posts.length} posts)`}>
        <p className="mb-4 text-sm text-muted">
          Checked against the repo and your live sitemap ({sitemap.length} URLs). The agent fixes duplicate H1s, remapped links and doubled title suffixes on
          its next run; the rest it improves through refreshes.
        </p>
        <Summary rows={summarize(issues)} />
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted">All issues</summary>
          <ul className="mt-2 max-h-96 space-y-1 overflow-auto text-xs">
            {issues.map((i, n) => (
              <li key={n}>
                <Badge tone={i.severity === 'error' ? 'bad' : 'warn'}>{i.code}</Badge> <span className="font-mono">{i.slug}</span> {i.detail}
              </li>
            ))}
          </ul>
        </details>
      </Card>
      <Card title="Live site" actions={!live && <Link href="/audit?live=1" className="text-sm text-accent">Crawl sitemap →</Link>}>
        {live ? (
          <>
            <p className="mb-4 text-sm text-muted">{live.ok} of {live.checked} sitemap URLs return 200.</p>
            <Summary rows={summarize(live.issues)} />
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-muted">All issues</summary>
              <ul className="mt-2 max-h-96 space-y-1 overflow-auto text-xs">
                {live.issues.map((i, n) => (
                  <li key={n}>
                    <Badge tone={i.severity === 'error' ? 'bad' : 'warn'}>{i.code}</Badge> <span className="font-mono">{i.url}</span> {i.detail}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <p className="text-sm text-muted">Fetches every URL in your sitemap and checks status, title, description, canonical, H1 count, noindex and JSON-LD.</p>
        )}
      </Card>
    </div>
  );
}

function Summary({ rows }: { rows: { code: string; severity: string; count: number }[] }) {
  if (!rows.length) return <p className="text-sm text-ok">No issues found.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((r) => (
        <Badge key={`${r.severity}${r.code}`} tone={r.severity === 'error' ? 'bad' : 'warn'}>
          {r.code} · {r.count}
        </Badge>
      ))}
    </div>
  );
}
