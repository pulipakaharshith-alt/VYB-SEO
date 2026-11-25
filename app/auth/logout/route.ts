import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

export function GET(request: NextRequest) {
  const res = NextResponse.redirect(new URL('/', request.url));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
