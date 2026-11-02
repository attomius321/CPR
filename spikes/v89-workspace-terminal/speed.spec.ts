// V89's speed check (V21's method): a key typed into the agent's terminal to its echo on screen,
// 30 keys, and the terminal's columns and rows at 1440 x 900; before and after the redesign.
//
//   cd packages/viewer && env -u WAYLAND_DISPLAY \
//     npx playwright test --config ../../spikes/v89-workspace-terminal/playwright.config.ts speed
import { expect, test } from '@playwright/test';
import {
  serveWorkspaces,
  type RunningWorkspaces,
} from '../../packages/viewer/e2e/symbiote.js';

let symbiote: RunningWorkspaces;
test.afterEach(() => symbiote?.stop());

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;

test('a key to its echo, and the terminal size', async ({ page }) => {
  symbiote = await serveWorkspaces();
  await page.goto(`${symbiote.url}git`);
  await page.evaluate(async () => {
    const response = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify({
        kind: 'feature',
        title: 'Echo',
        parts: { goal: 'Echo.' },
        branch: 'feature/echo',
        planFirst: false,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  });
  await page.goto(`${symbiote.url}?branch=feature/echo`);
  const rows = page.locator('.agent-terminal .xterm-rows');
  await expect(rows).toContainText('Fake Claude Code');
  await page.locator('.agent-terminal .xterm-helper-textarea').focus();
  const times: number[] = [];
  for (let i = 0; i < 30; i++) {
    const key = String.fromCharCode(97 + (i % 26));
    const before = (await rows.textContent()) ?? '';
    const started = Date.now();
    await page.keyboard.type(key);
    await expect.poll(async () => ((await rows.textContent()) ?? '').length).toBeGreaterThan(
      before.replace(/\s+$/, '').length,
    );
    times.push(Date.now() - started);
  }
  const size = (await rows.textContent())?.match(/\[(\d+)x(\d+)\]/);
  console.log(
    `echo median ${median(times)} ms, max ${Math.max(...times)} ms; terminal ${size?.[1]} x ${size?.[2]}`,
  );
});
