import ora from 'ora';
import cliProgress from 'cli-progress';

const isTTY = process.stderr.isTTY;

export function createSpinner(text) {
  if (!isTTY) {
    console.error(text);
    return {
      start(msg) { if (msg) console.error(msg); return this; },
      stop() { return this; },
      succeed(msg) { if (msg) console.error(msg); return this; },
      fail(msg) { if (msg) console.error(msg); return this; },
      set text(v) {},
      get text() { return ''; },
    };
  }
  return ora({ text, stream: process.stderr });
}

export function createProgressBar(total, label = 'Progress') {
  if (!isTTY) {
    let lastPct = -1;
    let current = 0;
    return {
      start() {},
      update(val) {
        current = val;
        const pct = Math.floor((current / total) * 100);
        if (pct >= lastPct + 25) { console.error(`${label}: ${pct}%`); lastPct = pct; }
      },
      increment(n = 1) { this.update(current + n); },
      stop() { console.error(`${label}: done`); },
    };
  }
  const bar = new cliProgress.SingleBar({
    format: `${label} |{bar}| {percentage}% | {value}/{total}`,
    stream: process.stderr,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });
  bar.start(total, 0);
  return bar;
}
