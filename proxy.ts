import { NextResponse, type NextRequest } from 'next/server';

/**
 * The dashboard can spend AI credit and commit to your repo, so every page and server action
 * sits behind DASHBOARD_PASSWORD (HTTP Basic auth; any username). The cron route checks
 * CRON_SECRET itself, and Workflow's internal routes are excluded from the matcher.
 */
export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return new NextResponse('Set DASHBOARD_PASSWORD in your Vercel project settings, then redeploy.', { status: 503 });
  }
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const given = decoded.slice(decoded.indexOf(':') + 1);
    if (timingSafeEqual(given, password)) return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="SEO agent", charset="UTF-8"' },
  });
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  matcher: ['/((?!api/cron|_next/static|_next/image|favicon.ico|\\.well-known/workflow/).*)'],
};
