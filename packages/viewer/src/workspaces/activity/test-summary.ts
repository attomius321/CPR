// What a test run printed of its results (V73, decision 515): the counts its runner printed at
// its end — Vitest, Playwright, Jest, pytest, cargo, node's runner, ESLint, TypeScript — and
// nothing when it printed none. Never a count guessed from the command.

export interface TestCounts {
  passed?: number;
  failed?: number;
  flaky?: number;
  skipped?: number;
  /** ESLint's and TypeScript's problems. */
  errors?: number;
  warnings?: number;
}

type Word = 'passed' | 'failed' | 'flaky' | 'skipped';
const WORDS: Record<string, Word> = {
  passed: 'passed',
  pass: 'passed',
  failed: 'failed',
  fail: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
  ignored: 'skipped',
  todo: 'skipped',
};

/** "8 failed | 1 passed | 113 skipped" or "1 failed, 40 passed, 43 total": the words counted. */
function countsIn(list: string): TestCounts | null {
  const counts: TestCounts = {};
  for (const [, n, word] of list.matchAll(/(\d+) (\w+)/g)) {
    const key = word ? WORDS[word] : undefined;
    if (key) counts[key] = (counts[key] ?? 0) + Number(n);
  }
  return Object.keys(counts).length > 0 ? counts : null;
}

/** Each runner's summary: where it is found, and the counts in it. */
const RUNNERS: { pattern: RegExp; read: (match: RegExpMatchArray) => TestCounts | null }[] = [
  // Vitest: "      Tests  8 failed | 1 passed | 113 skipped (122)".
  { pattern: /^\s*Tests\s{2,}(.+?)\s+\(\d+\)\s*$/gm, read: (m) => countsIn(m[1] ?? '') },
  // Jest: "Tests:       1 failed, 2 skipped, 40 passed, 43 total".
  { pattern: /^\s*Tests:\s+(.+)$/gm, read: (m) => countsIn(m[1] ?? '') },
  // pytest: "==== 3 failed, 120 passed, 2 skipped in 4.20s ====".
  { pattern: /^=+ (.+?) in [\d.]+s\b.*=+\s*$/gm, read: (m) => countsIn(m[1] ?? '') },
  // cargo: "test result: FAILED. 3 passed; 1 failed; 0 ignored; …".
  {
    pattern: /^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/gm,
    read: (m) => ({ passed: Number(m[1]), failed: Number(m[2]), skipped: Number(m[3]) }),
  },
  // ESLint: "✖ 3 problems (1 error, 2 warnings)".
  {
    pattern: /✖ \d+ problems? \((\d+) errors?, (\d+) warnings?\)/gm,
    read: (m) => ({ errors: Number(m[1]), warnings: Number(m[2]) }),
  },
  // TypeScript: "Found 2 errors in 1 file." or "Found 1 error.".
  { pattern: /^Found (\d+) errors?\b/gm, read: (m) => ({ errors: Number(m[1]) }) },
];

/** Playwright's and node's runner's lines of their own: "  1 failed", "  253 passed (4.1m)", "# pass 11". */
const LINES =
  /^(?:\s+(\d+) (passed|failed|flaky|skipped)\b(?: \([\d.]+m?s\))?|# (pass|fail) (\d+))\s*$/gm;

/**
 * The counts a test run printed (V73), from its output's end: its runner's last summary (a check
 * running several prints several); null when it printed none.
 */
export function testCounts(output: string): TestCounts | null {
  let found: { index: number; counts: TestCounts } | null = null;
  for (const { pattern, read } of RUNNERS) {
    for (const match of output.matchAll(pattern)) {
      const counts = read(match);
      if (counts && (!found || (match.index ?? 0) >= found.index)) {
        found = { index: match.index ?? 0, counts };
      }
    }
  }
  // Playwright's and node's lines: those after the last summary found, counted together.
  const lines: TestCounts = {};
  let first = -1;
  for (const match of output.matchAll(LINES)) {
    const index = match.index ?? 0;
    if (found && index < found.index) continue;
    const word = WORDS[match[2] ?? match[3] ?? ''];
    const n = Number(match[1] ?? match[4]);
    if (!word) continue;
    if (first < 0) first = index;
    lines[word] = (lines[word] ?? 0) + n;
  }
  if (first >= 0) return lines;
  return found?.counts ?? null;
}

const number = (n: number) => n.toLocaleString('en-US');

/** The counts in words, failures first: "2 failed · 18 passed · 1 flaky · 1 skipped". */
export function countsText(counts: TestCounts): string {
  const parts: string[] = [];
  if (counts.errors)
    parts.push(`${number(counts.errors)} ${counts.errors === 1 ? 'error' : 'errors'}`);
  if (counts.warnings) {
    parts.push(`${number(counts.warnings)} ${counts.warnings === 1 ? 'warning' : 'warnings'}`);
  }
  if (counts.failed) parts.push(`${number(counts.failed)} failed`);
  if (counts.passed !== undefined) parts.push(`${number(counts.passed)} passed`);
  if (counts.flaky) parts.push(`${number(counts.flaky)} flaky`);
  if (counts.skipped) parts.push(`${number(counts.skipped)} skipped`);
  return parts.join(' · ');
}
