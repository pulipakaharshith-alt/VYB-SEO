import { env } from './env';

/**
 * Minimal GitHub REST client. The content repo is the agent's only storage: posts, the keyword
 * queue, settings and reports are files in it. Writes are single atomic commits (git data API).
 */

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function gh<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (!env.githubToken || !env.githubRepo) throw new GitHubError(0, 'GITHUB_TOKEN and GITHUB_REPO must be set');
  const url = path.startsWith('http') ? path : `${env.githubApi}/repos/${env.githubRepo}${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'vyb-seo-agent',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      cache: 'no-store',
    });
    if (res.status >= 500 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new GitHubError(res.status, `GitHub ${res.status} on ${path}: ${body?.message ?? res.statusText}`);
    return body as T;
  }
}

let defaultBranch: string | null = null;
export async function baseBranch(): Promise<string> {
  if (env.githubBranch) return env.githubBranch;
  if (!defaultBranch) defaultBranch = (await gh<{ default_branch: string }>('')).default_branch;
  return defaultBranch;
}

export interface TreeEntry {
  path: string;
  sha: string;
  type: 'blob' | 'tree';
  size?: number;
}

/** Every file path in the branch (recursive). */
export async function listFiles(ref?: string): Promise<TreeEntry[]> {
  const branch = ref ?? (await baseBranch());
  const tree = await gh<{ tree: TreeEntry[]; truncated: boolean }>(`/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  return tree.tree.filter((e) => e.type === 'blob');
}

export async function readBlob(sha: string): Promise<string> {
  const blob = await gh<{ content: string; encoding: string }>(`/git/blobs/${sha}`);
  return Buffer.from(blob.content, blob.encoding as BufferEncoding).toString('utf-8');
}

/** Read one file, or null when it doesn't exist. */
export async function readFile(path: string, ref?: string): Promise<string | null> {
  const branch = ref ?? (await baseBranch());
  try {
    const f = await gh<{ content: string; encoding: string }>(
      `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
    );
    return Buffer.from(f.content, (f.encoding || 'base64') as BufferEncoding).toString('utf-8');
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

/** Read many blobs in parallel (bounded). */
export async function readMany(entries: TreeEntry[], concurrency = 12): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let i = 0;
  const worker = async () => {
    while (i < entries.length) {
      const e = entries[i++];
      out.set(e.path, await readBlob(e.sha));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  return out;
}

async function headSha(branch: string): Promise<string> {
  const ref = await gh<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

/** Create `name` from the tip of the base branch (no-op if it already exists). */
export async function createBranch(name: string): Promise<void> {
  const sha = await headSha(await baseBranch());
  try {
    await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${name}`, sha }) });
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 422)) throw e; // 422 = already exists
  }
}

/** One atomic commit of `files` (path → content) on `branch`. Defaults to the base branch. */
export async function commitFiles(files: Record<string, string>, message: string, branch?: string): Promise<string | null> {
  if (!Object.keys(files).length) return null;
  const target = branch ?? (await baseBranch());
  for (let attempt = 0; ; attempt++) {
    const parent = await headSha(target);
    const parentCommit = await gh<{ tree: { sha: string } }>(`/git/commits/${parent}`);
    const tree = await gh<{ sha: string }>('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: parentCommit.tree.sha,
        tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
      }),
    });
    const commit = await gh<{ sha: string }>('/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }),
    });
    try {
      await gh(`/git/refs/heads/${encodeURIComponent(target)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
      return commit.sha;
    } catch (e) {
      // Someone pushed in between (not a fast-forward): rebuild on the new tip.
      if (e instanceof GitHubError && e.status === 422 && attempt < 3) continue;
      throw e;
    }
  }
}

/** Files changed on `branch` compared with the base branch. */
export async function changedOnBranch(branch: string): Promise<string[]> {
  const cmp = await gh<{ files?: { filename: string; status: string }[] }>(
    `/compare/${encodeURIComponent(await baseBranch())}...${encodeURIComponent(branch)}`,
  );
  return (cmp.files ?? []).filter((f) => f.status !== 'removed').map((f) => f.filename);
}

export async function openPull(branch: string, title: string, body: string): Promise<{ url: string; number: number }> {
  const pr = await gh<{ html_url: string; number: number }>('/pulls', {
    method: 'POST',
    body: JSON.stringify({ title, head: branch, base: await baseBranch(), body: body.slice(0, 60000) }),
  });
  return { url: pr.html_url, number: pr.number };
}

/** Merge `branch` into the base branch (direct mode), then delete it. */
export async function mergeAndDelete(branch: string, message: string): Promise<void> {
  await gh('/merges', { method: 'POST', body: JSON.stringify({ base: await baseBranch(), head: branch, commit_message: message }) });
  await deleteBranch(branch);
}

export async function deleteBranch(branch: string): Promise<void> {
  await gh(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'DELETE' }).catch(() => null);
}

export interface PullSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  mergedAt: string | null;
  createdAt: string;
  branch: string;
}

/** The agent's pull requests (branches starting with "seo-agent/"). */
export async function agentPulls(state: 'open' | 'closed' | 'all' = 'all'): Promise<PullSummary[]> {
  const pulls = await gh<
    { number: number; title: string; html_url: string; state: string; merged_at: string | null; created_at: string; head: { ref: string } }[]
  >(`/pulls?state=${state}&per_page=50&sort=created&direction=desc`);
  return pulls
    .filter((p) => p.head.ref.startsWith('seo-agent/'))
    .map((p) => ({ number: p.number, title: p.title, url: p.html_url, state: p.state, mergedAt: p.merged_at, createdAt: p.created_at, branch: p.head.ref }));
}

/** Files a pull request added or modified. */
export async function pullFiles(number: number): Promise<string[]> {
  const files = await gh<{ filename: string; status: string }[]>(`/pulls/${number}/files?per_page=100`);
  return files.filter((f) => f.status !== 'removed').map((f) => f.filename);
}

/** Who the token belongs to and whether it can push, for the setup screen. */
export async function checkAccess(): Promise<{ ok: boolean; detail: string }> {
  try {
    const repo = await gh<{ full_name: string; permissions?: { push?: boolean }; default_branch: string }>('');
    if (repo.permissions && !repo.permissions.push) return { ok: false, detail: `token can read ${repo.full_name} but not push` };
    return { ok: true, detail: `${repo.full_name} (${env.githubBranch ?? repo.default_branch})` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
