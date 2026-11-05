# Agent notes

**Helping someone use VYB-SEO on their website?** Don't change this codebase. Follow [SETUP.md](SETUP.md):
the work happens in the user's website repo (writing `.seo-agent/config.json` and `.seo-agent/brand.md`),
then deploying this repo, unmodified, to Vercel.

**Working on VYB-SEO itself?** Layout:

- `workflows/seo-run.ts`: the daily run (`"use workflow"`); orchestration only.
- `workflows/steps.ts`: durable steps (`"use step"`): prepare, write, refresh, snippet, interlink, finish, ping.
- `lib/ai/`: provider layer (Anthropic + OpenAI); everything calls `generate()`.
- `lib/github.ts`: the content repo is the storage; atomic commits via the git data API.
- `lib/config.ts`: site config and defaults; `lib/qa.ts` is the quality gate; `lib/audit.ts` the audit and fixes.
- `app/`: dashboard (behind `proxy.ts` basic auth) and `/api/cron`.
- `plugin/`: Claude Code plugin (`/vyb-seo:seo`); `plugin/skills/seo/scripts/seo-tools.mjs` is a dependency-free port
  of the audit, quality gate and similarity logic. Keep its `DEFAULTS`, checks and `stem()` in sync with `lib/`.
- `templates/github-action/`: scheduled workflow for subscription users. `SAFETY.md` documents every guard; update it
  when a guard changes.

Before a PR: `npx tsc --noEmit`, `npm run lint`, `npm run build`. Never commit keys or a real `.env.local`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
