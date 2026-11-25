import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, STATE_COOKIE, allowedUsers, createSession, oauthClientId, oauthClientSecret, oauthConfigured, safeNext } from '@/lib/session';

const page = (status: number, title: string, body: string) =>
  new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5">` +
      `<h1 style="font-size:1.25rem">${title}</h1><p>${body}</p><p><a href="/">Back to home</a></p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

/** GitHub redirects here after sign-in. We read the login once, check it, and drop the token. */
export async function GET(request: NextRequest) {
  if (!oauthConfigured()) return page(503, 'Sign-in not set up', 'Add GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.');
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const [expected, next] = (request.cookies.get(STATE_COOKIE)?.value ?? '').split('|');
  if (!code || !state || !expected || state !== expected) return page(400, 'Sign-in expired', 'Please start again from the dashboard link.');

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: oauthClientId(), client_secret: oauthClientSecret(), code, redirect_uri: new URL('/auth/callback', request.url).toString() }),
  });
  const token = ((await tokenRes.json().catch(() => ({}))) as { access_token?: string }).access_token;
  if (!token) return page(502, 'GitHub sign-in failed', 'GitHub did not return a token. Check the OAuth app’s callback URL.');

  const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'vyb-seo-agent' } });
  const login = ((await userRes.json().catch(() => ({}))) as { login?: string }).login;
  if (!login) return page(502, 'GitHub sign-in failed', 'Could not read your GitHub username.');

  if (!allowedUsers().includes(login.toLowerCase())) {
    return page(403, 'Not your dashboard', `@${login} isn’t allowed into this copy. Each copy belongs to its owner. Deploy your own from the home page.`);
  }

  const session = createSession(login);
  const res = NextResponse.redirect(new URL(safeNext(next ?? null), request.url));
  res.cookies.set(SESSION_COOKIE, session.value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: session.maxAge });
  res.cookies.delete({ name: STATE_COOKIE, path: '/auth' });
  return res;
}
