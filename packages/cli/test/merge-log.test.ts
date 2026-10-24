import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { MergeLogLine } from '@symbiote/core';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { mergeLogs, STEP_END, STEP_START } from '../src/merge-log.js';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function logs() {
  const dir = join(tempDir(), 'merges');
  folders.push(dir);
  return { dir, logs: mergeLogs(dir) };
}

const outs = (lines: readonly MergeLogLine[]) =>
  lines.flatMap((line) => ('out' in line ? [line.out] : []));

describe("a merge's log file (V46a)", () => {
  it('appends each line as JSON, and reads on from an offset', async () => {
    const { logs: all } = logs();
    const log = all.of('a');
    log.step('check', 'pnpm check');
    log.out('one\n');
    const first = await all.read('a', 0);
    expect(first.lines).toMatchObject([{ step: 'check', title: 'pnpm check' }, { out: 'one\n' }]);
    log.out('two\n');
    log.end(true);
    const next = await all.read('a', first.next);
    expect(next.lines).toMatchObject([{ out: 'two\n' }, { end: { ok: true } }]);
    expect(next.next).toBeGreaterThan(first.next);
    expect(await all.read('a', next.next)).toEqual({ lines: [], next: next.next });
  });

  it('leaves a line being written for the next read', async () => {
    const { dir, logs: all } = logs();
    all.of('a').out('whole\n');
    appendFileSync(join(dir, 'a.jsonl'), '{"at":1,"out":"ha');
    const read = await all.read('a', 0);
    expect(outs(read.lines)).toEqual(['whole\n']);
    appendFileSync(join(dir, 'a.jsonl'), 'lf"}\n');
    expect(outs((await all.read('a', read.next)).lines)).toEqual(['half']);
  });

  it('reads a log that does not exist as empty', async () => {
    const { logs: all } = logs();
    expect(await all.read('none', 0)).toEqual({ lines: [], next: 0 });
  });

  it("keeps a step's start as it comes and, past it, only its end, saying how much was left out", async () => {
    const { dir, logs: all } = logs();
    const log = all.of('a');
    log.step('check', 'loud');
    const chunk = `${'x'.repeat(1023)}\n`;
    const chunks = Math.ceil((STEP_START + STEP_END * 3) / chunk.length);
    for (let i = 0; i < chunks; i++) log.out(i === chunks - 1 ? 'the end\n' : chunk);
    // While it runs, only the start is written.
    const running = outs((await all.read('a', 0)).lines).join('');
    expect(running.length).toBeLessThanOrEqual(STEP_START + chunk.length);
    log.end(false);
    const text = outs((await all.read('a', 0)).lines).join('');
    expect(text.startsWith('x')).toBe(true);
    expect(text.endsWith('the end\n')).toBe(true);
    expect(text).toMatch(/… [\d,.]+ (KB|MB) of output not kept …/);
    expect(readFileSync(join(dir, 'a.jsonl'), 'utf8').length).toBeLessThan(
      STEP_START + STEP_END + 64 * 1024,
    );
  });

  it('starts each step counting its own output', async () => {
    const { logs: all } = logs();
    const log = all.of('a');
    log.step('check', 'loud');
    log.out('x'.repeat(STEP_START + 10));
    log.end(true);
    log.step('check', 'quiet');
    log.out('quiet\n');
    expect(outs((await all.read('a', 0)).lines).at(-1)).toBe('quiet\n');
  });

  it('ends only a step it started: an end without one writes nothing', async () => {
    const { logs: all } = logs();
    const log = all.of('a');
    log.out('before any step\n');
    log.end(false);
    expect((await all.read('a', 0)).lines).toMatchObject([{ out: 'before any step\n' }]);
  });

  it('removes a log, and every log but those kept', async () => {
    const { logs: all } = logs();
    all.of('a').out('a\n');
    all.of('b').out('b\n');
    all.of('c').out('c\n');
    await all.remove('a');
    await all.prune(new Set(['b']));
    expect(await all.read('a', 0)).toEqual({ lines: [], next: 0 });
    expect(outs((await all.read('b', 0)).lines)).toEqual(['b\n']);
    expect(await all.read('c', 0)).toEqual({ lines: [], next: 0 });
  });
});
