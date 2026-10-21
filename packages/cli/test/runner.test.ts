import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { childRunner } from '../src/runner.js';

// Stands in for the CLI: answers by the base's first letter.
const FAKE_CLI = `
const [, , command, base, head, ...rest] = process.argv;
if (base.startsWith('f')) {
  process.stderr.write("hint: try --plugin angular\\nsymbiote: unknown revision 'x'\\n");
  process.exit(1);
}
if (base.startsWith('s')) {
  process.send({ phase: 'checkout' });
  setInterval(() => {}, 1000);
} else {
  for (const phase of ['checkout', 'loadBase', 'loadHead']) process.send({ phase });
  process.stderr.write('warning: tsconfig.json not found\\n');
  process.stdout.write(JSON.stringify({ command, base, head, rest, pid: process.pid }));
}
`;

describe('childRunner', () => {
  const dir = tempDir();
  const script = join(dir, 'fake-cli.mjs');
  writeFileSync(script, FAKE_CLI);
  const stderr: string[] = [];
  const run = childRunner({
    command: [process.execPath, script],
    cwd: dir,
    env: process.env,
    args: ['--plugin', 'qwik'],
    stderr: (text) => stderr.push(text),
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const pair = (letter: string) => ({ base: letter.repeat(40), head: 'b'.repeat(40) });

  it('runs symbiote diff on the pair, directly, and reads its graph and phases', async () => {
    const phases: string[] = [];
    const graph = (await run(pair('a'), {
      onPhase: (phase) => phases.push(phase),
      signal: new AbortController().signal,
    })) as unknown as Record<string, unknown>;
    expect(graph).toMatchObject({
      command: 'diff',
      base: 'a'.repeat(40),
      head: 'b'.repeat(40),
      rest: ['--no-merge-base', '--json', '--plugin', 'qwik'],
    });
    expect(phases).toEqual(['checkout', 'loadBase', 'loadHead']);
    expect(stderr.join('')).toBe('aaaaaaa..bbbbbbb: warning: tsconfig.json not found\n');
  });

  it("fails with the CLI's message", async () => {
    await expect(
      run(pair('f'), { onPhase: () => undefined, signal: new AbortController().signal }),
    ).rejects.toThrow("symbiote: unknown revision 'x'");
  });

  it('stops the process', async () => {
    const controller = new AbortController();
    const running = run(pair('s'), {
      onPhase: () => controller.abort(),
      signal: controller.signal,
    });
    await expect(running).rejects.toThrow('stopped');
  });
});
