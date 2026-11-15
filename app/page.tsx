import Link from 'next/link';
import { CopyBlock } from './copy-block';

const REPO = 'https://github.com/pulipakaharshith-alt/VYB-SEO';
const DEPLOY =
  'https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpulipakaharshith-alt%2FVYB-SEO&env=GITHUB_REPO,GITHUB_TOKEN,DASHBOARD_PASSWORD,CRON_SECRET&envDescription=Your%20content%20repo%2C%20a%20token%20that%20can%20push%20to%20it%2C%20a%20dashboard%20password%20and%20a%20random%20cron%20secret.%20Add%20ANTHROPIC_API_KEY%20or%20OPENAI_API_KEY%20after%20deploying.&envLink=https%3A%2F%2Fgithub.com%2Fpulipakaharshith-alt%2FVYB-SEO%23setup&project-name=seo-agent';

const STEPS = [
  { title: 'Audit', desc: 'Broken and login-walled links, duplicate H1s, thin and stale posts, orphans, keyword cannibalization.' },
  { title: 'Research', desc: 'Expands your topics through Google Autocomplete and Search Console, and drops anything you already cover.' },
  { title: 'Write & refresh', desc: 'Researches what currently ranks, then writes a new post or improves one close to page one.' },
  { title: 'Quality gate', desc: 'Real internal links only, an FAQ, no filler, length and title checks, and a claims check against your brand notes.' },
  { title: 'Interlink', desc: 'Adds a link to each new post from its most related existing posts.' },
  { title: 'Pull request', desc: 'Everything lands as a PR with a report. You merge; it pings search engines once the posts are live.' },
];

const SAFETY = [
  'At most 3 new posts a week by default',
  'Every change is a pull request you review',
  'Your most-clicked pages are never rewritten',
  'A refresh can’t shrink a post below 70%',
  'Product claims checked against your brand notes',
  'Per-run spend cap; your key, your bill',
];

const CLAUDE_CODE = `/plugin marketplace add pulipakaharshith-alt/VYB-SEO
/plugin install vyb-seo@vyb-seo-marketplace
/vyb-seo:seo setup
/vyb-seo:seo run`;

const AGENT_PROMPT = `Set up the SEO agent from ${REPO} for this website.
Follow its SETUP.md: inspect this repo, write .seo-agent/config.json and .seo-agent/brand.md,
commit them, then walk me through deploying it to Vercel.`;

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <span className="font-semibold tracking-tight">VYB-SEO</span>
        <nav className="flex items-center gap-4 text-sm">
          <a href={`${REPO}#readme`} className="text-muted hover:text-text">Docs</a>
          <a href={REPO} className="text-muted hover:text-text">GitHub</a>
          <Link href="/dashboard" className="rounded-lg border border-line px-3 py-1.5 hover:bg-accent-soft">Dashboard</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-16 sm:py-24">
          <p className="mb-4 text-sm font-medium text-accent">Open source · MIT</p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            An AI SEO agent that writes, refreshes and opens pull requests for your blog.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            For any site whose blog is Markdown or MDX in GitHub. Run it on Vercel with your own Anthropic or OpenAI key, or in Claude Code on your Claude
            subscription. No database, nothing hosted by anyone else.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={DEPLOY} className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white hover:opacity-90">Deploy to Vercel</a>
            <a href="#claude-code" className="rounded-lg border border-line px-5 py-2.5 font-medium hover:bg-accent-soft">Use in Claude Code</a>
            <a href={REPO} className="rounded-lg px-5 py-2.5 font-medium text-muted hover:text-text">View on GitHub →</a>
          </div>
        </section>

        <section className="border-t border-line py-16">
          <h2 className="mb-8 text-2xl font-semibold tracking-tight">What one run does</h2>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border border-line bg-panel p-5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
                  <h3 className="font-semibold">{s.title}</h3>
                </div>
                <p className="text-sm leading-relaxed text-muted">{s.desc}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-muted">
            Optional: Search Console for ranking data, and DataForSEO for real search volumes and weekly checks of what ChatGPT and Perplexity say about you.
          </p>
        </section>

        <section className="border-t border-line py-16">
          <h2 className="mb-2 text-2xl font-semibold tracking-tight">Three ways to run it</h2>
          <p className="mb-8 text-muted">Requirement: your posts are .md or .mdx files with YAML frontmatter, in one folder of a GitHub repo.</p>
          <div className="grid gap-6 lg:grid-cols-3">
            <div id="claude-code" className="flex flex-col gap-3">
              <h3 className="font-semibold">1. Claude Code: no API key</h3>
              <p className="text-sm text-muted">Uses your Claude subscription. Open Claude Code in your website’s repo and run:</p>
              <CopyBlock code={CLAUDE_CODE} />
              <p className="text-sm text-muted">
                Runs on demand, or twice a week via the{' '}
                <a className="underline" href={`${REPO}/blob/main/templates/github-action/seo-agent.yml`}>GitHub Action template</a>.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="font-semibold">2. Vercel: runs daily</h3>
              <p className="text-sm text-muted">
                Deploy, add your AI key, a GitHub token for your blog repo, a dashboard password and a cron secret. Then fill in Settings and press Start run.
              </p>
              <a href={DEPLOY} className="w-fit rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">Deploy to Vercel</a>
              <p className="text-sm text-muted">
                Includes a dashboard: queue, audit, reports, settings, spend. <a className="underline" href={`${REPO}/blob/main/SETUP.md`}>Setup guide</a>
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="font-semibold">3. Let your AI agent set it up</h3>
              <p className="text-sm text-muted">Paste into Claude Code, Cursor or Codex, opened in your website’s repo:</p>
              <CopyBlock code={AGENT_PROMPT} />
            </div>
          </div>
        </section>

        <section className="border-t border-line py-16">
          <h2 className="mb-2 text-2xl font-semibold tracking-tight">Built not to hurt your site</h2>
          <p className="mb-8 max-w-2xl text-muted">
            Mass-produced AI content can get a site demoted. The defaults are deliberately conservative, and each guard is enforced in code.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SAFETY.map((s) => (
              <li key={s} className="flex gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
                <span className="text-ok" aria-hidden>✓</span>
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm">
            <a className="text-accent underline" href={`${REPO}/blob/main/SAFETY.md`}>Every risk and guard, in SAFETY.md →</a>
          </p>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted">
          <span>MIT licensed · Endpoint research credit: OpenSEO</span>
          <span>
            Running your own copy? <Link href="/dashboard" className="underline">Open the dashboard</Link> (password protected).
          </span>
        </div>
      </footer>
    </div>
  );
}
