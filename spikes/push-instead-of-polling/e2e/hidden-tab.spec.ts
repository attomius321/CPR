// SPIKE: drives `hidden-tab.mjs` (a tab really hidden, over raw CDP) against a fake agent's view.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { serveWorkspaces } from './symbiote.js';

const MODE = process.env.SPIKE_PUSH ?? 'both';
test.setTimeout(5 * 60_000);
test('a tab really hidden behind another', async () => {
  const symbiote = await serveWorkspaces();
  const B = 'feature/watched';
  await fetch(`${symbiote.url}api/workspaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
    body: JSON.stringify({ brief: 'Watched.', branch: B, planFirst: false }),
  });
  symbiote.session(B, { state: 'working' });
  let display = '';
  let xvfb: ReturnType<typeof spawn> | null = null;
  for (let n = 162; n < 200 && !display; n++) {
    if (existsSync(`/tmp/.X${n}-lock`)) continue;
    const server = spawn('Xvfb', [`:${n}`, '-displayfd', '3', '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
    const ready = await new Promise<boolean>((resolve) => {
      (server.stdio[3] as Readable).once('data', () => resolve(true));
      server.once('exit', () => resolve(false));
    });
    if (ready) [display, xvfb] = [`:${n}`, server];
  }
  const dir = mkdtempSync(join(tmpdir(), 'hidden-tab-'));
  const trigger = `touch ${dir}/ready; while [ ! -f ${dir}/done ]; do sleep 0.05; done`;
  const child = spawn(process.execPath, [process.env.SPIKE_HIDDEN_TAB as string, process.env.SPIKE_CHROME as string, display, symbiote.url, '40', trigger], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  while (!existsSync(join(dir, 'ready'))) await new Promise((r) => setTimeout(r, 50));
  const t = Date.now();
  symbiote.session(B, { state: 'blocked', waitingFor: 'permission prompt' });
  symbiote.hook(B, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } });
  writeFileSync(join(dir, 'done'), '');
  await new Promise((r) => child.on('exit', r));
  const result = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? '{}') as { firstWithTheChangeAt?: number | null };
  appendFileSync(
    process.env.SPIKE_RESULTS as string,
    `${JSON.stringify({ mode: MODE, test: 'tab really hidden 40 s', ...result, arrivedMs: result.firstWithTheChangeAt ? result.firstWithTheChangeAt - t : null })}\n`,
  );
  xvfb?.kill();
  symbiote.stop();
});
