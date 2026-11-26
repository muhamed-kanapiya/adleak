// Terminal UI: zero-dependency ANSI rendering with a live spinner that shows
// what Kane is doing right now. Falls back to plain lines when not a TTY (CI).

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const esc = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const k = {
  red: esc('38;5;203'), green: esc('38;5;78'), amber: esc('38;5;214'), cyan: esc('38;5;81'),
  violet: esc('38;5;141'), dim: esc('2'), bold: esc('1'), gray: esc('38;5;245'),
  bgRed: esc('48;5;52;38;5;210'), bgGreen: esc('48;5;22;38;5;120'), bgViolet: esc('48;5;54;38;5;189'), bgCyan: esc('48;5;24;38;5;153'),
};

const width = () => Math.min(process.stdout.columns || 100, 110);
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - strip(s).length));
const trunc = (s, n) => (strip(s).length > n ? strip(s).slice(0, n - 1) + '…' : s);

function wrap(text, n) {
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      if ((line + ' ' + w).trim().length > n) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim();
    }
    out.push(line);
  }
  return out;
}

export function banner() {
  const g = [203, 209, 215, 221, 185, 149, 114, 78];
  const art = [
    ' █████╗ ██████╗ ██╗     ███████╗ █████╗ ██╗  ██╗',
    '██╔══██╗██╔══██╗██║     ██╔════╝██╔══██╗██║ ██╔╝',
    '███████║██║  ██║██║     █████╗  ███████║█████╔╝ ',
    '██╔══██║██║  ██║██║     ██╔══╝  ██╔══██║██╔═██╗ ',
    '██║  ██║██████╔╝███████╗███████╗██║  ██║██║  ██╗',
    '╚═╝  ╚═╝╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝',
  ];
  console.log('');
  for (const line of art) {
    if (!tty) { console.log('  ' + line); continue; }
    const step = Math.ceil(line.length / g.length);
    let s = '';
    for (let i = 0; i < line.length; i++) s += `\x1b[38;5;${g[Math.min(g.length - 1, Math.floor(i / step))]}m${line[i]}`;
    console.log('  ' + s + '\x1b[0m');
  }
  console.log(`  ${k.gray('Find where your landing leaks ad budget.')} ${k.red('Kane CLI')} ${k.gray('finds it ·')} ${k.violet('Claude Code')} ${k.gray('fixes it ·')} ${k.red('Kane CLI')} ${k.gray('proves it')}`);
}

export function section(title, sub = '') {
  const w = width() - 4;
  const head = `${k.bold(title)}${sub ? '  ' + k.gray(sub) : ''}`;
  console.log('');
  console.log('  ' + k.gray('╭─ ') + head + ' ' + k.gray('─'.repeat(Math.max(2, w - strip(head).length - 4))));
}
export function sectionEnd() {
  console.log('  ' + k.gray('╰' + '─'.repeat(width() - 5)));
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function checkRow(title) {
  const started = Date.now();
  let remark = 'opening Chrome';
  let steps = 0;
  let i = 0;
  const render = () => {
    const t = Math.round((Date.now() - started) / 1000);
    const left = `  ${k.gray('│')} ${k.cyan(FRAMES[i++ % FRAMES.length])} ${pad(title, 49)} ${k.gray(String(t).padStart(3) + 's')}`;
    const room = width() - strip(left).length - 6;
    const line = `${left}  ${k.dim(trunc(`step ${steps} › ${remark}`, Math.max(10, room)))}`;
    process.stdout.write(`\r\x1b[2K${line}`);
  };
  const timer = tty ? setInterval(render, 90) : null;
  if (tty) render();
  return {
    step(ev) { steps++; if (ev.remark) remark = String(ev.remark).replace(/\s+/g, ' '); },
    done(result, extraLines = [], label) {
      if (timer) clearInterval(timer);
      const t = `${Math.round(result.durationSec || (Date.now() - started) / 1000)}s`;
      const ok = result.status === 'passed';
      const badge = label ? (ok ? k.bgViolet(` ${label} `) : k.bgRed(' FAIL ')) : ok ? k.bgGreen(' PASS ') : result.status === 'error' ? k.bgRed(' ERR  ') : k.bgRed(' LEAK ');
      const line = `  ${k.gray('│')} ${badge} ${pad(ok ? title : k.bold(title), 49)} ${k.gray(t.padStart(4))}`;
      if (tty) process.stdout.write(`\r\x1b[2K${line}\n`); else console.log(line);
      for (const l of extraLines) console.log(`  ${k.gray('│')}        ${l}`);
    },
  };
}

export function fact(f) {
  return `${f.ok ? k.green('●') : k.red('●')} ${k.gray(f.label + ':')} ${f.ok ? k.green(f.value) : k.red(f.value)}`;
}

export function reason(text) {
  const n = width() - 16;
  return wrap(text, n).slice(0, 3).map((l) => k.amber(l));
}

export function scoreBar(score, budget) {
  const n = 30;
  const filled = Math.round((score / 100) * n);
  const color = score === 0 ? k.green : score < 40 ? k.amber : k.red;
  const bar = color('█'.repeat(filled)) + k.gray('░'.repeat(n - filled));
  const money = budget ? `  ${k.gray('≈')} ${color(`$${Math.round((budget * score) / 100)}/day`)} ${k.gray('at risk')}` : '';
  console.log(`  ${k.gray('│')}`);
  console.log(`  ${k.gray('│')} ${k.bold('Budget leak')}  ${bar}  ${color(k.bold(String(score).padStart(3)))}${k.gray('/100')}${money}`);
}

export function agentBox(round, count, summary) {
  section(`✦ Claude Code · round ${round}`, `fixing ${count} leak${count === 1 ? '' : 's'} reported by Kane`);
  const n = width() - 10;
  const lines = String(summary || '').split(/\r?\n/).filter((l) => l.trim());
  for (const raw of lines.slice(0, 18)) {
    const m = raw.match(/^\s*(?:\d+\.|-|\*)\s*\[?([a-z]+)\]?:?\s*(.*)$/i);
    if (m) {
      const w = wrap(m[2], n - 12);
      console.log(`  ${k.gray('│')} ${k.bgViolet(` ${m[1].slice(0, 10).padEnd(10)} `)} ${w[0] || ''}`);
      for (const x of w.slice(1)) console.log(`  ${k.gray('│')}              ${x}`);
    } else {
      for (const x of wrap(raw, n)) console.log(`  ${k.gray('│')} ${k.dim(x)}`);
    }
  }
  sectionEnd();
}

export function finale({ before, after, budget, rounds, file }) {
  const color = (s) => (s === 0 ? k.green : s < 40 ? k.amber : k.red);
  console.log('');
  if (rounds > 0) {
    const saved = budget ? Math.round((budget * (before - after)) / 100) : null;
    console.log(`  ${k.bold('Leak score')}   ${color(before)(k.bold(String(before)))}  ${k.gray('──▶')}  ${color(after)(k.bold(String(after)))}   ${k.gray(`in ${rounds} fix round${rounds === 1 ? '' : 's'}`)}${saved ? `   ${k.green(k.bold(`+$${saved}/day`))} ${k.gray(`recovered (≈ $${saved * 30}/month)`)}` : ''}`);
  } else {
    console.log(`  ${k.bold('Leak score')}   ${color(after)(k.bold(String(after)))}${k.gray('/100')}${budget ? `   ${k.gray('≈')} ${color(after)(`$${Math.round((budget * after) / 100)}/day`)} ${k.gray('at risk')}` : ''}`);
  }
  console.log(`  ${k.bold('Report')}       ${k.cyan(file)}`);
  console.log('');
}

export const log = (s = '') => console.log(s ? `  ${s}` : '');
