import { Card } from '../ui';
import { DONTS, DOS } from '@/lib/guide';

export default function GuidePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dos and don’ts</h1>
        <p className="mt-1 text-sm text-muted">
          AI content can grow a site or quietly hurt it. These habits keep it on the right side. The agent enforces the limits in Settings → <code>safety</code>; the rest is
          up to you.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Do">
          <ul className="space-y-4">
            {DOS.map((d) => (
              <li key={d.title}>
                <div className="flex gap-2 text-sm font-medium">
                  <span className="text-ok" aria-hidden>
                    ✓
                  </span>
                  {d.title}
                </div>
                <p className="mt-1 pl-5 text-sm text-muted">{d.why}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Don’t">
          <ul className="space-y-4">
            {DONTS.map((d) => (
              <li key={d.title}>
                <div className="flex gap-2 text-sm font-medium">
                  <span className="text-bad" aria-hidden>
                    ✕
                  </span>
                  {d.title}
                </div>
                <p className="mt-1 pl-5 text-sm text-muted">{d.why}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="text-sm text-muted">
        Every risk and guard is explained in{' '}
        <a className="text-accent underline" href="https://github.com/pulipakaharshith-alt/VYB-SEO/blob/main/SAFETY.md" target="_blank" rel="noreferrer">
          SAFETY.md
        </a>
        .
      </p>
    </div>
  );
}
