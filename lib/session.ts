import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * "Sign in with GitHub" for a deployment's dashboard. Nothing is stored server-side: the session is
 * a signed cookie (HMAC keyed off the OAuth client secret) holding the GitHub login and an expiry.
 * Only the owner of GITHUB_REPO, or the logins listed in DASHBOARD_USERS, may sign in.
 */

export const SESSION_COOKIE = 'seo_session';
export const STATE_COOKIE = 'seo_oauth_state';
const SESSION_DAYS = 14;

const read = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

export const oauthConfigured = () => Boolean(read('GITHUB_OAUTH_CLIENT_ID') && read('GITHUB_OAUTH_CLIENT_SECRET'));
export const oauthClientId = () => read('GITHUB_OAUTH_CLIENT_ID')!;
export const oauthClientSecret = () => read('GITHUB_OAUTH_CLIENT_SECRET')!;

/** GitHub logins allowed into the dashboard (lowercase). Defaults to the content repo's owner. */
export function allowedUsers(): string[] {
  const listed = (read('DASHBOARD_USERS') ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  if (listed.length) return listed;
  const owner = read('GITHUB_REPO')?.split('/')[0]?.toLowerCase();
  return owner ? [owner] : [];
}

const key = () => createHmac('sha256', oauthClientSecret()).update('vyb-seo-session-v1').digest();
const sign = (payload: string) => createHmac('sha256', key()).update(payload).digest('base64url');

export function createSession(login: string): { value: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 86400;
  const payload = Buffer.from(JSON.stringify({ login, exp: Math.floor(Date.now() / 1000) + maxAge })).toString('base64url');
  return { value: `${payload}.${sign(payload)}`, maxAge };
}

/** The signed-in GitHub login, or null if the cookie is missing, forged, expired or no longer allowed. */
export function readSession(value: string | undefined): string | null {
  if (!value || !oauthConfigured()) return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { login, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { login?: string; exp?: number };
    if (!login || !exp || exp < Date.now() / 1000) return null;
    return allowedUsers().includes(login.toLowerCase()) ? login : null;
  } catch {
    return null;
  }
}

export const newState = () => randomBytes(16).toString('hex');

/** Only allow redirects back into the dashboard after sign-in. */
export const safeNext = (next: string | null) => (next && /^\/dashboard(\/[\w\-/?=&%.]*)?$/.test(next) ? next : '/dashboard');
