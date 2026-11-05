import type { ReactNode } from 'react';

/** Run a data loader and capture its error, so pages render JSX outside try/catch. */
export async function attempt<T>(load: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    return { ok: false, error };
  }
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-4">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Button({ children, variant = 'primary', ...rest }: { children: ReactNode; variant?: 'primary' | 'ghost' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls =
    variant === 'primary'
      ? 'bg-accent text-white hover:opacity-90'
      : 'border border-line text-text hover:bg-accent-soft';
  return (
    <button {...rest} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${cls} ${rest.className ?? ''}`}>
      {children}
    </button>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: ReactNode }) {
  const color = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', muted: 'text-muted' }[tone];
  return <span className={`inline-flex items-center rounded-full border border-line px-2 py-0.5 text-xs ${color}`}>{children}</span>;
}

export function Notice({ tone, children }: { tone: 'ok' | 'bad'; children: ReactNode }) {
  return (
    <div className={`mb-6 rounded-lg border border-line bg-panel px-4 py-3 text-sm ${tone === 'ok' ? 'text-ok' : 'text-bad'}`}>{children}</div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <Card>
      <p className="text-sm text-bad">Couldn&apos;t load data: {error instanceof Error ? error.message : String(error)}</p>
      <p className="mt-2 text-sm text-muted">Check GITHUB_REPO and GITHUB_TOKEN in your Vercel environment variables.</p>
    </Card>
  );
}
