import Link from 'next/link';
import { Card } from './ui';
import { DONTS, DOS } from '@/lib/guide';

/** Short dos/don'ts and any risky settings, for the overview and settings pages. */
export function GuideSummary({ risky, compact = false }: { risky: string[]; compact?: boolean }) {
  return (
    <>
      {risky.length > 0 && (
        <section className="rounded-xl border border-bad/40 bg-panel p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-bad">Risky settings</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {risky.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            Change them in <Link href="/settings" className="underline">Settings</Link>, or keep them if you understand the trade-off.
          </p>
        </section>
      )}
      {!compact && (
        <Card title="Dos and don’ts" actions={<Link href="/guide" className="text-sm text-accent">Full guide →</Link>}>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <ul className="space-y-1.5">
              {DOS.slice(0, 4).map((d) => (
                <li key={d.title} className="flex gap-2">
                  <span className="text-ok" aria-hidden>
                    ✓
                  </span>
                  {d.title}
                </li>
              ))}
            </ul>
            <ul className="space-y-1.5">
              {DONTS.slice(0, 4).map((d) => (
                <li key={d.title} className="flex gap-2">
                  <span className="text-bad" aria-hidden>
                    ✕
                  </span>
                  {d.title}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </>
  );
}
