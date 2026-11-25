import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { SESSION_COOKIE, readSession } from '@/lib/session';

export const metadata: Metadata = {
  title: 'SEO Agent dashboard',
  robots: { index: false, follow: false },
};

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/queue', label: 'Queue' },
  { href: '/dashboard/audit', label: 'Audit' },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/settings', label: 'Settings' },
  { href: '/dashboard/guide', label: 'Dos & don’ts' },
];

export default async function DashboardLayout({ children }: LayoutProps<'/dashboard'>) {
  const user = readSession((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <>
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            SEO Agent
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm text-muted">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-text">
                {n.label}
              </Link>
            ))}
          </nav>
          {user && (
            <span className="ml-auto text-sm text-muted">
              @{user} ·{' '}
              <a href="/auth/logout" className="hover:text-text">
                Sign out
              </a>
            </span>
          )}
        </div>
      </header>
      {env.dashboardAuthOff && (
        <div className="border-b border-bad/40 bg-panel">
          <p className="mx-auto max-w-5xl px-4 py-2 text-sm text-bad">
            This dashboard is public (DASHBOARD_AUTH=off): anyone with the URL can start runs and change settings
            {env.provider || env.githubToken ? ', and an AI key or GitHub token is set, so that means spending your credit and opening PRs.' : '.'} Set a
            DASHBOARD_PASSWORD and remove DASHBOARD_AUTH in Vercel to lock it again.
          </p>
        </div>
      )}
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </>
  );
}
