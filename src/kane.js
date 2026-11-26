import spawn from 'cross-spawn';

/**
 * Run one Kane CLI objective in agent mode and return a normalized result.
 * Kane prints NDJSON on stdout; the terminal event is {type:"run_end"}.
 * Exit codes: 0 passed, 1 failed, 2 auth/infra error, 3 timeout/cancelled.
 */
export function runKane(objective, { headless = true, timeoutSec = 240, maxSteps = 30, onStep } = {}) {
  return new Promise((resolve) => {
    const args = ['run', objective, '--agent', '--max-steps', String(maxSteps), '--timeout', String(timeoutSec)];
    if (headless) args.push('--headless');

    const started = Date.now();
    const child = spawn('kane-cli', args, {
      env: { ...process.env, KANE_CLI_USER_AGENT: 'adleak' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buf = '';
    let stderr = '';
    const steps = [];
    let runEnd = null;
    const errors = [];

    const handleLine = (line) => {
      line = line.trim();
      if (!line.startsWith('{')) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'run_end') runEnd = ev;
      else if (ev.type === 'error') errors.push(ev.message || JSON.stringify(ev));
      else if (!ev.type && ev.step !== undefined) {
        steps.push({ step: ev.step, status: ev.status, remark: ev.remark });
        if (onStep) onStep(ev);
      }
    };

    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      resolve({
        status: 'error', exitCode: -1, steps, errors: [`Could not start kane-cli: ${err.message}. Is it installed? npm i -g @testmuai/kane-cli`],
        durationSec: (Date.now() - started) / 1000,
      });
    });

    child.on('close', (code) => {
      if (buf) handleLine(buf);
      const evidence = (stderr.match(/evidence:.*?`([^`]+)`/) || [])[1];
      let status = 'error';
      if (runEnd?.status === 'passed' || code === 0) status = 'passed';
      else if (runEnd?.status === 'failed' || code === 1) status = 'failed';
      else if (code === 3) status = 'timeout';
      // Auth / infra problems are not site bugs: never hand them to the fixing agent.
      const text = `${runEnd?.summary || ''} ${runEnd?.reason || ''} ${errors.join(' ')} ${stderr}`;
      if (code === 2 || /not authenticated|kane-cli login|insufficient credits/i.test(text)) status = 'error';

      const failedSteps = steps.filter((s) => s.status === 'failed');
      resolve({
        status,
        exitCode: code,
        summary: runEnd?.summary || runEnd?.reason || errors[0] || stderr.trim().split('\n').slice(-3).join(' '),
        oneLiner: runEnd?.one_liner,
        reason: runEnd?.reason,
        credits: runEnd?.credits_consumed,
        testUrl: runEnd?.test_url,
        finalState: runEnd?.final_state,
        failedRemarks: failedSteps.map((s) => s.remark).filter(Boolean),
        steps,
        errors,
        evidence: evidence ? `kane-cli evidence serve ${evidence}` : undefined,
        durationSec: runEnd?.duration ?? (Date.now() - started) / 1000,
      });
    });
  });
}

// Kane has no per-run window flag, so the mobile check switches the global
// window size and restores it afterwards.
export function getKaneWindow() {
  const r = spawn.sync('kane-cli', ['config', 'show'], { encoding: 'utf8' });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const line = text.split(/\r?\n/).find((l) => /window/i.test(l)) || '';
  const m = line.match(/(\d{3,4})\s*[x×,]\s*(\d{3,4})/) || line.match(/width\D+(\d{3,4}).*height\D+(\d{3,4})/i);
  return m ? `${m[1]}x${m[2]}` : null;
}

export function setKaneWindow(size) {
  const r = spawn.sync('kane-cli', ['config', 'set-window', size], { encoding: 'utf8' });
  return r.status === 0;
}
