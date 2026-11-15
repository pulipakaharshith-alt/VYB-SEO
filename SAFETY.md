# Safety: what can go wrong, and how VYB-SEO limits it

VYB-SEO publishes AI-written content to a real website. Most of the risks are about **search rankings**,
**accuracy**, and **access**. Below: each risk, what the tool already does about it, and what you should do.
"Enforced" means code blocks it; "guided" means the model is instructed but you should still check.

## 1. Google treats it as scaled, low-value AI content

Mass-produced pages written mainly to rank can be demoted under Google's spam policies, sometimes **site-wide**.
This is the biggest risk.

| Guard | How |
|---|---|
| Publishing pace cap | **Enforced.** `safety.maxNewPerWeek` (default **3**) counts new articles from the last 7 days, including ones waiting in open PRs. Applies to the Vercel app and the Claude Code plugin. |
| One topic, one page | **Enforced.** Keywords that overlap an existing post are skipped (`qa.cannibalizationThreshold`); a new draft whose keyword overlaps a post fails the check. |
| Usefulness first | **Guided.** Every article starts from live research on what currently ranks and must beat it: answer first, concrete examples, FAQ. |
| Quality floor | **Enforced.** Minimum length, real structure, FAQ, a limit on filler phrases, and no thin drafts. |

**You should:** start at 1–3 new posts a week. Raise `maxNewPerWeek` only after Search Console shows the new
posts getting indexed and impressions. Prefer refreshes over new posts once the queue thins out.
Don't switch to `publish.mode: "direct"` until you've merged a few weeks of PRs you were happy with.

## 2. Wrong or invented facts

| Guard | How |
|---|---|
| Single source of product truth | **Guided.** The model may only state product facts written in `.seo-agent/brand.md`. |
| Claims check | **Enforced** in the Vercel app: a second AI pass compares each draft to the brand notes. Unsupported product claims, uncited statistics or studies, guarantees, attacks on competitors, and medical, legal or financial advice stated as fact send the draft back for revision. Borderline items go in the report under "check:". In the Claude Code plugin, the same review runs as a separate subagent (guided). |
| Red-flag warnings | **Enforced.** Reports flag percentage claims, "studies show" and "guarantee" for a human. |
| External links | **Enforced.** At most `safety.maxExternalLinks` (default 6), https only, and every external domain is listed in the report to verify. |

**You should:** keep `brand.md` accurate and specific, including what the product does *not* do. Read
each PR. In regulated topics (health, finance, legal), have a qualified person review before merging, or don't
use the agent for those topics.

## 3. A refresh makes a good page worse

| Guard | How |
|---|---|
| Top pages are off-limits | **Enforced.** The `safety.protectTopPages` pages with the most Search Console clicks (default 10) are never rewritten. |
| No gutting | **Enforced.** A refresh must keep at least `safety.minRetainRatio` (default 70%) of the original word count. |
| Frontmatter preserved | **Enforced.** A refresh keeps every existing frontmatter field (tags, images, authors, draft state) and only updates title, description, updated date and body. |
| Cooldown | **Enforced.** A page isn't refreshed again for 75 days, or titles rewritten within 45 days. |
| Only pages that need it | With Search Console, refreshes target pages ranking 5–20 or losing clicks; without it, the oldest posts. |

**You should:** connect Search Console (refreshes are much better targeted with it). Review refresh diffs in
the PR, and if a refreshed page drops in rankings, revert that file.

## 4. The site breaks

| Guard | How |
|---|---|
| Valid files only | **Enforced.** Every generated file is re-parsed before commit: frontmatter must parse and have a title, description and date. |
| Required fields | `frontmatter.extra` adds fields your build requires to every new post, and the Claude Code check fails a post that's missing them. |
| Scope | **Enforced.** Writes only touch your posts folder and `.seo-agent/`, never code, templates or config. |
| Review gate | Every run is a pull request by default. Your host's preview deployment shows the build result before merge. |
| Links | **Enforced.** Internal links must point to a real page (live sitemap, posts, configured pages). |

**You should:** keep branch protection on your default branch and require the preview build to pass.

## 5. Access and secrets

| Guard | How |
|---|---|
| Least-privilege token | Use a fine-grained GitHub token for **only** the website repo, with Contents and Pull requests write. Nothing else. |
| Dashboard locked | **Enforced.** Every dashboard page and action requires `DASHBOARD_PASSWORD`; the cron route requires `CRON_SECRET`. |
| Keys stay yours | Keys live only in your Vercel env vars or GitHub secrets. The code never logs or commits them. |
| Prompt injection | **Guided + enforced.** Web pages are treated as untrusted data in prompts; external link limits and the claims check catch injected links or claims. |

**You should:** use a long random dashboard password, rotate the GitHub token yearly (the Claude subscription
token from `claude setup-token` also expires after a year), and revoke both if you stop using the agent.

## 6. Costs

| Guard | How |
|---|---|
| Spend cap | **Enforced** (Vercel app): each run stops at `run.maxSpendUsd` (default $5) and publishes what it finished. |
| Visibility | The dashboard shows spend per run and per month; reports show it per step. |
| Pause | Set `AGENT_PAUSED=1` in Vercel to stop the daily run without removing anything. |
| DataForSEO | **Enforced.** Every DataForSEO call's reported cost is added to the run's spend and stops it at the cap. AI-visibility checks run at most every `everyDays` (default 7), up to 10 prompts. AI-answer calls are never retried, because a retry could be billed twice. |

**Claude subscription mode** doesn't bill per token, but runs count against your plan's usage limits. The
scheduled Action runs twice a week by default for that reason.

## 7. Undoing things

- Every run is one pull request: **close it** to discard the run, or **revert** the merge to undo it.
- Each step is its own commit on the run's branch, so you can drop a single article or refresh.
- The queue and history are plain JSON in `.seo-agent/` and can be edited by hand.

## Subscription mode: things to know

- The Claude Code plugin and the GitHub Action use your Claude Pro/Max/Team/Enterprise subscription. Anthropic's
  docs describe the `claude setup-token` token for GitHub Actions; check Anthropic's current terms for automated
  use on your plan before scheduling it.
- The token belongs to whoever created it. Use your own account, on your own repo.
- In subscription mode, the quality gate runs as a script (enforced), but the claims check and interlinking are
  instructions Claude follows (guided). Review PRs a little more carefully than with the Vercel app.

## Recommended starting settings

```json
{
  "publish": { "mode": "pr" },
  "safety": { "maxNewPerWeek": 2, "protectTopPages": 10, "minRetainRatio": 0.7, "claimsCheck": true, "maxExternalLinks": 6 },
  "run": { "newArticles": 1, "refreshes": 1, "metaRewrites": 2, "research": true, "maxSpendUsd": 3 }
}
```
