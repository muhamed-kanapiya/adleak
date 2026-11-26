// Landing page logic. This file intentionally contains real-world bugs
// that silently waste ad budget. AdLeak + Kane CLI should find all of them.

// ---- Tracking (real vendor endpoints, demo account IDs) ----------------------
const CFG = window.SITE_CONFIG || {};
const PIXELS = {
  ga4: CFG.ga4,
  meta: CFG.metaPixel,
  ym: CFG.yandexCounter_old, // renamed in the last redesign
};

function hit(platform, event, url) {
  // Same transport gtag.js uses: a keepalive fetch that survives navigation.
  fetch(url, { mode: 'no-cors', keepalive: true, credentials: 'include' }).catch(() => {});
  fetch(`/collect?p=${platform}&e=${event}`, { keepalive: true }).catch(() => {}); // local log for the demo terminal
}

function trackPageView() {
  const dl = encodeURIComponent(location.href);
  if (PIXELS.ga4) hit('ga4', 'page_view', `https://www.google-analytics.com/g/collect?v=2&tid=${PIXELS.ga4}&en=page_view&dl=${dl}`);
  if (PIXELS.meta) hit('meta', 'PageView', `https://www.facebook.com/tr?id=${PIXELS.meta}&ev=PageView&dl=${dl}`);
  if (PIXELS.ym) hit('yandex', 'hit', `https://mc.yandex.ru/watch/${PIXELS.ym}?page-url=${dl}`);
}

function trackLead() {
  if (PIXELS.ga4) hit('ga4', 'generate_lead', `https://www.google-analytics.com/g/collect?v=2&tid=${PIXELS.ga4}&en=generate_lead`);
  if (window.ADS_CONVERSION_ID) {
    const [id, label] = window.ADS_CONVERSION_ID.replace('AW-', '').split('/');
    hit('google_ads', 'conversion', `https://www.googleadservices.com/pagead/conversion/${id}/?label=${label}&value=1&currency_code=KZT`);
  }
  if (PIXELS.meta) hit('meta', 'Lead', `https://www.facebook.com/tr?id=${PIXELS.meta}&ev=Lead`);
  if (PIXELS.ym) hit('yandex', 'goal', `https://mc.yandex.ru/watch/${PIXELS.ym}?page-url=goal%3A%2F%2F${location.host}%2Flead`);
}

trackPageView();

// ---- Lead form ----------------------------------------------------------------
function readUtm() {
  const params = new URLSearchParams(location.search);
  const utm = {};
  for (const key of ['utm-source', 'utm-medium', 'utm-campaign']) {
    if (params.get(key)) utm[key] = params.get(key);
  }
  return utm;
}

const form = document.getElementById('form');
const msg = document.getElementById('msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  msg.className = '';
  msg.textContent = 'Sending…';
  try {
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...data, utm: readUtm() }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    msg.className = 'ok';
    msg.textContent = 'Thank you! Our coordinator will call you within 5 minutes.';
    trackLead();
  } catch (err) {
    msg.className = 'err';
    msg.textContent = 'Something went wrong. Please call us instead.';
  }
});

// Legacy snippet left by the previous agency ("just in case")
form.addEventListener('submit', () => {
  setTimeout(() => {
    if (msg.className === 'ok' && PIXELS.meta) hit('meta', 'Lead', `https://www.facebook.com/tr?id=${PIXELS.meta}&ev=Lead`);
  }, 1200);
});

// Reviews carousel
initCarousel(document.querySelector('.carousel'));
