import { Card, attempt, ErrorBox } from '../ui';
import { AGENT_DIR } from '@/lib/config';
import { listFiles, readFile } from '@/lib/github';

export default async function ReportsPage({ searchParams }: PageProps<'/reports'>) {
  const sp = await searchParams;
  const r = await attempt(async () => {
    const files = (await listFiles())
      .map((f) => f.path)
      .filter((p) => p.startsWith(`${AGENT_DIR}/reports/`) && p.endsWith('.md'))
      .sort()
      .reverse();
    const pick = typeof sp.r === 'string' && files.includes(sp.r) ? sp.r : files[0];
    const body = pick ? await readFile(pick) : null;
    return { files, pick, body };
  });
  if (!r.ok) return <ErrorBox error={r.error} />;
  const { files, pick, body } = r.data;
  return (
    <div className="grid gap-6 md:grid-cols-[12rem_1fr]">
      <Card title="Runs">
        {files.length ? (
          <ul className="space-y-1 text-sm">
            {files.map((f) => (
              <li key={f}>
                <a href={`/reports?r=${encodeURIComponent(f)}`} className={f === pick ? 'font-semibold' : 'text-muted hover:text-text'}>
                  {f.split('/').pop()!.replace(/\.md$/, '')}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No reports yet.</p>
        )}
      </Card>
      <Card>
        {body ? <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{body}</pre> : <p className="text-sm text-muted">Reports appear after the first run.</p>}
      </Card>
    </div>
  );
}
