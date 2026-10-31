import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HiveLogLine } from '@symbiote/core';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { reviewNow } from '../src/hive-live.js';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const line = (l: HiveLogLine) => `${JSON.stringify(l)}\n`;

describe("what a running review's log says it runs now (decision 697)", () => {
  it("read by the card and the Review tab at once, it still says the reviewer's next call", async () => {
    const dir = tempDir();
    folders.push(dir);
    const file = join(dir, 'review.jsonl');
    writeFileSync(file, line({ at: 1, step: 'review', title: 'The reviewer' }));
    // The workspaces' list (the card) and `/api/workspaces/hive` (the Review tab) read it together.
    const [card, tab] = await Promise.all([reviewNow(file), reviewNow(file)]);
    expect(card).toMatchObject({ phase: 'review', title: 'The reviewer' });
    expect(tab).toMatchObject({ phase: 'review', title: 'The reviewer' });
    // The reviewer runs a command.
    appendFileSync(
      file,
      line({
        at: 2,
        agent: {
          tool: 'Bash',
          input: 'pnpm vitest run packages/cli/test/hive-live.test.ts -t "the reviewer\'s call"',
        },
      }),
    );
    expect(await reviewNow(file)).toMatchObject({
      phase: 'review',
      doing: 'Bash: pnpm vitest run packages/cli/test/hive-live.test.ts -t "the reviewer\'s call"',
    });
  });
});
