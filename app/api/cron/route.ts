import { start } from 'workflow/api';
import { env } from '@/lib/env';
import { seoRun } from '@/workflows/seo-run';

/** Daily trigger from Vercel Cron (see vercel.json). Vercel sends CRON_SECRET as a bearer token. */
export async function GET(request: Request) {
  const secret = env.cronSecret;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (process.env.AGENT_PAUSED === '1') return Response.json({ skipped: 'AGENT_PAUSED=1' });
  const run = await start(seoRun, [{ trigger: 'cron' }]);
  return Response.json({ runId: run.runId });
}
