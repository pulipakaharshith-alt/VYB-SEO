import type { SiteConfig } from './config';

/** Dos and don'ts shown in the dashboard. Keep in sync with SAFETY.md. */
export const DOS: { title: string; why: string }[] = [
  { title: 'Start slow: 1–2 new posts a week', why: 'Search engines reward steady, useful publishing. A sudden flood of AI pages is the fastest way to get a site demoted. Raise safety.maxNewPerWeek only after Search Console shows the new posts indexed and getting impressions.' },
  { title: 'Read every pull request before merging', why: 'Check facts, tone and advice, open every external link, and look at the preview deployment. Close the PR to discard a run you don’t like.' },
  { title: 'Add your own experience', why: 'Edit drafts in the PR to add real examples, numbers you can stand behind, screenshots or quotes from your team. First-hand detail is what AI can’t invent and what readers and search engines value most.' },
  { title: 'Keep brand notes accurate and specific', why: 'The agent only states product facts written there. Include what the product does not do, and update the notes whenever pricing or features change.' },
  { title: 'Connect Search Console', why: 'With it, the agent refreshes pages that are close to page one, fixes titles that don’t get clicks, and never rewrites your top pages. Without it, it can only go by post age.' },
  { title: 'Keep "pr" publishing for the first weeks', why: 'Switch to direct publishing only after several weeks of PRs you merged without changes.' },
  { title: 'Protect your default branch', why: 'Require the preview build to pass before merging, so a broken post can never reach production.' },
  { title: 'Use a token for this one repo only', why: 'A fine-grained GitHub token with Contents and Pull requests access to the website repo, nothing else. Rotate it yearly.' },
  { title: 'Check results monthly', why: 'Read the reports, compare clicks and indexed pages in Search Console, and revert any refresh that dropped a page’s rankings.' },
];

export const DONTS: { title: string; why: string }[] = [
  { title: 'Don’t crank the weekly limit up to “go faster”', why: 'Dozens of new posts a week from a small site looks like scaled content abuse. Volume without demand does not rank.' },
  { title: 'Don’t switch to direct publishing on day one', why: 'Every article then goes live with no human check.' },
  { title: 'Don’t put unprovable claims in the brand notes', why: 'Whatever is there will be repeated across many articles.' },
  { title: 'Don’t turn off the claims check or loosen the quality gate', why: 'They are what stops invented statistics, unsupported product claims and thin pages. If drafts keep failing, fix the brand notes or settings instead.' },
  { title: 'Don’t use it for medical, legal or financial advice without expert review', why: 'These topics are held to the highest standard by search engines and carry real liability.' },
  { title: 'Don’t target competitors’ brand names or write attack comparisons', why: 'It invites legal trouble and rarely ranks. Honest comparisons reviewed by a person are fine.' },
  { title: 'Don’t mass-produce near-identical pages', why: 'City-by-city or keyword-swapped pages with the same content are doorway pages under search engine spam policies.' },
  { title: 'Don’t set protectTopPages to 0', why: 'Your best-performing pages are where a bad rewrite costs the most.' },
  { title: 'Don’t merge a PR whose preview build fails', why: 'Fix the frontmatter settings first; the report says what failed.' },
  { title: 'Don’t share the dashboard password or leave it weak', why: 'Anyone with it can spend your AI credit and open PRs on your repo.' },
];

/** Settings that turn a guard off or push it past a sensible limit. */
export function riskySettings(c: SiteConfig): string[] {
  const out: string[] = [];
  if (c.safety.maxNewPerWeek > 7) out.push(`safety.maxNewPerWeek is ${c.safety.maxNewPerWeek}: more than one new post a day risks being treated as scaled AI content. 1–3 is safer.`);
  if (c.publish.mode === 'direct') out.push('publish.mode is "direct": articles go live without review. Use "pr" until you trust the output.');
  if (!c.safety.claimsCheck) out.push('safety.claimsCheck is off: drafts are no longer checked against your brand notes for unsupported claims.');
  if (c.safety.protectTopPages < 1) out.push('safety.protectTopPages is 0: your best-performing pages can be rewritten.');
  if (c.safety.minRetainRatio < 0.5) out.push(`safety.minRetainRatio is ${c.safety.minRetainRatio}: a refresh can cut a page by more than half.`);
  if (c.safety.maxExternalLinks > 10) out.push(`safety.maxExternalLinks is ${c.safety.maxExternalLinks}: more external links means more to verify and more room for injected links.`);
  if (c.qa.minWords < 600) out.push(`qa.minWords is ${c.qa.minWords}: short pages rarely answer a query well enough to rank.`);
  if (c.qa.maxFillerPhrases > 4) out.push('qa.maxFillerPhrases is high: AI filler phrases will get through.');
  if (c.run.newArticles > 5) out.push(`run.newArticles is ${c.run.newArticles} per run: keep it at 1–2 (the weekly cap still applies).`);
  if (c.run.maxSpendUsd > 20) out.push(`run.maxSpendUsd is $${c.run.maxSpendUsd}: a single run can spend that much.`);
  return out;
}
