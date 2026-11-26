#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pickChecks, objectiveFor } from '../src/checks.js';
import { runKane, getKaneWindow, setKaneWindow } from '../src/kane.js';
import { buildFixPrompt, runClaude } from '../src/agent.js';
import { writeReport, writeLeaderboard, leakScore } from '../src/report.js';
import * as ui from '../src/ui.js';

const c = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[2m', B: '\x1b[1m', x: '\x1b[0m' };

function parseArgs(argv) {
  const [cmd, target, ...rest] = argv;
  const opts = { maxIter: 3, headless: true, out: 'adleak-report', expect: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--dir') opts.dir = rest[++i];
    else if (a === '--max-iter') opts.maxIter = Number(rest[++i]);
    else if (a === '--only') opts.only = rest[++i];
    else if (a === '--budget') opts.budget = Number(rest[++i]);
    else if (a === '--out') opts.out = rest[++i];
    else if (a === '--model') opts.model = rest[++i];
    else if (a === '--ad') opts.ad = rest[++i].replace(/["']/g, '');
    else if (a === '--expect') opts.expect = rest[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--no-submit') opts.noSubmit = true;
    else if (a === '--context') opts.context = rest[++i];
    else if (a === '--headed') opts.headless = false;
  }
  return { cmd, target, opts };
}

function usage() {
  console.log(`${c.B}AdLeak${c.x} — find where your landing page leaks ad budget, then fix it.
Kane CLI finds it, Claude Code fixes it, Kane CLI proves it.

  adleak audit <url | urls.txt> [options]
  adleak fix   <url> --dir <site-source> [--max-iter 3] [options]

Options:
  --budget <usd/day>     turn the leak score into money at risk
  --ad "<ad headline>"   also check the landing repeats the ad's promise (message match)
  --expect ga4,google_ads,meta,yandex,tiktok   pixels that must receive exactly one lead event
  --no-submit            never send a real lead (default for urls.txt / client sites)
  --only cta,form,...    run a subset: cta form utm pixels mobile speed match health
  --headed               watch the browser   --out <dir>   --model <claude model>`);
}

async function runOne(check, url, opts, onStep) {
  const restore = check.window ? getKaneWindow() : null;
  if (check.window) setKaneWindow(check.window);
  try {
    const run = () => runKane(objectiveFor(check, url, opts), { headless: opts.headless, onStep });
    let result = await run();
    // Kane infrastructure hiccups (stalled screenshot, CDP timeout) are not site bugs: retry once.
    if (result.status !== 'passed' && result.status !== 'error' &&
        /stall|screenshot process|cdp|browser (crashed|disconnected)|timed? ?out while/i.test(String(result.summary))) {
      onStep?.({ remark: 'Kane hiccup, retrying once' });
      result = await run();
    }
    if (check.evaluate && result.status !== 'error') {
      const v = check.evaluate(result, opts);
      if (v) {
        result.kaneStatus = result.status;
        result.status = v.status;
        result.facts = v.facts;
        if (v.note && v.status !== 'passed') result.summary = `${v.note}\n${result.summary || ''}`;
        else if (v.note) result.note = v.note;
      }
    }
    return result;
  } finally {
    if (check.window) setKaneWindow(restore || '1920x1080');
  }
}

async function runChecks(url, checks, opts, label) {
  ui.section(label, `${checks.length} Kane CLI run${checks.length === 1 ? '' : 's'} · ${url}`);
  const results = [];
  for (const check of checks) {
    const row = ui.checkRow(check.title);
    const result = await runOne(check, url, opts, (ev) => row.step(ev));
    const extra = (result.facts || []).map(ui.fact);
    if (result.status !== 'passed') extra.push(...ui.reason(String(result.summary || '').split('\n')[0]));
    if (result.status === 'error') extra.push(...result.errors.map((e) => ui.k.red(e)));
    row.done(result, extra);
    results.push({ check, result });
    if (result.status === 'error') break;
  }
  return results;
}

function printScore(results, opts) {
  ui.scoreBar(leakScore(results), opts.budget);
  ui.sectionEnd();
}

function stopOnInfra(results) {
  const infra = results.find((r) => r.result.status === 'error');
  if (!infra) return false;
  ui.sectionEnd();
  ui.log(`${ui.k.bgRed(' Kane CLI could not run ')} ${infra.result.summary}`);
  ui.log(ui.k.amber('This is a setup problem, not a site bug, so AdLeak stops here. Fix it and rerun.'));
  return true;
}

async function auditSite(url, opts) {
  const checks = pickChecks(opts);
  const rounds = [];
  let results = await runChecks(url, checks, opts, 'Kane audit · baseline');
  if (stopOnInfra(results)) process.exit(2);
  printScore(results, opts);
  rounds.push({ label: 'Baseline', results });
  return { checks, rounds, results };
}

async function main() {
  const { cmd, target, opts } = parseArgs(process.argv.slice(2));
  if (!cmd || !target || !['audit', 'fix'].includes(cmd)) return usage();
  ui.banner();

  // Agency mode: a text file with one URL per line -> one report per site + leaderboard.
  if (cmd === 'audit' && fs.existsSync(target) && fs.statSync(target).isFile()) {
    const urls = fs.readFileSync(target, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    opts.noSubmit = true;
    ui.log(`${ui.k.bgCyan(' AGENCY MODE ')} ${urls.length} sites · no real leads will be submitted`);
    const sites = [];
    for (const url of urls) {
      const { rounds, results } = await auditSite(url, opts);
      const slug = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '');
      writeReport({ url, rounds, outDir: path.join(opts.out, slug), dailyBudget: opts.budget });
      sites.push({ url, slug, score: leakScore(results), failing: results.filter((r) => r.result.status !== 'passed').map((r) => r.check.title) });
    }
    const file = writeLeaderboard({ sites, outDir: opts.out });
    ui.log('');
    for (const st of [...sites].sort((a, b) => b.score - a.score)) ui.log(`${String(st.score).padStart(3)}/100  ${st.url}`);
    ui.finale({ before: 0, after: Math.max(...sites.map((x) => x.score)), rounds: 0, file });
    return;
  }

  const url = target;
  const { checks, rounds } = await auditSite(url, opts);
  let results = rounds[0].results;

  if (cmd === 'fix') {
    if (!opts.dir || !fs.existsSync(opts.dir)) { ui.log(ui.k.red(opts.dir ? `Folder not found: ${opts.dir} (for the demo run: npm run demo:reset)` : '--dir <site-source> is required for fix')); process.exit(2); }
    const history = [];
    for (let it = 1; it <= opts.maxIter; it++) {
      const failures = results.filter((r) => r.result.status === 'failed' || r.result.status === 'timeout');
      if (!failures.length) break;

      const prompt = buildFixPrompt({ url, dir: opts.dir, failures, iteration: it, history, opts });
      const spin = ui.checkRow(`Claude Code is patching ${failures.length} leak${failures.length === 1 ? '' : 's'}…`);
      const agent = await runClaude(prompt, { dir: opts.dir, model: opts.model });
      spin.done({ status: agent.ok ? 'passed' : 'failed' }, [], 'DONE');
      ui.agentBox(it, failures.length, agent.summary);
      history.push({ iteration: it, agentSummary: agent.summary });
      if (!agent.ok) { ui.log(ui.k.red('Claude Code did not finish cleanly, stopping.')); break; }

      // Kane re-verifies the previously failing checks; fresh evidence feeds the next round.
      const recheck = await runChecks(url, failures.map((f) => f.check), opts, `Kane re-verify · round ${it}`);
      if (recheck.some((r) => r.result.status === 'error')) { stopOnInfra(recheck); break; }
      results = results.map((r) => recheck.find((x) => x.check.id === r.check.id) || r);
      printScore(results, opts);
      rounds.push({ label: `Fix ${it}`, results, agentSummary: agent.summary, ranIds: recheck.map((r) => r.check.id) });
    }

    // Final regression pass: make sure the fixes didn't break checks that were already green.
    if (rounds.length > 1 && results.every((r) => r.result.status === 'passed')) {
      results = await runChecks(url, checks, opts, 'Kane regression · full pass');
      printScore(results, opts);
      rounds.push({ label: 'Regression', results });
    }
  }

  const file = writeReport({ url, rounds, outDir: opts.out, dailyBudget: opts.budget });
  ui.finale({ before: leakScore(rounds[0].results), after: leakScore(results), budget: opts.budget, rounds: rounds.filter((r) => r.agentSummary).length, file });
  process.exit(leakScore(results) === 0 ? 0 : 1);
}

main();
