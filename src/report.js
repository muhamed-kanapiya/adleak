import fs from 'node:fs';
import path from 'node:path';
import { SEVERITY_WEIGHT } from './checks.js';

const md = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function leakScore(results) {
  // 0 = nothing leaks, 100 = everything leaks
  let total = 0; let lost = 0;
  for (const r of results) {
    const w = SEVERITY_WEIGHT[r.check.severity] || 10;
    total += w;
    if (r.result.status !== 'passed') lost += w;
  }
  return total ? Math.round((lost / total) * 100) : 0;
}

// Kane's summary is: problem sentence, fix suggestion, then "evidence: kind: detail" lines.
export function parseKaneSummary(text = '') {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const evidence = [];
  const prose = [];
  for (const l of lines) {
    const m = l.match(/^evidence:\s*([a-z_]+):\s*(.*)$/i);
    if (m) evidence.push({ kind: m[1].replace(/_/g, ' '), detail: m[2] });
    else prose.push(l);
  }
  return { problem: prose[0] || '', suggestion: prose.slice(1).join(' '), evidence };
}

// Claude's notes usually list fixes as "1. [form] ..." or "- form: ...". Map them to check ids.
export function parseAgentNotes(text = '', ids = []) {
  const out = {};
  const lines = String(text).split(/\r?\n/);
  let current = null;
  for (const raw of lines) {
    const l = raw.trim();
    const m = l.match(/^(?:\d+\.|-|\*)\s*\[?([a-z]+)\]?:?\s*(.*)$/i);
    if (m && ids.includes(m[1].toLowerCase())) {
      current = m[1].toLowerCase();
      out[current] = m[2];
    } else if (current && l && !/^(?:\d+\.|-|\*)\s/.test(l)) {
      out[current] += ' ' + l;
    } else if (!l) current = null;
  }
  return out;
}

export function writeReport({ url, rounds, outDir = 'adleak-report', dailyBudget }) {
  fs.mkdirSync(outDir, { recursive: true });
  const data = toData({ url, rounds, dailyBudget });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(outDir, 'index.html'), renderHtml(data));
  fs.writeFileSync(path.join(outDir, 'summary.md'), renderMarkdown(data));
  return path.join(outDir, 'index.html');
}

export function renderMarkdown(d) {
  const first = d.rounds[0]; const last = d.rounds[d.rounds.length - 1];
  const money = (s) => (d.dailyBudget ? ` (≈ $${Math.round((d.dailyBudget * s) / 100)}/day at risk)` : '');
  const icon = (st) => (st === 'passed' ? '✅' : '❌');
  const rows = last.checks.map((c) => {
    const k = parseKaneSummary(c.summary);
    const facts = (c.facts || []).map((f) => `${f.label}: ${f.value}`).join(', ');
    return `| ${icon(c.status)} | **${c.title}** | ${c.status === 'passed' ? (facts || 'ok') : `${k.problem}${facts ? ` — ${facts}` : ''}`} |`;
  });
  return `## 💸 AdLeak: budget leak score ${last.leakScore}/100${money(last.leakScore)}
${d.rounds.length > 1 ? `Was **${first.leakScore}/100** before the fix loop.\n` : ''}
| | Check | Kane CLI result |
|---|---|---|
${rows.join('\n')}

<sub>Verified in a real browser by [Kane CLI](https://www.testmuai.com/kane-cli/) · ${esc(d.url)}</sub>
`;
}

export function writeLeaderboard({ sites, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const sorted = [...sites].sort((a, b) => b.score - a.score);
  const rows = sorted.map((s, i) => `<a class="row" href="${esc(s.slug)}/index.html"><span class="rk">${i + 1}</span>
    <span class="u">${esc(s.url)}<small>${s.failing.length ? esc(s.failing.join(' · ')) : 'No leaks found'}</small></span>
    <span class="bar"><i style="width:${s.score}%"></i></span><b class="${s.score ? 'bad' : 'ok'}">${s.score}</b></a>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AdLeak · agency leaderboard</title>
<style>body{margin:0;background:#0b0d12;color:#e9ecf3;font:15px/1.5 Inter,system-ui,Segoe UI,Arial,sans-serif}.w{max-width:980px;margin:0 auto;padding:44px 24px}
h1{font-size:40px;letter-spacing:-.03em;margin:0 0 6px}p{color:#8b93a7;margin:0 0 28px}
.row{display:grid;grid-template-columns:36px 1fr 200px 56px;gap:16px;align-items:center;padding:16px 18px;border:1px solid #232836;background:#12151d;border-radius:14px;margin-bottom:10px;text-decoration:none;color:inherit}
.row:hover{border-color:#3a4256}.rk{color:#8b93a7;font-weight:700}.u{font-weight:600;word-break:break-all}.u small{display:block;color:#8b93a7;font-weight:400;font-size:12.5px}
.bar{height:8px;background:#232836;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#ffb84d,#ff5d5d)}
b{font-size:24px;text-align:right}b.bad{color:#ff5d5d}b.ok{color:#3ddc97}</style></head><body><div class="w">
<h1>💸 Budget leak leaderboard</h1><p>${sites.length} landing pages audited by Kane CLI in a real browser. Higher score = more ad budget wasted. No real leads were submitted.</p>
${rows}</div></body></html>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  return path.join(outDir, 'index.html');
}

export function toData({ url, rounds, dailyBudget }) {
  return {
    url,
    dailyBudget: dailyBudget || null,
    generatedAt: new Date().toISOString(),
    rounds: rounds.map((r) => ({
      label: r.label,
      leakScore: leakScore(r.results),
      agentSummary: r.agentSummary || null,
      checks: r.results.map(({ check, result }) => ({
        id: check.id, title: check.title, severity: check.severity, leak: check.leak,
        status: result.status, summary: result.summary, failedRemarks: result.failedRemarks || [],
        facts: result.facts || [], note: result.note || null,
        durationSec: result.durationSec, credits: result.credits, testUrl: result.testUrl,
        ran: r.ranIds ? r.ranIds.includes(check.id) : true,
      })),
    })),
  };
}

const ICON = {
  cta: '<path d="M4 4l7 17 2.5-7.5L21 11z"/>',
  form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  utm: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  conversion: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  health: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  pixels: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  mobile: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  speed: '<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1 1 17 0"/>',
  match: '<path d="M4 5h11l5 5v9H4z"/><path d="M8 12l2.5 2.5L16 9"/>',
};

export function renderHtml(d) {
  const first = d.rounds[0];
  const last = d.rounds[d.rounds.length - 1];
  const fixed = d.rounds.length > 1;
  const before = first.leakScore;
  const after = last.leakScore;
  const ids = first.checks.map((c) => c.id);
  const money = (s) => (d.dailyBudget ? Math.round((d.dailyBudget * s) / 100) : null);
  const saved = money(before) !== null && fixed ? money(before) - money(after) : null;

  const allRuns = d.rounds.flatMap((r) => r.checks.filter((c) => c.ran));
  const kaneRuns = allRuns.length;
  const kaneMin = Math.round(allRuns.reduce((a, c) => a + (c.durationSec || 0), 0) / 60);
  const credits = Math.round(allRuns.reduce((a, c) => a + (c.credits || 0), 0));
  const fixRounds = d.rounds.filter((r) => r.agentSummary).length;
  const bugsFound = first.checks.filter((c) => c.status !== 'passed').length;

  const agentNotes = {};
  for (const r of d.rounds) if (r.agentSummary) Object.assign(agentNotes, parseAgentNotes(r.agentSummary, ids));

  const gauge = (score, label, sub, tone) => {
    const R = 54; const C = 2 * Math.PI * R; const off = C * (1 - score / 100);
    return `<div class="gauge ${tone}">
      <div class="ring"><svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="${R}" class="track"/>
      <circle cx="70" cy="70" r="${R}" class="bar" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>
      <div class="gv"><b>${score}</b><span>/100</span></div></div>
      <div class="gl">${label}</div><div class="gs">${sub}</div></div>`;
  };

  const pill = (c) => {
    if (!c) return '<span class="pill skip">—</span>';
    if (!c.ran) return '<span class="pill carry" title="Not re-run in this round">● carried</span>';
    const ok = c.status === 'passed';
    const inner = ok ? '✓ pass' : c.status === 'timeout' ? '⏱ timeout' : '✕ fail';
    const t = c.testUrl ? `<a href="${esc(c.testUrl)}" target="_blank" rel="noopener">${inner}</a>` : inner;
    return `<span class="pill ${ok ? 'ok' : 'bad'}">${t}</span>`;
  };

  const timeline = d.rounds.map((r, i) => {
    const prevAgent = r.agentSummary ? `<div class="tl-step agent"><div class="dot">✦</div><div><b>Claude Code</b><span>patched the site</span></div></div>` : '';
    const isKane = `<div class="tl-step kane ${r.leakScore ? 'bad' : 'ok'}"><div class="dot">K</div><div><b>Kane · ${esc(r.label)}</b><span>leak ${r.leakScore}/100</span></div></div>`;
    return (i ? '<div class="tl-arrow">→</div>' : '') + (prevAgent ? prevAgent + '<div class="tl-arrow">→</div>' : '') + isKane;
  }).join('');

  const chips = (facts) => facts?.length ? `<div class="facts">${facts.map((f) => `<span class="fact ${f.ok ? 'ok' : 'bad'}"><i>${esc(f.label)}</i>${esc(f.value)}</span>`).join('')}</div>` : '';

  const cards = ids.map((id) => {
    const base = first.checks.find((c) => c.id === id);
    const fin = last.checks.find((c) => c.id === id);
    const failedRound = d.rounds.find((r) => r.checks.find((c) => c.id === id && c.ran && c.status !== 'passed'));
    const failed = failedRound?.checks.find((c) => c.id === id);
    const k = failed ? parseKaneSummary(failed.summary) : null;
    const state = base.status === 'passed' ? 'clean' : fin.status === 'passed' ? 'fixed' : 'open';
    const badge = { clean: 'Clean from the start', fixed: 'Leak found & fixed', open: 'Still leaking' }[state];
    const remarks = failed?.failedRemarks?.length ? `<div class="kv"><span>Failing step</span><p>${esc(failed.failedRemarks.join(' · '))}</p></div>` : '';
    return `<article class="card ${state}">
      <header><div class="ic"><svg viewBox="0 0 24 24">${ICON[id] || ICON.health}</svg></div>
        <div class="ht"><h3>${esc(base.title)}</h3><div class="meta"><span class="sev ${base.severity}">${base.severity}</span><span class="state">${badge}</span></div></div>
        <div class="rounds">${d.rounds.map((r) => `<div><small>${esc(r.label)}</small>${pill(r.checks.find((c) => c.id === id))}</div>`).join('')}</div>
      </header>
      <p class="leak"><b>Why it costs money:</b> ${esc(base.leak)}</p>
      ${k ? `<div class="grid2">
        <div class="box kane"><div class="bh"><span class="tag k">Kane CLI found</span></div>
          <p>${esc(k.problem)}</p>${chips(failed.facts)}${remarks}
          ${k.evidence.length ? `<ul class="ev">${k.evidence.map((e) => `<li><span>${esc(e.kind)}</span><code>${esc(e.detail)}</code></li>`).join('')}</ul>` : ''}
          ${k.suggestion ? `<p class="sug">${esc(k.suggestion)}</p>` : ''}</div>
        <div class="box agent"><div class="bh"><span class="tag a">Claude Code fixed</span></div>
          <p>${agentNotes[id] ? md(agentNotes[id]) : fixed ? 'See full fix notes below.' : 'Run <code>adleak fix</code> to let the agent patch this.'}</p>
          ${state === 'fixed' ? `${chips(fin.facts)}<div class="verified">✓ Re-verified in a real browser by Kane CLI</div>` : ''}</div>
      </div>` : `<div class="box clean"><p>Kane walked this flow and it worked end to end. ${esc(base.note || (base.summary ? parseKaneSummary(base.summary).problem : ''))}</p>${chips(base.facts)}</div>`}
    </article>`;
  }).join('');


  const notes = d.rounds.filter((r) => r.agentSummary).map((r) => `<details><summary>${esc(r.label)}: Claude Code notes</summary><pre>${esc(r.agentSummary)}</pre></details>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AdLeak report · ${esc(d.url)}</title>
<style>
:root{--bg:#0b0d12;--panel:#12151d;--line:#232836;--txt:#e9ecf3;--mut:#8b93a7;--red:#ff5d5d;--red2:#ff5d5d22;--grn:#3ddc97;--grn2:#3ddc9722;--amb:#ffb84d;--vio:#a78bfa;--blu:#60a5fa}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;font:15px/1.55 Inter,ui-sans-serif,system-ui,Segoe UI,Arial,sans-serif;color:var(--txt);
background:radial-gradient(900px 500px at 15% -10%,#ff5d5d18,transparent 60%),radial-gradient(900px 500px at 90% 0%,#3ddc9714,transparent 60%),var(--bg)}
.wrap{max-width:1120px;margin:0 auto;padding:40px 24px 80px}
a{color:inherit}code{font:12.5px ui-monospace,SFMono-Regular,Consolas,monospace}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em;font-size:18px}
.brand i{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--red),var(--amb));display:grid;place-items:center;font-style:normal;font-size:15px}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--panel);padding:6px 12px;border-radius:99px;font-size:13px;color:var(--mut)}
.badge b{color:var(--grn)}
h1{font-size:clamp(30px,4.4vw,50px);line-height:1.05;letter-spacing:-.035em;margin:34px 0 10px;max-width:820px}
h1 em{font-style:normal;background:linear-gradient(90deg,var(--red),var(--amb));-webkit-background-clip:text;background-clip:text;color:transparent}
h1 em.g{background:linear-gradient(90deg,var(--grn),#7ee8fa);-webkit-background-clip:text;background-clip:text}
.url{color:var(--mut);font-size:14px}.url code{color:var(--txt);background:var(--panel);border:1px solid var(--line);padding:2px 8px;border-radius:6px}
.hero{display:grid;grid-template-columns:auto auto auto 1fr;gap:18px;align-items:stretch;margin-top:30px}
.gauge{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:22px 22px 18px;text-align:center;min-width:200px}
.gauge svg{width:150px;height:150px;transform:rotate(-90deg)}.gauge .track{fill:none;stroke:var(--line);stroke-width:12}
.gauge .bar{fill:none;stroke-width:12;stroke-linecap:round;transition:stroke-dashoffset 1.2s ease}
.gauge.bad .bar{stroke:var(--red);filter:drop-shadow(0 0 10px #ff5d5d66)}.gauge.ok .bar{stroke:var(--grn);filter:drop-shadow(0 0 10px #3ddc9766)}
.ring{position:relative;width:150px;height:150px;margin:0 auto}.ring svg{display:block}
.gv{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}.gv b{font-size:38px;letter-spacing:-.04em}.gv span{color:var(--mut);font-size:12px;margin-top:4px}
.gauge.bad .gv b{color:var(--red)}.gauge.ok .gv b{color:var(--grn)}
.gl{font-weight:700;margin-top:6px}.gs{color:var(--mut);font-size:13px}
.arrow{align-self:center;font-size:28px;color:var(--mut);margin:0 -6px}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.stat b{display:block;font-size:26px;letter-spacing:-.03em}.stat span{color:var(--mut);font-size:13px}
.stat.money b{color:var(--grn)}
.hero.single{grid-template-columns:auto 1fr}.stats .stat{display:flex;flex-direction:column;justify-content:center}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.14em;color:var(--mut);margin:48px 0 14px;font-weight:700}
.timeline{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
.tl-step{display:flex;align-items:center;gap:10px;padding:8px 12px 8px 8px;border-radius:12px;background:#ffffff06;border:1px solid var(--line)}
.tl-step .dot{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-weight:800;font-size:13px}
.tl-step b{display:block;font-size:13.5px}.tl-step span{font-size:12px;color:var(--mut)}
.tl-step.kane.bad .dot{background:var(--red2);color:var(--red)}.tl-step.kane.ok .dot{background:var(--grn2);color:var(--grn)}
.tl-step.agent .dot{background:#a78bfa22;color:var(--vio)}.tl-arrow{color:var(--mut)}
.cards{display:grid;gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:20px 22px;position:relative;overflow:hidden}
.card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px}
.card.fixed:before{background:linear-gradient(var(--red),var(--grn))}.card.open:before{background:var(--red)}.card.clean:before{background:var(--grn)}
.card header{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ic{width:42px;height:42px;border-radius:12px;background:#ffffff08;border:1px solid var(--line);display:grid;place-items:center}
.ic svg{width:20px;height:20px;fill:none;stroke:var(--txt);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ht{flex:1;min-width:220px}.ht h3{margin:0;font-size:17px;letter-spacing:-.01em}
.meta{display:flex;gap:8px;align-items:center;margin-top:4px;font-size:12px}
.sev{padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;font-size:10.5px}
.sev.critical{background:var(--red2);color:var(--red)}.sev.high{background:#ffb84d22;color:var(--amb)}.sev.medium{background:#60a5fa22;color:var(--blu)}
.state{color:var(--mut)}.card.fixed .state{color:var(--grn)}.card.open .state{color:var(--red)}
.rounds{display:flex;gap:8px;flex-wrap:wrap}.rounds div{display:flex;flex-direction:column;gap:4px;align-items:center}
.rounds small{font-size:10.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em}
.pill{font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px;white-space:nowrap}.pill a{text-decoration:none}
.pill.ok{background:var(--grn2);color:var(--grn)}.pill.bad{background:var(--red2);color:var(--red)}.pill.carry,.pill.skip{background:#ffffff08;color:var(--mut)}
.leak{color:var(--mut);margin:14px 0 0;font-size:14px}.leak b{color:var(--txt);font-weight:600}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.box{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:#ffffff04}.box p{margin:6px 0}
.box.clean{margin-top:14px;color:var(--mut)}
.tag{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;padding:3px 8px;border-radius:6px}
.tag.k{background:var(--red2);color:var(--red)}.tag.a{background:#a78bfa22;color:var(--vio)}
.ev{list-style:none;padding:0;margin:10px 0;display:grid;gap:6px}
.ev li{display:flex;gap:8px;align-items:flex-start;background:#0006;border:1px solid var(--line);border-radius:8px;padding:6px 8px}
.ev span{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--amb);white-space:nowrap;padding-top:1px}
.ev code{color:#ffd7d7;word-break:break-word}
.sug{color:var(--mut);font-size:13.5px;border-top:1px dashed var(--line);padding-top:8px}
.kv span{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em}.kv p{font-size:13.5px}
.facts{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.fact{display:inline-flex;gap:6px;align-items:center;font-size:12.5px;font-weight:600;padding:4px 10px;border-radius:8px;border:1px solid var(--line)}
.fact i{font-style:normal;color:var(--mut);font-weight:500}.fact.ok{background:var(--grn2);color:var(--grn)}.fact.bad{background:var(--red2);color:var(--red)}
.verified{margin-top:10px;display:inline-block;font-size:12.5px;font-weight:700;color:var(--grn);background:var(--grn2);padding:5px 10px;border-radius:8px}
details{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 16px;margin-bottom:10px}
summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;color:var(--mut);font:13px/1.6 ui-monospace,Consolas,monospace;margin:12px 0 0}
footer{margin-top:50px;color:var(--mut);font-size:13px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;border-top:1px solid var(--line);padding-top:18px}
@media(max-width:980px){.hero{grid-template-columns:1fr 1fr}.hero .stats{grid-column:1/-1}}@media(max-width:860px){.hero{grid-template-columns:1fr}.arrow{display:none}.grid2{grid-template-columns:1fr}.gauge{min-width:0}}
@media print{html,body{background:#0b0d12;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="wrap">
<div class="top"><div class="brand"><i>💸</i>AdLeak</div><div class="badge">Verified with <b>Kane CLI</b> · fixed by Claude Code</div></div>

<h1>${fixed && !after
    ? `Your landing was leaking <em>${before}%</em> of its ad budget. Now it's <em class="g">0%</em>.`
    : fixed ? `Leak reduced from <em>${before}</em> to <em class="g">${after}</em>.`
    : before ? `This landing leaks <em>${before}%</em> of its ad budget.` : `No budget leaks found. <em class="g">Clean.</em>`}</h1>
<div class="url">Audited <code>${esc(d.url)}</code> · ${new Date(d.generatedAt).toLocaleString()}</div>

<div class="hero ${fixed ? '' : 'single'}">
  ${gauge(before, 'Before', money(before) !== null ? `≈ $${money(before)}/day at risk` : `${bugsFound} of ${ids.length} checks failing`, before ? 'bad' : 'ok')}
  ${fixed ? `<div class="arrow">→</div>${gauge(after, 'After', money(after) !== null ? `≈ $${money(after)}/day at risk` : `${last.checks.filter((c) => c.status !== 'passed').length} failing`, after ? 'bad' : 'ok')}` : ''}
  <div class="stats">
    ${saved !== null ? `<div class="stat money"><b>$${saved}/day</b><span>budget recovered · ≈ $${saved * 30}/month</span></div>` : ''}
    <div class="stat"><b>${bugsFound}</b><span>leaks found by Kane</span></div>
    <div class="stat"><b>${kaneRuns}</b><span>real-browser Kane runs · ${kaneMin} min${credits ? ` · ${credits} credits` : ''}</span></div>
    ${fixed ? `<div class="stat"><b>${fixRounds}</b><span>Claude Code fix round${fixRounds === 1 ? '' : 's'}</span></div>` : ''}
  </div>
</div>

<h2>The closed loop</h2>
<div class="timeline">${timeline}</div>

<h2>Checks</h2>
<div class="cards">${cards}</div>

${notes ? `<h2>Agent notes</h2>${notes}` : ''}

<footer><span>AdLeak · Kane CLI finds it, Claude Code fixes it, Kane CLI proves it.</span><span>Kanapiya.tech</span></footer>
</div></body></html>`;
}
