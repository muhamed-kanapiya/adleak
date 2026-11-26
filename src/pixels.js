// Classifies ad / analytics hits captured by Kane CLI and decides whether
// conversion tracking is healthy: every expected platform fires, and each
// lead event fires exactly once (double firing inflates conversions and
// teaches Smart Bidding / Meta's algorithm on fake data).

export const PLATFORMS = {
  google_ads: { name: 'Google Ads', re: /googleadservices\.com\/pagead\/conversion|google\.com\/pagead\/1p-conversion|googleads\.g\.doubleclick\.net\/pagead\/(viewthrough)?conversion/i, lead: () => true },
  ga4: { name: 'GA4', re: /(google-analytics\.com|analytics\.google\.com)\/(g\/|mp\/)?collect/i, lead: (u) => /[?&]en=(generate_lead|conversion|form_submit|lead|submit_lead|sign_up)/i.test(u) },
  meta: { name: 'Meta Pixel', re: /facebook\.com\/tr/i, lead: (u) => /[?&]ev=(Lead|CompleteRegistration|Contact|SubmitApplication|Schedule)/i.test(u) },
  yandex: { name: 'Yandex Metrica', re: /mc\.yandex\.(ru|kz|com|by)\/watch/i, lead: (u) => /goal(%3A|:)/i.test(u) },
  tiktok: { name: 'TikTok Pixel', re: /analytics\.tiktok\.com\/api\/v2\/pixel/i, lead: (u) => /(SubmitForm|CompleteRegistration|Contact|Lead)/i.test(u) },
  gtm: { name: 'Google Tag Manager', re: /googletagmanager\.com\/(gtm|gtag)\/?(js)?/i, lead: () => false },
};

export function extractUrls(finalState) {
  if (!finalState) return [];
  const text = typeof finalState === 'string' ? finalState : JSON.stringify(finalState);
  const urls = text.replace(/\\\//g, '/').match(/https?:\/\/[^\s"'<>\\,\]]+/g) || [];
  return urls;
}

export function analyzeHits(urls, { expect = [] } = {}) {
  const found = {};
  for (const u of urls) {
    for (const [id, p] of Object.entries(PLATFORMS)) {
      if (!p.re.test(u)) continue;
      found[id] ||= { id, name: p.name, hits: 0, leads: 0 };
      found[id].hits++;
      if (p.lead(u)) found[id].leads++;
    }
  }
  // One Google Ads conversion produces a redirect chain (googleadservices -> doubleclick
  // view-through -> google.com 1p-conversion). Count the first hop that is present, not all of them.
  if (found.google_ads) {
    const tiers = [/googleadservices\.com\/pagead\/conversion/i, /google\.com\/pagead\/1p-conversion/i, /doubleclick\.net\/pagead/i];
    for (const t of tiers) {
      const n = urls.filter((u) => t.test(u)).length;
      if (n) { found.google_ads.leads = n; found.google_ads.hits = n; break; }
    }
  }
  const problems = [];
  for (const id of expect) {
    if (!found[id] || !found[id].leads) problems.push(`${PLATFORMS[id]?.name || id}: no conversion event after the lead`);
  }
  for (const f of Object.values(found)) {
    if (f.leads > 1) problems.push(`${f.name}: lead event fired ${f.leads}× for one lead (inflated conversions)`);
  }
  const anyLead = Object.values(found).some((f) => f.leads > 0);
  if (!expect.length && !anyLead) problems.push('No ad platform received a conversion event after the lead');
  return { found: Object.values(found), problems };
}
