'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { start } from 'workflow/api';
import { DEFAULT_CONFIG, loadQueue, PATHS, type QueueItem, type SiteConfig } from '@/lib/config';
import { slugify } from '@/lib/content';
import { commitFiles } from '@/lib/github';
import { seoRun } from '@/workflows/seo-run';

// Every action is reachable by anyone who can POST to the dashboard; proxy.ts requires the
// dashboard password first, and each action still validates its own input.

const int = (v: FormDataEntryValue | null, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : undefined;
};

export async function runNow(form: FormData) {
  const run = await start(seoRun, [
    {
      trigger: 'manual',
      newArticles: int(form.get('newArticles'), 0, 10),
      refreshes: int(form.get('refreshes'), 0, 10),
      metaRewrites: int(form.get('metaRewrites'), 0, 20),
    },
  ]);
  redirect(`/?run=${encodeURIComponent(run.runId)}`);
}

export async function saveSettings(form: FormData) {
  const configText = String(form.get('config') ?? '');
  const brand = String(form.get('brand') ?? '');
  let parsed: Partial<SiteConfig>;
  try {
    parsed = JSON.parse(configText);
  } catch (e) {
    redirect(`/settings?error=${encodeURIComponent(`Config is not valid JSON: ${(e as Error).message}`)}`);
  }
  if (!parsed.site || !/^https?:\/\//.test(parsed.site)) redirect(`/settings?error=${encodeURIComponent('"site" must be your full URL, e.g. https://example.com')}`);
  if (!parsed.contentDir) redirect(`/settings?error=${encodeURIComponent('"contentDir" is required')}`);
  if (!parsed.urlPattern?.includes('{slug}')) redirect(`/settings?error=${encodeURIComponent('"urlPattern" must contain {slug}')}`);
  await commitFiles(
    { [PATHS.config]: JSON.stringify(parsed, null, 2) + '\n', [PATHS.brand]: brand.trim() + '\n' },
    'SEO agent: update settings',
  );
  revalidatePath('/', 'layout');
  redirect('/settings?saved=1');
}

export async function createDefaults() {
  await commitFiles({ [PATHS.config]: JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n' }, 'SEO agent: initial settings');
  revalidatePath('/', 'layout');
  redirect('/settings');
}

async function saveQueue(queue: QueueItem[], message: string) {
  await commitFiles({ [PATHS.queue]: JSON.stringify(queue, null, 2) + '\n' }, message);
  revalidatePath('/queue');
}

export async function addKeyword(form: FormData) {
  const keyword = String(form.get('keyword') ?? '').trim().toLowerCase().slice(0, 120);
  const title = String(form.get('title') ?? '').trim().slice(0, 120) || keyword;
  if (!keyword) return;
  const queue = await loadQueue();
  const slug = slugify(title);
  if (!slug || queue.some((k) => k.slug === slug)) redirect(`/queue?error=${encodeURIComponent('That keyword is already queued')}`);
  queue.push({ slug, keyword, title, priority: int(form.get('priority'), 1, 100) ?? 70, source: 'manual', status: 'pending', addedAt: new Date().toISOString() });
  await saveQueue(queue, `SEO agent: queue "${keyword}"`);
}

export async function updateKeyword(form: FormData) {
  const slug = String(form.get('slug') ?? '');
  const op = String(form.get('op') ?? '');
  const queue = await loadQueue();
  const item = queue.find((k) => k.slug === slug);
  if (!item) return;
  if (op === 'priority') item.priority = int(form.get('priority'), 1, 100) ?? item.priority;
  else if (op === 'skip') Object.assign(item, { status: 'skipped', note: 'skipped from dashboard' });
  else if (op === 'requeue') Object.assign(item, { status: 'pending', note: undefined });
  else if (op === 'delete') queue.splice(queue.indexOf(item), 1);
  else return;
  await saveQueue(queue, `SEO agent: ${op} "${item.keyword}"`);
}
