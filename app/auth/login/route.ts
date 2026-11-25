import { NextResponse, type NextRequest } from 'next/server';
import { STATE_COOKIE, newState, oauthClientId, oauthConfigured, safeNext } from '@/lib/session';

/** Start "Sign in with GitHub". Only the GitHub login is requested (no repo or email scopes). */
export function GET(request: NextRequest) {
  if (!oauthConfigured()) {
    return new NextResponse('GitHub sign-in is not set up: add GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET (see SETUP.md).', { status: 503 });
  }
  const state = newState();
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', oauthClientId());
  url.searchParams.set('redirect_uri', new URL('/auth/callback', request.url).toString());
  url.searchParams.set('state', state);
  url.searchParams.set('scope', '');
  url.searchParams.set('allow_signup', 'false');
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, `${state}|${next}`, { httpOnly: true, secure: true, sameSite: 'lax', path: '/auth', maxAge: 600 });
  return res;
}
