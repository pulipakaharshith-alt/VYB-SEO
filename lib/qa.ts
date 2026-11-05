import type { SiteConfig } from './config';
import { countWords, extractFaq, internalLinks } from './content';
import type { LinkStatus } from './links';

export const FILLER = [
  "in today's",
  'delve',
  'game-changer',
  'game changer',
  'unlock',
  'elevate your',
  'navigate the world',
  'navigating the world',
  "it's important to note",
  'it is important to note',
  'in conclusion',
  'in the realm of',
  'tapestry',
  'look no further',
  "whether you're",
  'whether you’re',
  'embark on',
  'supercharge',
  'seamless',
];

export interface Draft {
  title: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  body: string;
}

export interface QaResult {
  errors: string[];
  warnings: string[];
  words: number;
  faq: number;
}

/**
 * Deterministic quality gate. Errors block publishing and trigger a revision; warnings go in
 * the report for a human to glance at.
 */
export function checkDraft(
  config: SiteConfig,
  d: Draft,
  opts: { keyword: string; checkLink: (p: string) => LinkStatus; otherTitles: string[]; originalWords?: number },
): QaResult {
  const qa = config.qa;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const k of ['title', 'metaTitle', 'metaDescription', 'excerpt', 'body'] as const) {
    if (!String(d[k] ?? '').trim()) errors.push(`"${k}" is empty`);
  }
  const titleLen = d.metaTitle.length + config.titleSuffix.length;
  if (titleLen > qa.metaTitleMax + 5) errors.push(`metaTitle is ${titleLen} chars with the site suffix (max ${qa.metaTitleMax})`);
  else if (titleLen > qa.metaTitleMax) warnings.push(`metaTitle is ${titleLen} chars with the site suffix`);
  const md = d.metaDescription.length;
  if (md > qa.metaDescriptionMax + 10 || md < qa.metaDescriptionMin - 20)
    errors.push(`metaDescription is ${md} chars (want ${qa.metaDescriptionMin}-${qa.metaDescriptionMax})`);
  else if (md > qa.metaDescriptionMax || md < qa.metaDescriptionMin) warnings.push(`metaDescription is ${md} chars`);

  const taken = new Set(opts.otherTitles.map((t) => t.trim().toLowerCase()).filter(Boolean));
  if (taken.has(d.title.trim().toLowerCase()) || taken.has(d.metaTitle.trim().toLowerCase()))
    errors.push('title or metaTitle duplicates an existing article');

  if (config.templateRendersTitle && /^#\s/m.test(d.body)) errors.push('body has an H1; the page template already renders the title. Use ## and ###');
  if (!/^##\s/m.test(d.body)) errors.push('body has no ## sections');

  const words = countWords(d.body);
  if (words < qa.minWords) errors.push(`only ${words} words (min ${qa.minWords})`);
  if (words > qa.maxWords) warnings.push(`${words} words (max ${qa.maxWords})`);
  // A refresh must not gut a page that already ranks.
  if (opts.originalWords && words < opts.originalWords * config.safety.minRetainRatio)
    errors.push(`refresh cut the article from ${opts.originalWords} to ${words} words; keep at least ${Math.round(opts.originalWords * config.safety.minRetainRatio)} (improve, don't shorten)`);

  const links = internalLinks(d.body, config.site);
  const bad = new Set<string>();
  for (const l of links) {
    const r = opts.checkLink(l.path);
    if (r.status === 'remap') bad.add(`${l.href} (use ${r.to})`);
    if (r.status === 'unknown') bad.add(`${l.href} (not a page on the site)`);
  }
  if (bad.size) errors.push(`invalid internal links: ${[...bad].join(', ')}`);
  const distinct = new Set(links.map((l) => l.path)).size;
  if (distinct < qa.minInternalLinks) errors.push(`only ${distinct} distinct internal links (min ${qa.minInternalLinks})`);

  // External links: few, https only, never made up. Web pages can carry injected link spam.
  const external = [...d.body.matchAll(/(?<!!)\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g)]
    .map((m) => m[1])
    .filter((u) => !internalLinks(`[x](${u})`, config.site).length);
  if (external.length > config.safety.maxExternalLinks) errors.push(`${external.length} external links (max ${config.safety.maxExternalLinks})`);
  const insecure = external.filter((u) => u.startsWith('http://'));
  if (insecure.length) errors.push(`non-https external links: ${insecure.join(', ')}`);
  const host = (u: string) => {
    try {
      return new URL(u).hostname;
    } catch {
      return u;
    }
  };
  if (external.length) warnings.push(`external links to verify: ${[...new Set(external.map(host))].join(', ')}`);

  const lower = d.body.toLowerCase();
  const hits = FILLER.filter((p) => lower.includes(p));
  if (hits.length > qa.maxFillerPhrases) errors.push(`filler phrases: ${hits.join(', ')}`);
  else if (hits.length) warnings.push(`filler phrases: ${hits.join(', ')}`);
  const dashes = (d.body.match(/—/g) ?? []).length;
  if (dashes > words / 120) warnings.push(`${dashes} em dashes`);

  const kwTokens = opts.keyword.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (kwTokens.length) {
    const has = (hay: string) => kwTokens.filter((t) => hay.includes(t.replace(/s$/, ''))).length / kwTokens.length;
    if (has(d.body.split(/\s+/).slice(0, 150).join(' ').toLowerCase()) < 0.6) warnings.push('keyword not clearly in the first 150 words');
    if (has(`${d.title} ${d.metaTitle}`.toLowerCase()) < 0.6) warnings.push('keyword not clearly in the title');
  }

  const faq = extractFaq(d.body).length;
  if (faq < 3) errors.push(`FAQ missing or ${faq} questions (need "## FAQ" with 3+ "### Question?" entries)`);

  const pct = d.body.match(/\b\d{1,3}(\.\d+)?%/g) ?? [];
  if (pct.length > 3) warnings.push(`${pct.length} percentage claims; check none are invented`);
  if (/\b(study|survey|research) (shows|found|finds)\b/i.test(d.body)) warnings.push('cites a study; verify it is real');
  if (/guarantee/i.test(d.body)) warnings.push('uses "guarantee"');

  return { errors, warnings, words, faq };
}
