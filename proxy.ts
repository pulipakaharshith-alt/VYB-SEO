import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, oauthConfigured, readSession } from '@/lib/session';

/**
 * The dashboard can spend AI credit and commit to your repo, so it is never open by default.
 * Order of checks:
 *  1. "/" (GET/HEAD) and /auth/* are public: the landing page and the sign-in flow.
 *  2. GitHub sign-in, when GITHUB_OAUTH_CLIENT_ID/SECRET are set: only the repo owner, or the logins
 *     in DASHBOARD_USERS, get in. This takes precedence over everything below.
 *  3. DASHBOARD_AUTH=off: explicit opt-out (the dashboard shows a warning).
 *  4. DASHBOARD_PASSWORD (HTTP Basic auth; any username).
 * The cron route checks CRON_SECRET itself, and Workflow's internal routes are excluded below.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  if ((pathname === '/' && isRead) || pathname.startsWith('/auth/')) return NextResponse.next();

  if (oauthConfigured()) {
    if (readSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
    if (!isRead) return new NextResponse('Sign in first', { status: 401 });
    const login = new URL('/auth/login', request.url);
    login.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  if (process.env.DASHBOARD_AUTH === 'off') return NextResponse.next();

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return new NextResponse('Set up sign-in: add GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET (recommended) or DASHBOARD_PASSWORD in your Vercel project settings, then redeploy.', { status: 503 });
  }
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const given = decoded.slice(decoded.indexOf(':') + 1);
    if (constantTimeEqual(given, password)) return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="SEO agent", charset="UTF-8"' },
  });
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  matcher: ['/((?!api/cron|_next/static|_next/image|favicon.ico|\\.well-known/workflow/).*)'],
};
