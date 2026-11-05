# Setting up VYB-SEO on a website

This guide is written so an AI coding agent (Claude Code, Cursor, Codex, Copilot, …) can follow it from
start to finish. People can follow it too. The agent does the work inside the **user's website repo**;
the user does the few steps that need their accounts (marked **👤 User**).

> **Prompt to paste into your AI agent**, opened in your website's repo:
>
> Set up the SEO agent from https://github.com/pulipakaharshith-alt/VYB-SEO for this website.
> Follow its SETUP.md: inspect this repo, write `.seo-agent/config.json` and `.seo-agent/brand.md`,
> commit them, then walk me through deploying it to Vercel.

## Choose how it runs

| | **A. Vercel app** | **B. Claude subscription** |
|---|---|---|
| Pays with | Anthropic or OpenAI **API key** (per token) | Your **Claude Pro/Max/Team/Enterprise** plan (usage limits) |
| Runs | Daily, automatically, on Vercel | On demand in Claude Code (`/vyb-seo:seo`), and optionally on a schedule via GitHub Actions |
| Extras | Dashboard, spend cap, Search Console data, enforced claims check | No hosting; claims check and interlinking are instructions Claude follows |
| Setup | Steps 0–8 below | Steps 0–5, then [step 9](#9-claude-subscription-no-api-key) |

Both read the same `.seo-agent/` files, so a site can use either or both. Read [SAFETY.md](SAFETY.md) before the
first run.

---

## 0. Check it fits

VYB-SEO works when the website's blog posts are **Markdown or MDX files with YAML frontmatter
(`---`) in a GitHub repo**, one file per post directly inside one folder.

Confirm before going further:

- [ ] The repo is on GitHub, and the user can push to it.
- [ ] Posts are `.md` or `.mdx` files in a single folder (not `folder/post-slug/index.md`).
- [ ] Frontmatter is YAML between `---` lines (not TOML `+++`).
- [ ] The site deploys automatically when the default branch changes (Vercel, Netlify, Cloudflare Pages, GitHub Pages, …).

If the blog lives in a CMS (WordPress, Webflow, Ghost, Notion…), posts are stored in nested folders, or
file names must carry a date (Jekyll `_posts/YYYY-MM-DD-slug.md`), stop and tell the user it isn't
supported yet.

If the site has no blog yet, create the folder and the post template/route first, using the framework's
usual convention, and make sure the template renders the frontmatter `title` as the page's `<h1>`.
Then continue.

## 1. Inspect the website repo (agent)

Work out these facts. Read the code; don't guess.

| Fact | How to find it | Config field |
|---|---|---|
| Public URL | `package.json` homepage, framework config (`site:` in `astro.config.*`, `baseURL` in `hugo.toml`, `url` in `_config.yml`), `metadataBase`, README, or ask | `site` |
| Posts folder | folder with many `.md`/`.mdx` files, or the content collection/loader the blog route uses | `contentDir` |
| File type | extension of existing posts | `extension` (`md` or `mdx`) |
| Post URL | the blog route, e.g. `app/blog/[slug]/page.tsx` → `/blog/{slug}`, `src/pages/blog/[...slug].astro` → `/blog/{slug}`, Hugo `permalinks` | `urlPattern` (must contain `{slug}`; slug = file name without extension) |
| Frontmatter names | open 2–3 existing posts and the code that reads them | `frontmatter.*` |
| Required extra fields | fields every post has that the build requires (`draft: false`, `author`, `tags: []`, `layout: post`) | `frontmatter.extra` |
| Title suffix | the layout's title template, e.g. Next.js `title.template: '%s | Acme'` → `" | Acme"` | `titleSuffix` |
| Title rendered as H1? | does the post template print the frontmatter title in an `<h1>`? | `templateRendersTitle` |
| Key pages | home, pricing, product/feature pages, signup | `productPages` |
| Broken/private routes | links in posts that 404 or need login, and the public page to send them to | `linkRemaps` |

Common layouts:

| Framework | Usual posts folder | Usual frontmatter |
|---|---|---|
| Next.js (Markdown/MDX) | `content/blog`, `posts`, `src/content/blog` | `title`, `description`/`excerpt`, `date` |
| Astro content collections | `src/content/blog` | `title`, `description`, `pubDate`, `updatedDate` (check `src/content.config.*` for the schema) |
| Hugo | `content/posts`, `content/blog` | `title`, `description`, `date`, `lastmod`, `draft` |
| Eleventy | `posts`, `src/posts` | `title`, `description`, `date`, `tags` |
| Docusaurus blog | `blog` | `title`, `description`, `date`, `authors`, `tags` |

If the content schema validates frontmatter (Astro `z.object`, Contentlayer, Velite), every **required** field
must be covered by `frontmatter.*` or `frontmatter.extra`, or new posts will fail the build.

## 2. Write `.seo-agent/config.json` (agent)

Create it in the **website repo** root. Only include fields that differ from the defaults (shown below);
everything else falls back to them.

```json
{
  "site": "https://example.com",
  "contentDir": "content/blog",
  "extension": "md",
  "urlPattern": "/blog/{slug}",
  "titleSuffix": "",
  "templateRendersTitle": true,
  "frontmatter": {
    "title": "title",
    "description": "description",
    "metaTitle": "",
    "excerpt": "",
    "date": "date",
    "updated": "updated",
    "keyword": "keyword",
    "schema": "",
    "extra": {}
  },
  "productPages": [{ "path": "/", "about": "Home page" }],
  "linkRemaps": {},
  "publish": { "mode": "pr" },
  "safety": { "maxNewPerWeek": 3, "protectTopPages": 10, "minRetainRatio": 0.7, "claimsCheck": true, "maxExternalLinks": 6 },
  "run": { "newArticles": 1, "refreshes": 1, "metaRewrites": 2, "research": true, "maxSpendUsd": 5 },
  "qa": { "minWords": 1200, "maxWords": 4500, "minInternalLinks": 3, "metaTitleMax": 60, "metaDescriptionMin": 110, "metaDescriptionMax": 160 },
  "research": { "hl": "en", "gl": "us", "seeds": [], "picksPerRun": 10 }
}
```

Field notes:

- `frontmatter`: map each role to the field name the blog actually uses. Set a role to `""` to not write it
  (e.g. `"updated": ""` if the blog has no updated date; `"keyword": ""` if you don't want an extra field).
  `metaTitle` and `excerpt` are optional separate fields some blogs use. `schema` names a field your template
  renders as JSON-LD; leave `""` unless the template already supports it.
- `productPages`: 3–12 real, public pages with one-line descriptions. Articles may only link to these, to
  other posts, and to URLs in the live sitemap.
- `research.seeds`: 5–25 short topics the business wants to rank for (what customers search, not brand names).
  Leave empty to only write keywords the user queues by hand.
- `publish.mode`: keep `"pr"` (every run opens a pull request to review) unless the user asks for fully automatic.
- `run.maxSpendUsd`: hard cap per run in USD.
- `safety`: the guard rails (pace cap, protected top pages, refresh shrink limit, claims check, external link
  limit). Keep the defaults for a new site; see [SAFETY.md](SAFETY.md). For a young or small site, set
  `maxNewPerWeek` to 1–2.

## 3. Write `.seo-agent/brand.md` (agent, then 👤 user reviews)

Every article gets this file as context. The agent will **only state product facts written here**, so it must
be true. Build it from the site's own copy (home page, pricing, docs, README), not from assumptions:

```markdown
# <Product> — brand & product notes

## What it is
One paragraph: what it does, for whom, the problem it solves.

## Features
- <Feature>: what it does, in plain words.

## Facts you may state
- Free plan / trial details, supported platforms, integrations: only what the site says publicly.
- Do not quote prices unless they rarely change.

## Audience
Who reads the blog and what they're trying to get done.

## Voice
e.g. Direct, warm, practical. Short sentences. No hype.

## Hard rules
- Never invent statistics, studies or quotes.
- Never promise results.
- Never claim features not listed above.
- <Anything legal/compliance-sensitive: medical, financial, competitor claims>
```

Show it to the user and ask them to correct anything wrong.

## 4. Optional: seed the queue (agent)

To control the first articles, create `.seo-agent/queue.json`:

```json
[
  { "slug": "how-to-write-an-invoice", "keyword": "how to write an invoice", "title": "How to Write an Invoice (With a Free Template)", "priority": 90, "status": "pending" }
]
```

Higher `priority` is written first. Skip topics an existing post already covers.

## 5. Commit (agent)

Commit `.seo-agent/` to the website repo's default branch (or open a PR for it, if that's how the user works)
and push.

Optional, if the website deploys on Vercel: the agent commits bookkeeping files in `.seo-agent/` daily. To stop
those commits from triggering a website rebuild, set the website project's **Ignored Build Step** to:
`git diff HEAD^ HEAD --quiet -- . ':!.seo-agent'`

## 6. Credentials (👤 user)

The agent cannot create these; ask the user to:

1. **GitHub token:** github.com → Settings → Developer settings → Personal access tokens → **Fine-grained
   tokens** → Generate. Repository access: **only the website repo**. Permissions: **Contents: Read and write**,
   **Pull requests: Read and write**.
2. **AI key:** an Anthropic API key (console.anthropic.com) **or** an OpenAI API key (platform.openai.com).
3. Pick a **dashboard password**, and generate a **cron secret**: `openssl rand -hex 32`.

Never paste these into the website repo, a commit, or a chat log you don't control.

## 7. Deploy VYB-SEO to Vercel

**Option A, 👤 user, easiest:** click **Deploy with Vercel** in the
[README](https://github.com/pulipakaharshith-alt/VYB-SEO#readme), enter `GITHUB_REPO` (`owner/name` of the
website repo), `GITHUB_TOKEN`, `DASHBOARD_PASSWORD` and `CRON_SECRET`. Then in Vercel → the new project →
Settings → Environment Variables add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, and redeploy.

**Option B, agent with the Vercel CLI** (the user must be logged in: `npx vercel login`). Do this in a
separate folder, not inside the website repo:

```bash
git clone https://github.com/pulipakaharshith-alt/VYB-SEO seo-agent && cd seo-agent
npx vercel link --yes                      # creates a new Vercel project
npx vercel env add GITHUB_REPO production  # paste owner/name of the website repo
npx vercel env add GITHUB_TOKEN production
npx vercel env add DASHBOARD_PASSWORD production
npx vercel env add CRON_SECRET production
npx vercel env add ANTHROPIC_API_KEY production   # or OPENAI_API_KEY
npx vercel --prod
```

Let the user type secret values into the prompts themselves. The daily schedule (Vercel Cron, in
`vercel.json`) only runs on production deployments.

Optional variables (Search Console, IndexNow, model and price overrides) are listed in
[`.env.example`](.env.example).

## 8. Verify and first run

1. Open the deployment URL. Log in with any username and the dashboard password.
2. **Overview** shows a setup checklist: everything required should be ✓. If "GitHub repo" fails, the token
   lacks access or permissions.
3. **Settings** should show the config and brand notes committed in steps 2–3.
4. **Audit** lists issues in existing posts. Broken links and missing descriptions found here are worth fixing.
5. Back on **Overview**, set *New articles* to 1 and click **Start run**. A run takes a few minutes. A pull
   request appears in the website repo with the article and a report.
6. Check the PR's preview deployment: the new post must render, and the build must pass. If it fails, the usual
   cause is a required frontmatter field missing from `frontmatter.extra`; fix `config.json` and run again.

After that, it runs every day on its own.

## 9. Claude subscription (no API key)

Uses Claude Code with your Claude plan instead of an API key. Do steps 0–5 first (the settings files).

**Install the plugin** (in Claude Code, opened in the website repo):

```
/plugin marketplace add pulipakaharshith-alt/VYB-SEO
/plugin install vyb-seo@vyb-seo-marketplace
```

(Claude Code 2.1.275+ can do it in one line: `/plugin install vyb-seo --marketplace pulipakaharshith-alt/vyb-seo`.)

Without plugins, copy the folder `plugin/skills/seo/` from this repo into the website repo as `.claude/skills/seo/`;
the command is then `/seo` instead of `/vyb-seo:seo`.

**Use it:**

| Command | Does |
|---|---|
| `/vyb-seo:seo run` | Full cycle: fixes, research, refresh, new articles (within the pace cap), report, pull request |
| `/vyb-seo:seo write <keyword>` | One new article on that keyword |
| `/vyb-seo:seo refresh <slug>` | Improve one existing post |
| `/vyb-seo:seo audit` | Report problems without changing anything |
| `/vyb-seo:seo research` | Find and queue new keywords |
| `/vyb-seo:seo setup` | Write the settings files (steps 1–5) for a new site |

Every article must pass the bundled checker (`scripts/seo-tools.mjs check`) before it's committed, and work
always lands on a `seo-agent/…` branch with a pull request, never the default branch.

**On a schedule (GitHub Actions):**

1. 👤 In Claude Code run `/install-github-app` (installs the Claude GitHub App on the repo), or install it from
   https://github.com/apps/claude.
2. 👤 Run `claude setup-token` on your computer, then add the printed token as the repo secret
   `CLAUDE_CODE_OAUTH_TOKEN` (Settings → Secrets and variables → Actions). Don't also set `ANTHROPIC_API_KEY`.
3. Agent: copy [`templates/github-action/seo-agent.yml`](templates/github-action/seo-agent.yml) to the website repo at
   `.github/workflows/seo-agent.yml` and commit it to the default branch.
4. 👤 Actions → **SEO agent (Claude Code)** → Run workflow, to test once. A pull request should appear.

Notes: runs count against your plan's usage limits (default schedule is twice a week); the token is tied to the
account that created it and lasts a year; check Anthropic's current terms for automated use on your plan.
Scheduled workflows on public repos pause after 60 days without repo activity.

## Optional upgrades

- **Search Console:** the agent then picks pages to refresh by real ranking data and rewrites titles of pages
  that get impressions but no clicks. Create a Google Cloud service account, enable *Google Search Console API*,
  create a JSON key, add the service account email as a user (Restricted) on the Search Console property, and set
  `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` (the key's `private_key` value) in Vercel.
- **IndexNow (Bing, Yandex):** pick a random 32-character key, set `INDEXNOW_KEY`, and add a file
  `<key>.txt` containing the key to the website's public folder so it's served at `https://site/<key>.txt`.
- **Pause:** set `AGENT_PAUSED=1` in Vercel to stop the daily run.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Dashboard says "Set DASHBOARD_PASSWORD" | add it in Vercel and redeploy |
| "GitHub 404" on the checklist | `GITHUB_REPO` is wrong, or the token doesn't include that repo |
| "GitHub 403" when a run commits | token needs Contents + Pull requests **write** |
| Run starts but no PR | check the report in `.seo-agent/reports/`: every draft may have failed the quality check (see "Not published") or the spend cap was reached |
| New post breaks the website build | a required frontmatter field is missing; add it to `frontmatter.extra` |
| Articles link to the wrong places | fix `productPages`; make sure the site has a `/sitemap.xml` |
| Articles say untrue things about the product | correct `brand.md`; the agent only uses facts written there |
