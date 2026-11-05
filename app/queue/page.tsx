import { addKeyword, updateKeyword } from '../actions';
import { Badge, Button, Card, attempt, ErrorBox, Notice } from '../ui';
import { loadQueue, pendingByPriority, type QueueItem } from '@/lib/config';

const tone = (s: QueueItem['status']) => (s === 'done' ? 'ok' : s === 'failed' ? 'bad' : s === 'pending' || s === 'writing' ? 'warn' : 'muted');

export default async function QueuePage({ searchParams }: PageProps<'/queue'>) {
  const sp = await searchParams;
  const r = await attempt(async () => {
    const queue = await loadQueue();
    const pending = pendingByPriority(queue);
    const rest = queue.filter((k) => k.status !== 'pending').sort((a, b) => (b.doneAt ?? b.addedAt ?? '').localeCompare(a.doneAt ?? a.addedAt ?? ''));
    return { pending, rest };
  });
  if (!r.ok) return <ErrorBox error={r.error} />;
  const { pending, rest } = r.data;
  return (
    <div className="space-y-6">
      {typeof sp.error === 'string' && <Notice tone="bad">{sp.error}</Notice>}
      <Card title="Add a keyword">
        <form action={addKeyword} className="flex flex-wrap items-end gap-3 text-sm">
          <label className="grid flex-1 gap-1">
            <span className="text-muted">Keyword (the search query)</span>
            <input name="keyword" required maxLength={120} placeholder="how to write a cold email" />
          </label>
          <label className="grid flex-1 gap-1">
            <span className="text-muted">Working title (optional)</span>
            <input name="title" maxLength={120} placeholder="How to Write a Cold Email That Gets Replies" />
          </label>
          <label className="grid gap-1">
            <span className="text-muted">Priority</span>
            <input name="priority" type="number" min={1} max={100} defaultValue={70} className="w-20" />
          </label>
          <Button type="submit">Add</Button>
        </form>
      </Card>

      <Card title={`Pending (${pending.length})`}>
        {pending.length ? (
          <ul className="divide-y divide-line">
            {pending.map((k) => (
              <li key={k.slug} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{k.keyword}</div>
                  <div className="truncate text-xs text-muted">
                    {k.title}
                    {k.why ? ` · ${k.why}` : ''}
                    {k.source ? ` · ${k.source}` : ''}
                  </div>
                </div>
                <form action={updateKeyword} className="flex items-center gap-2">
                  <input type="hidden" name="slug" value={k.slug} />
                  <input type="hidden" name="op" value="priority" />
                  <input name="priority" type="number" min={1} max={100} defaultValue={k.priority ?? 40} className="w-20" aria-label="priority" />
                  <Button variant="ghost" type="submit">Set</Button>
                </form>
                <form action={updateKeyword}>
                  <input type="hidden" name="slug" value={k.slug} />
                  <input type="hidden" name="op" value="skip" />
                  <Button variant="ghost" type="submit">Skip</Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing pending. Each run’s research step adds keywords when Settings has research seeds.</p>
        )}
      </Card>

      <Card title="History">
        {rest.length ? (
          <ul className="divide-y divide-line">
            {rest.slice(0, 100).map((k) => (
              <li key={k.slug} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <Badge tone={tone(k.status)}>{k.status}</Badge>
                <span className="flex-1">{k.keyword}</span>
                {k.note && <span className="max-w-md truncate text-xs text-muted">{k.note}</span>}
                {(k.status === 'failed' || k.status === 'skipped') && (
                  <form action={updateKeyword}>
                    <input type="hidden" name="slug" value={k.slug} />
                    <input type="hidden" name="op" value="requeue" />
                    <Button variant="ghost" type="submit">Requeue</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No history yet.</p>
        )}
      </Card>
    </div>
  );
}
