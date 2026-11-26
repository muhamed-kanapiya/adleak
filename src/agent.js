import spawn from 'cross-spawn';
import path from 'node:path';
import { objectiveFor } from './checks.js';

/**
 * Hand Kane's failures to Claude Code (headless, `claude -p`) and let it patch the site.
 * The prompt goes through stdin to avoid shell-quoting problems on Windows.
 * Only file tools are allowed: the agent edits code, Kane is the one who verifies.
 */
export function buildFixPrompt({ url, dir, failures, iteration, history, opts = {} }) {
  const lines = failures.map((f, i) => [
    `${i + 1}. [${f.check.id}] ${f.check.title} (severity: ${f.check.severity})`,
    `   What Kane CLI tried: ${objectiveFor(f.check, url, opts)}`,
    `   Kane verdict: ${f.result.status.toUpperCase()} — ${f.result.summary || 'no summary'}`,
    ...(f.result.failedRemarks?.length ? [`   Failing steps: ${f.result.failedRemarks.join(' | ')}`] : []),
    ...(f.result.facts?.length ? [`   Measured: ${f.result.facts.map((x) => `${x.label}: ${x.value}`).join(', ')}`] : []),
    `   Business impact: ${f.check.leak}`,
  ].join('\n'));

  const prev = history.length
    ? `\nPrevious fix attempts (Kane still reports the issues above afterwards, so try a different approach):\n${history.map((h) => `- iteration ${h.iteration}: ${h.agentSummary}`).join('\n')}\n`
    : '';

  return `You are fixing a paid-traffic landing page. A real browser agent (Kane CLI) just tested ${url}
and found these conversion / tracking problems (iteration ${iteration}):

${lines.join('\n\n')}
${prev}
The site source is in the current working directory (${path.resolve(dir)}). It is served live, so saved edits are
picked up on the next page load. Do not change server / backend code.
${opts.context ? `Project context: ${opts.context}\n` : ''}${opts.ad ? `The ad that drives traffic here says: "${opts.ad}". You may edit page copy so the first screen repeats that promise.\n` : ''}${opts.expect?.length ? `These ad platforms must each receive exactly one lead/conversion event per submitted lead: ${opts.expect.join(', ')}.\n` : ''}

Rules:
- Find the root cause of each failure in the HTML/CSS/JS and fix it with minimal, clean edits.
- Do not remove features, do not fake success, do not hard-code test values to pass the checks.
- Keep existing tracking IDs; if one is missing and the page already defines it elsewhere, reuse it. Never invent new account IDs.
- After editing, reply with a short plain-text list: one line per issue id, what was wrong and what you changed.`;
}

export function runClaude(prompt, { dir, model } = {}) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Edit,Write,Glob,Grep'];
    if (model) args.push('--model', model);
    const child = spawn('claude', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => resolve({ ok: false, summary: `Could not start Claude Code: ${e.message}` }));
    child.on('close', (code) => {
      let summary = out.trim();
      try {
        const j = JSON.parse(out);
        summary = j.result ?? summary;
        resolve({ ok: !j.is_error && code === 0, summary, costUsd: j.total_cost_usd, turns: j.num_turns });
      } catch {
        resolve({ ok: code === 0, summary: summary || err.trim() });
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
