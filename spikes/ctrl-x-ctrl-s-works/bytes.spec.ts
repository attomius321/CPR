import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from '../../packages/viewer/e2e/symbiote.js';

// Step 1 of the spike: which bytes Ctrl+X, Ctrl+S and Ctrl+Enter put on the agent's terminal, from
// the key in Chromium to the program's stdin, and whether the page keeps the browser's own Cut
// and Save. The harness's fake Claude Code, with its `attach` swapped for a byte logger.

const DATA = join(import.meta.dirname, 'data');
const POLL = { timeout: 15_000 };
let symbiote: RunningWorkspaces;

test.afterEach(() => symbiote.stop());

/** The harness's fake Claude Code folder: the newest `symbiote-e2e-claude-*` in the temp dir. */
function fakeFolder(): string {
  const dirs = readdirSync(tmpdir())
    .filter((name) => name.startsWith('symbiote-e2e-claude-'))
    .map((name) => join(tmpdir(), name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!dirs[0]) throw new Error('no fake Claude Code folder');
  return dirs[0];
}

/** Everything but `attach` goes to the fake; `attach` logs each read of stdin, raw. */
function swapAttach(fake: string): string {
  renameSync(join(fake, 'claude'), join(fake, 'claude-fake'));
  const log = join(fake, 'bytes.jsonl');
  writeFileSync(
    join(fake, 'claude'),
    `#!/usr/bin/env node
const { spawnSync, execSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'attach') {
  const r = spawnSync(process.execPath, [${JSON.stringify(join(fake, 'claude-fake'))}, ...args], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const log = (entry) => appendFileSync(${JSON.stringify(log)}, JSON.stringify({ at: Date.now(), ...entry }) + '\\n');
const stty = () => execSync('stty -a', { stdio: ['inherit', 'pipe', 'pipe'] }).toString();
log({ stty: stty() });
process.stdin.setRawMode(true);
log({ sttyRaw: stty() });
process.stdout.write('Byte logger ' + args[1] + '\\r\\n> ');
process.stdin.on('data', (buf) => {
  log({ hex: buf.toString('hex') });
  process.stdout.write('[' + buf.toString('hex') + ']');
});
process.on('SIGHUP', () => process.exit(129));
`,
    { mode: 0o755 },
  );
  return log;
}

/** What the page saw of each key: after xterm.js's own handler, whether it took the default. */
async function watchKeys(page: Page) {
  await page.addInitScript(() => {
    const seen: unknown[] = [];
    (window as unknown as { seen: unknown[] }).seen = seen;
    const at = () => Math.round(performance.now());
    // Caught first, read once its dispatch is over: xterm.js stops the keys it sends, so a
    // listener after it never sees them.
    window.addEventListener(
      'keydown',
      (e) => {
        const entry = {
          at: at(),
          type: 'keydown',
          key: e.key,
          code: e.code,
          ctrl: e.ctrlKey,
          target: (e.target as Element).className,
          defaultPrevented: false,
        };
        seen.push(entry);
        setTimeout(() => (entry.defaultPrevented = e.defaultPrevented));
      },
      true,
    );
    for (const type of ['cut', 'copy', 'beforeinput', 'input']) {
      document.addEventListener(type, (e) =>
        seen.push({ at: at(), type, defaultPrevented: e.defaultPrevented }),
      );
    }
  });
}

test('Ctrl+X, Ctrl+S and Ctrl+Enter in the agent terminal: bytes and defaults', async ({
  page,
}) => {
  symbiote = await serveWorkspaces();
  const fake = fakeFolder();
  const log = swapAttach(fake);
  // Every POST of keys to the server, as sent.
  const posts: { at: number; body: string }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/terminals\/[^/]+\/in$/.test(request.url())) {
      posts.push({ at: Date.now(), body: request.postData() ?? '' });
    }
  });
  await watchKeys(page);
  await page.goto(symbiote.url);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const start = page.getByRole('region', { name: 'Start a workspace' });
  await start.getByRole('textbox', { name: 'Title' }).fill('Send now keys');
  await start.getByRole('textbox', { name: 'Goal' }).fill('Send now keys');
  await start.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  const branch = 'feature/send-now-keys';
  const terminal = page
    .getByRole('region', { name: `Workspace ${branch}` })
    .locator('.agent-terminal');
  const rows = terminal.locator('.xterm-rows');
  await expect(rows).toContainText('Byte logger', POLL);
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused(POLL);
  await page.evaluate(() => ((window as unknown as { seen: unknown[] }).seen.length = 0));
  const reads = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { at: number; hex?: string; stty?: string });
  const steps: { label: string; from: number; to?: number }[] = [];
  const step = async (label: string, keys: () => Promise<void>) => {
    const from = reads().filter((r) => r.hex).length;
    await keys();
    // Time for the keys to reach the logger.
    await page.waitForTimeout(800);
    steps.push({ label, from, to: reads().filter((r) => r.hex).length });
  };

  // 1. As the hint says it: Ctrl+X, then Ctrl+S, each pressed and let go (150 ms apart).
  await step('ctrl+x, ctrl+s (each pressed and released, 150 ms apart)', async () => {
    await page.keyboard.press('Control+x');
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+s');
  });
  // 2. Ctrl held down, X then S tapped.
  await step('ctrl held, x then s tapped (100 ms apart)', async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('x');
    await page.waitForTimeout(100);
    await page.keyboard.press('s');
    await page.keyboard.up('Control');
  });
  // 3. Both at once, as fast as Playwright sends them.
  await step('ctrl+x, ctrl+s with no wait', async () => {
    await page.keyboard.press('Control+x');
    await page.keyboard.press('Control+s');
  });
  // 4. Ctrl+Enter, the other key Claude Code binds to send now.
  await step('ctrl+enter', async () => {
    await page.keyboard.press('Control+Enter');
  });
  // 5. Plain Enter, for comparison.
  await step('enter', async () => {
    await page.keyboard.press('Enter');
  });

  const seen = await page.evaluate(() => (window as unknown as { seen: unknown[] }).seen);
  const all = reads();
  const data = all.filter((r) => r.hex);
  const result = {
    steps: steps.map((s) => ({
      label: s.label,
      reads: data.slice(s.from, s.to).map((r) => r.hex),
      gapsMs: data
        .slice(s.from, s.to)
        .map((r, i, list) => (i === 0 ? 0 : r.at - (list[i - 1]?.at ?? r.at))),
    })),
    posts,
    pageEvents: seen,
    sttyBefore: all.find((r) => r.stty)?.stty,
    sttyRaw: (all.find((r) => 'sttyRaw' in r) as { sttyRaw?: string } | undefined)?.sttyRaw,
    screen: await rows.innerText(),
  };
  writeFileSync(join(DATA, 'bytes.json'), JSON.stringify(result, null, 2));
  await page.screenshot({ path: join(DATA, 'bytes.png') });
  expect(result.steps.length).toBe(5);
});
