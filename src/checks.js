// Each check is one Kane CLI run. Objectives are plain English.
// `leak` explains, in marketing terms, what a failure costs the advertiser.
// `submits: true` means the check sends a real lead through the form (skipped with --no-submit).
// `evaluate(result, opts)` (optional) turns the values Kane stored into a verdict + facts for the report.
// Avoid double quotes inside objectives (Windows shell quoting); use single quotes.

import { analyzeHits, extractUrls, PLATFORMS } from './pixels.js';

const TRACKING_DOMAINS = 'googleadservices, google-analytics, analytics.google, googletagmanager, doubleclick, facebook.com/tr, connect.facebook.net, mc.yandex, analytics.tiktok';

const num = (v) => {
  const m = String(v ?? '').replace(',', '.').match(/[\d.]+/);
  return m ? Number(m[0]) : null;
};
const fsGet = (fs, ...keys) => {
  if (!fs) return undefined;
  for (const k of keys) {
    const hit = Object.keys(fs).find((x) => x.toLowerCase().includes(k));
    if (hit) return fs[hit];
  }
  return undefined;
};

export const CHECKS = [
  {
    id: 'cta',
    title: 'Hero CTA leads to the form',
    severity: 'high',
    leak: 'Paid visitors click the main button and nothing happens: they bounce and you still pay for the click.',
    objective: (url) =>
      `Go to ${url}. Without scrolling, click the main call-to-action button in the hero section. ` +
      `Do not scroll after the click. Verify that the click itself led to a way to become a lead: ` +
      `a lead / contact form with its input fields, a booking widget, or a messenger chat is visible in the viewport right after the click.`,
  },
  {
    id: 'form',
    title: 'Lead form submits successfully',
    severity: 'critical',
    submits: true,
    leak: 'Leads are lost at the last step. Every click that reached the form is wasted budget.',
    objective: (url) =>
      `Go to ${url}. Fill the lead form: name 'Kane Test', phone '+77010000000'. Submit the form. ` +
      `Then verify a success / thank-you message is shown and no error message is shown.`,
  },
  {
    id: 'utm',
    title: 'UTM tags are captured with the lead',
    severity: 'high',
    submits: true,
    leak: 'You cannot tell which campaign or keyword produced the lead, so you cannot cut the ones that waste money.',
    objective: (url) =>
      `Go to ${url}${url.includes('?') ? '&' : '?'}utm_source=google&utm_medium=cpc&utm_campaign=adleak_test. ` +
      `Fill the lead form: name 'UTM Test', phone '+77010000001'. Submit the form. ` +
      `Then verify that the network request sent by the form submission contains 'adleak_test' in its URL or request body.`,
  },
  {
    id: 'pixels',
    title: 'Ad pixels fire exactly once per lead',
    severity: 'critical',
    submits: true,
    leak: 'Missing conversions make Google Ads and Meta optimize blind; double-fired ones teach them on fake data. Either way you overpay.',
    objective: (url) =>
      `Go to ${url}. Fill the lead form: name 'Pixel Test', phone '+77010000002'. Submit the form and wait 3 seconds. ` +
      `Store the full URLs of every network request made after clicking submit whose URL contains any of: ${TRACKING_DOMAINS} ` +
      `as 'tracking_requests'. Then verify that at least one of these tracking requests was sent.`,
    objectiveNoSubmit: (url) =>
      `Go to ${url} and wait 3 seconds for the page to finish loading. ` +
      `Store the full URLs of every network request whose URL contains any of: ${TRACKING_DOMAINS} as 'tracking_requests'. ` +
      `Then verify the page loaded.`,
    evaluate(result, opts) {
      const stored = fsGet(result.finalState, 'tracking');
      const urls = extractUrls(stored);
      if (stored === undefined) {
        return { status: result.status, facts: [{ label: 'Tracking', value: 'Kane returned no captured requests', ok: false }], note: 'Kane did not return the captured tracking requests, so pixels could not be analyzed. Result is Kane\'s own verdict.' };
      }
      if (opts.noSubmit) {
        const { found } = analyzeHits(urls);
        const facts = found.length
          ? found.map((f) => ({ label: f.name, value: `${f.hits} hit${f.hits === 1 ? '' : 's'} on load`, ok: true }))
          : [{ label: 'Tracking', value: 'no ad / analytics tags detected', ok: false }];
        return { status: found.length ? 'passed' : 'failed', facts, note: found.length ? `Tags found: ${found.map((f) => f.name).join(', ')}` : 'No ad or analytics tags fired on page load.' };
      }
      if (!urls.length && result.status !== 'passed') return null; // let Kane's own verdict stand
      const { found, problems } = analyzeHits(urls, { expect: opts.expect });
      const facts = [];
      const ids = new Set([...found.map((f) => f.id), ...(opts.expect || [])]);
      for (const id of ids) {
        if (id === 'gtm') continue;
        const f = found.find((x) => x.id === id);
        const leads = f?.leads || 0;
        facts.push({ label: PLATFORMS[id]?.name || id, value: leads === 1 ? '1 conversion ✓' : leads ? `${leads}× conversions` : 'no conversion', ok: leads === 1 });
      }
      return { status: problems.length ? 'failed' : 'passed', facts, note: problems.join('; ') || 'Every expected platform received exactly one conversion.' };
    },
  },
  {
    id: 'mobile',
    title: 'Mobile: CTA visible and tappable',
    severity: 'high',
    window: '412x915',
    leak: 'Most paid traffic is mobile. If a popup or layout bug hides the button on a phone, that share of the budget converts at zero.',
    objective: (url) =>
      `Go to ${url}. Do not close, dismiss or tap any popup, banner or overlay, and do not scroll. ` +
      `Find the main call-to-action button of the hero section (the page's own CTA, not a button inside a popup). ` +
      `Verify it is fully visible on the first screen and no popup, banner or overlay covers any part of it. ` +
      `Then tap that hero button and verify a lead / contact form, booking widget or messenger chat is visible.`,
  },
  {
    id: 'speed',
    title: 'Page loads fast (LCP < 2.5s)',
    severity: 'medium',
    leak: 'Slow first screens lose paid visitors before they see the offer, and page speed feeds into Google Ads landing-page experience.',
    objective: (url) =>
      `Go to ${url} and wait 3 seconds for the page to settle. Extract all web vitals metrics and store them as 'web_vitals'. ` +
      `Then assert page LCP is under 2500ms.`,
    evaluate(result) {
      const blob = JSON.stringify(result.finalState || {}) + ' ' + (result.summary || '');
      const grab = (key) => { const m = blob.match(new RegExp(key + '[^0-9]{0,30}([0-9]+(?:\\.[0-9]+)?)', 'i')); return m ? Number(m[1]) : null; };
      const lcp = grab('lcp');
      const cls = grab('cls');
      if (lcp === null) return null;
      const ms = lcp < 50 ? lcp * 1000 : lcp; // Kane may report seconds
      const facts = [{ label: 'LCP', value: `${(ms / 1000).toFixed(2)} s`, ok: ms < 2500 }];
      if (cls !== null) facts.push({ label: 'CLS', value: String(cls), ok: cls < 0.1 });
      return { status: ms < 2500 ? 'passed' : 'failed', facts, note: ms < 2500 ? `LCP ${(ms / 1000).toFixed(2)} s, within the 2.5 s budget.` : `The main content takes ${(ms / 1000).toFixed(2)} s to appear (budget: 2.5 s). Something is blocking rendering.` };
    },
  },
  {
    id: 'match',
    title: 'Landing matches the ad promise',
    severity: 'high',
    needsAd: true,
    leak: 'When the first screen does not repeat what the ad promised, visitors bounce and Google lowers Quality Score, so every click costs more.',
    objective: (url, opts) =>
      `Go to ${url} and do not scroll. The ad that brought the visitor says: '${opts.ad}'. ` +
      `Split the ad into its concrete promises (product, every price or number, timing, every free extra). ` +
      `Store the main headline text as 'headline' and store the list of ad promises that are NOT visible on the first screen as 'missing_promises'. ` +
      `Then verify each ad promise individually, including the exact price, is visible on the first screen without scrolling.`,
  },
  {
    id: 'health',
    title: 'Page loads without JS errors or failed requests',
    severity: 'medium',
    leak: 'Broken scripts silently kill sliders, forms and tracking on some browsers, lowering conversion rate.',
    objective: (url) =>
      `Go to ${url} and scroll to the bottom of the page. ` +
      `Assert there are no console errors and no network requests failed or returned 4xx/5xx.`,
  },
];

export const SEVERITY_WEIGHT = { critical: 40, high: 25, medium: 10 };

export function pickChecks({ only, ad, noSubmit } = {}) {
  let list = CHECKS.filter((c) => (c.needsAd ? Boolean(ad) : true));
  if (noSubmit) list = list.filter((c) => !c.submits || c.objectiveNoSubmit);
  if (only) {
    const ids = only.split(',').map((s) => s.trim());
    list = list.filter((c) => ids.includes(c.id));
  }
  return list;
}

export function objectiveFor(check, url, opts) {
  if (opts.noSubmit && check.objectiveNoSubmit) return check.objectiveNoSubmit(url, opts);
  return check.objective(url, opts);
}
