# VYB-SEO

Open-source AI SEO agent. It researches keywords, writes and refreshes articles, fixes what's broken,
adds internal links, and publishes to your repo on a schedule. Deploy it to Vercel with your own
Anthropic **or** OpenAI API key. No database, no account, nothing hosted by anyone else.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpulipakaharshith-alt%2FVYB-SEO&env=GITHUB_REPO,GITHUB_TOKEN,DASHBOARD_PASSWORD,CRON_SECRET&envDescription=Your%20content%20repo%2C%20a%20token%20that%20can%20push%20to%20it%2C%20a%20dashboard%20password%20and%20a%20random%20cron%20secret.%20Add%20ANTHROPIC_API_KEY%20or%20OPENAI_API_KEY%20after%20deploying.&envLink=https%3A%2F%2Fgithub.com%2Fpulipakaharshith-alt%2FVYB-SEO%23setup&project-name=seo-agent)

It works with any site whose blog is Markdown or MDX in a GitHub repo: Next.js, Astro, Hugo, Eleventy,
Docusaurus and so on.

## Set it up with your AI agent

Open your **website's** repo in Claude Code, Cursor, Codex or any coding agent and paste:

```
Set up the SEO agent from https://github.com/pulipakaharshith-alt/VYB-SEO for this website.
Follow its SETUP.md: inspect this repo, write .seo-agent/config.json and .seo-agent/brand.md,
commit them, then walk me through deploying it to Vercel.
```

The agent reads your blog, works out the folder, URL pattern and frontmatter fields, drafts your brand
notes from your site's own copy, and commits the settings. You then create a GitHub token and an AI key
and deploy. Prefer doing it by hand? Follow [SETUP.md](SETUP.md) yourself, or the short version below.

## What it does every day

1. **Audit** your posts: broken and login-walled links, duplicate H1s, title and description lengths,
   thin and stale posts, orphans, keyword cannibalization.
2. **Fix** the mechanical problems without changing any wording: remap bad links, drop a duplicate body
   H1, strip a doubled title suffix.
3. **Read Search Console** (optional): queries at positions 5–20, page-one pages nobody clicks, pages
   losing traffic.
4. **Research** new topics: expand your seed topics through Google Autocomplete and add Search Console
   queries you get impressions for but don't target. It drops anything you already cover, and the model
   ranks the rest for fit.
5. **Refresh** the pages closest to page one. It searches the live results first, then rewrites to beat
   them, keeping the URL and publish date.
6. **Rewrite snippets**: new title and description for pages that rank but don't get clicked.
7. **Write** new articles from the top of the queue: research brief from live web search, then a draft,
   then the **quality gate**, with up to two revisions. A draft that still fails isn't published.
8. **Interlink**: add a link to each new article from its three most related posts.
9. **Publish** as a pull request you merge (default) or straight to your branch, with a report.
   Once the URLs are live, it notifies IndexNow and Google.

### Quality gate

Every article has to pass, or it isn't published:

- frontmatter complete;
- title fits with your site's suffix, and the description is 110–160 characters;
- no H1 in the body when your template renders the title;
- at least the minimum word count;
- internal links only to pages that exist (your live sitemap + posts + configured pages);
- an FAQ section;
- not too many filler phrases ("delve", "game-changer", "in today's world").

The report flags percentage claims, "studies show" and missing keywords for a human to check.

## How it works

- **Vercel Workflows** run each step (research, brief, draft, revise, publish) as its own durable
  invocation, so a slow model call never hits a function timeout and a failure resumes from the
  last finished step.
- **Your content repo is the storage.** Each run works on its own branch `seo-agent/<date>-<id>`, and every
  step commits there as it finishes. Settings, brand notes, the keyword queue, state and reports live in
  `.seo-agent/` in your repo, so you can read, edit and version them like any other file.
- **Vercel Cron** starts a run daily. The dashboard can start one any time.

```
your-website/                    ← the repo GITHUB_REPO points at
├── content/blog/*.md            ← articles (folder is configurable)
└── .seo-agent/
    ├── config.json              ← site settings (edit in the dashboard)
    ├── brand.md                 ← product facts and voice sent with every article
    ├── queue.json               ← keywords waiting to be written
    ├── state.json               ← what was refreshed when, past runs, spend
    └── reports/<date>.md        ← one report per run
```

## Setup

1. **Deploy** with the button above (or fork and import the repo in Vercel).
2. **Environment variables** (Vercel → Project → Settings → Environment Variables), then redeploy:

   | Variable | Required | What |
   |---|---|---|
   | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | yes | your own key; set both to split work with `AI_PROVIDER` / `AI_PLANNER_PROVIDER` |
   | `GITHUB_REPO` | yes | the repo with your blog, `owner/name` |
   | `GITHUB_TOKEN` | yes | fine-grained token for that repo only: **Contents** read & write, **Pull requests** read & write |
   | `DASHBOARD_PASSWORD` | yes | protects the dashboard and its actions |
   | `CRON_SECRET` | yes | random string (`openssl rand -hex 32`); Vercel Cron uses it to start the daily run |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` | no | Search Console data and Google indexing pings |
   | `INDEXNOW_KEY` | no | Bing/Yandex instant indexing; your site must serve `/<key>.txt` |

   The full list, including model and price overrides, is in [`.env.example`](.env.example).
3. **Open the dashboard** (your Vercel URL; any username, your `DASHBOARD_PASSWORD`). Go to **Settings**,
   point it at your blog, and save:
   - `site`, `contentDir`, `urlPattern` (e.g. `/blog/{slug}`), `extension`;
   - `frontmatter`: the field names your blog reads (`title`, `description`, `date`, …). Leave a name
     empty to skip that field. `extra` is added to every new post (e.g. `"draft": false`);
   - `titleSuffix`: what your layout appends to titles, so lengths are judged correctly;
   - `productPages`: pages articles may link to and mention;
   - `research.seeds`: the topics your blog should own;
   - `run`: how much each run does and the per-run spend cap.

   Then fill in **brand notes** with what the product is, its features, facts that are safe to publish, the
   audience and the voice. The agent only states product facts written there.
4. **Start a run** from the overview, or wait for the daily cron. Review the pull request and merge.

**Search Console (recommended).** Create a Google Cloud service account, enable the *Google Search
Console API* (and *Web Search Indexing API* for pings), download a JSON key, and add the service account
email as a user (Restricted is enough) on your Search Console property. Put its `client_email` and
`private_key` in the two Google variables.

**Optional:** in your *website's* Vercel project, set an Ignored Build Step so the agent's bookkeeping
commits don't trigger deploys:
`git diff HEAD^ HEAD --quiet -- . ':!.seo-agent'`

## Cost

You pay your AI provider directly. With the default models, a new article costs very roughly
$0.50–1.00 (brief with web search, draft, maybe a revision, interlinks), a refresh about the same, and
a snippet rewrite a few cents. Each run stops at the spend cap (`run.maxSpendUsd`, default $5) and
publishes what it finished. The dashboard shows spend per run and per month. Cost figures for OpenAI
models are estimates; set `OPENAI_PRICE_IN` / `OPENAI_PRICE_OUT` to your actual rates.

Vercel's Hobby plan runs it, and its once-a-day cron limit fits the daily schedule. Pro gives steps more
time, which helps with long articles.

## Development

```bash
npm install
cp .env.example .env.local   # fill in at least an AI key and the GitHub settings
npm run dev                  # dashboard on http://localhost:3000
npx workflow web             # inspect workflow runs locally
```

`npm run lint`, `npx tsc --noEmit` and `npm run build` should all pass before a PR.

## Notes and limits

- YAML frontmatter only (`---`), not TOML (`+++`).
- Posts must sit directly in `contentDir` (one file per post, no per-post folders yet).
- The Google Indexing API is officially for job and livestream pages; for articles it's best-effort.
  Your sitemap's `lastmod` is the main signal.
- Mass-publishing AI content can hurt a site. Keep the pace modest (a few posts a week to start),
  keep brand notes accurate, and review the pull requests.

## License

MIT
