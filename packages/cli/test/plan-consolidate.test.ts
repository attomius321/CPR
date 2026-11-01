import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepo, type TestRepo } from '../../core/test/helpers/git-repo.js';

// `scripts/plan/consolidate.mjs` (chore/living-docs, decisions 777–779): a replaced decision's
// status written on its row, the register of every decision, and the links from an area's plans
// and index heading to the area's page of what holds now.
const script = fileURLToPath(new URL('../../../scripts/plan/consolidate.mjs', import.meta.url));

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

const INDEX = `# Plan

## How the plan is kept

- Read the index.

## Index

### Reviews

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V1](plan/v1-a.md) | A | ✅ | 1–3, 10 | [journal](journal/v1-a.md) |
| [V2](plan/v2-b.md) | B | ✅ | 4–6 | [journal](journal/v2-b.md) |

### The merger

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V3](plan/v3-c.md) | C | ✅ | 7–11 | [journal](journal/v3-c.md) |
| Fix | D | ✅ | | [journal](journal/fix-d.md) |
`;

const HEAD = '| # | Question | Decision | Why |\n|---|---|---|---|\n';

const plan = (id: string, file: string, rows: string, after = '') =>
  `# ${id} — a plan\n\n[Index](../PLAN.md) · [Journal](../journal/${file})\n\n` +
  `**Status:** merged into main (2026-10-20, from branch \`milestone/${file}\`).\n\n` +
  `**Decisions**:\n\n${HEAD}${rows}${after}`;

const V1 = plan(
  'V1',
  'v1-a.md',
  '| 1 | What Approve does | **Pushes** | asked |\n' +
    '| 2 | Where reviews live | **`symbiote/reviews/`** | asked |\n' +
    '| 3 | Badge marks (see [V2](v2-b.md), [below](#runs)) | **✓ and ✗** | asked |\n' +
    '| 10 | Twice, here | **one** | the first |\n',
);
const V2 = plan(
  'V2',
  'v2-b.md',
  '| 4 | What Approve does (supersedes 1) | **Records** | asked |\n' +
    "| 5 | Where it lands (replaces 2's folder and 3) | **There** | asked |\n" +
    '| 6 | Unrelated, 44 % of runs | **1,312 px** | 12 replaces nothing here |\n',
);
const V3 = plan(
  'V3',
  'v3-c.md',
  `| 7 | Who merges (replaces 4's "the agent merges") | **Symbiote** | asked |\n` +
    "| 8 | Layout | **Full width** (replaces 378, 6's centring, 5's 1,312 px) | asked |\n" +
    '| 9 | Something (supersedes 10) | **x** | asked |\n' +
    '| 10 | Twice, there | **two** | the second |\n' +
    "| 11 | Pushing (replaces 1's push) | **Off** | asked |\n",
  '\n**Runs**:\n\n| # | Change | Label |\n|---|---|---|\n| 1 | install (replaces 2) | ok |\n',
);
const DESIGN = `# Design\n\n**Decisions**:\n\n${HEAD}| 12 | The first rule | **This** | v1 |\n`;
const PAGE =
  '# Reviews\n\n[Index](../PLAN.md)\n\nWhat holds now. The code: `src/reviews.ts`, `src/base.ts` and\n' +
  '`src/gone.ts`; the journal, `docs/JOURNAL.md`.\n';

let repo: TestRepo;

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repo.root,
    env,
    encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const read = (path: string) => readFileSync(join(repo.root, path), 'utf8');
/** The row of decision `n` in a file (the first when it has two). */
const row = (path: string, n: number) =>
  read(path)
    .split('\n')
    .find((line) => line.startsWith(`| ${n} |`));

beforeEach(() => {
  repo = createRepo();
  repo.write({
    'docs/PLAN.md': INDEX,
    'docs/plan/v1-a.md': V1,
    'docs/plan/v2-b.md': V2,
    'docs/plan/v3-c.md': V3,
    'docs/plan/design.md': DESIGN,
    'docs/area/reviews.md': PAGE,
    'docs/JOURNAL.md': '# Journal\n',
    'src/reviews.ts': 'export {};\n',
    'src/base.ts': 'export {};\n',
  });
  repo.commit('Docs');
});

afterEach(() => repo.cleanup());

describe('consolidate.mjs', () => {
  it('lists what it would change and changes nothing without --write', () => {
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain('mark  1  superseded by 4 of V2; partly by 11 of V3');
    expect(read('docs/plan/v1-a.md')).toBe(V1);
    expect(read('docs/PLAN.md')).toBe(INDEX);
    expect(() => read('docs/decisions.md')).toThrow();
  });

  it('writes on the older row what replaced it, wholly or in part', () => {
    expect(run('--write').code).toBe(0);
    expect(row('docs/plan/v1-a.md', 1)).toBe(
      '| 1 | What Approve does *(superseded by 4 of V2; partly by 11 of V3)* | **Pushes** | asked |',
    );
    expect(row('docs/plan/v1-a.md', 2)).toBe(
      '| 2 | Where reviews live *(partly superseded by 5 of V2)* | **`symbiote/reviews/`** | asked |',
    );
    expect(row('docs/plan/v1-a.md', 3)).toBe(
      '| 3 | Badge marks (see [V2](v2-b.md), [below](#runs)) *(superseded by 5 of V2)* | **✓ and ✗** | asked |',
    );
    expect(row('docs/plan/v2-b.md', 4)).toBe(
      `| 4 | What Approve does (supersedes 1) *(partly superseded by 7 of V3)* | **Records** | asked |`,
    );
    expect(row('docs/plan/v2-b.md', 5)).toContain('*(partly superseded by 8 of V3)*');
    expect(row('docs/plan/v2-b.md', 6)).toBe(
      '| 6 | Unrelated, 44 % of runs *(partly superseded by 8 of V3)* | **1,312 px** | 12 replaces nothing here |',
    );
  });

  it('leaves a number used twice, a number no decision has and other tables alone, and says so', () => {
    const { out } = run('--write');
    expect(out).toContain('note  9 of V3: decision 10 is in V1 and V3: not marked');
    expect(out).toContain('note  8 of V3: no decision 378');
    expect(read('docs/plan/v3-c.md')).toContain('| 10 | Twice, there | **two** | the second |');
    expect(read('docs/plan/v1-a.md')).toContain('| 10 | Twice, here | **one** | the first |');
    // The runs table is not a decision table: its "replaces 2" is not read.
    expect(row('docs/plan/v1-a.md', 2)).not.toContain('of V3');
    expect(read('docs/plan/v3-c.md')).toContain('| 1 | install (replaces 2) | ok |');
  });

  it('generates the register by area, with the plans outside the index last', () => {
    run('--write');
    const register = read('docs/decisions.md');
    expect(register).toContain('## Reviews\n\nWhat holds now: [Reviews](area/reviews.md).\n');
    expect(register).toContain(
      '| 1 | What Approve does | superseded by 4 of V2; partly by 11 of V3 | [V1](plan/v1-a.md) |',
    );
    // Links in a question are rebased from plan/ to docs/.
    expect(register).toContain(
      '| 3 | Badge marks (see [V2](plan/v2-b.md), [below](plan/v1-a.md#runs)) | superseded by 5 of V2 | [V1](plan/v1-a.md) |',
    );
    expect(register).toContain(
      '| 4 | What Approve does (supersedes 1) | partly superseded by 7 of V3 | [V2](plan/v2-b.md) |',
    );
    expect(register).toContain('| 9 | Something (supersedes 10) | in force | [V3](plan/v3-c.md) |');
    expect(register).toContain('| 10 | Twice, here | in force | [V1](plan/v1-a.md) |');
    expect(register).toContain('| 10 | Twice, there | in force | [V3](plan/v3-c.md) |');
    expect(register).not.toContain('install');
    const merger = register.indexOf('## The merger');
    const other = register.indexOf('## Not in the index');
    expect(register.indexOf('## Reviews')).toBeLessThan(merger);
    expect(merger).toBeLessThan(other);
    expect(register.slice(other)).toContain(
      '| 12 | The first rule | in force | [design](plan/design.md) |',
    );
    expect(register).toContain('12 decisions, 13 rows');
  });

  it("sends the reader of an area's plans and its index heading to the area's page", () => {
    run('--write');
    expect(read('docs/plan/v1-a.md')).toMatch(
      /^# V1 — a plan\n\n\[Index\]\(\.\.\/PLAN\.md\) · \[Journal\]\(\.\.\/journal\/v1-a\.md\)\n\n> What holds now: \[Reviews\]\(\.\.\/area\/reviews\.md\)\. This plan is kept as it was written\.\n\n\*\*Status:\*\*/,
    );
    // The merger has no page yet: its plan gets no banner.
    expect(read('docs/plan/v3-c.md')).not.toContain('What holds now');
    expect(read('docs/PLAN.md')).toContain(
      '### Reviews\n\nWhat holds now: [Reviews](area/reviews.md) · its decisions: [the register](decisions.md#reviews).\n\n| ID |',
    );
    expect(read('docs/PLAN.md')).toContain('### The merger\n\n| ID |');
  });

  it('changes nothing on a second run, and --check passes then', () => {
    run('--write');
    const before = [
      'docs/PLAN.md',
      'docs/plan/v1-a.md',
      'docs/plan/v2-b.md',
      'docs/decisions.md',
    ].map(read);
    expect(run('--write').out).toContain('Nothing to change');
    expect(
      ['docs/PLAN.md', 'docs/plan/v1-a.md', 'docs/plan/v2-b.md', 'docs/decisions.md'].map(read),
    ).toEqual(before);
    expect(run('--check').code).toBe(0);
  });

  it('takes a status back when the newer row no longer says it replaces the older', () => {
    run('--write');
    repo.write({ 'docs/plan/v2-b.md': read('docs/plan/v2-b.md').replace(' (supersedes 1)', '') });
    const { code, out } = run('--check');
    expect(code).toBe(1);
    expect(out).toContain('docs/plan/v1-a.md');
    run('--write');
    expect(row('docs/plan/v1-a.md', 1)).toBe(
      '| 1 | What Approve does *(partly superseded by 11 of V3)* | **Pushes** | asked |',
    );
  });

  it('names an area page whose code changed after the page did, and the files', () => {
    run('--write');
    repo.commit('Consolidated');
    expect(run().out).not.toContain('area/reviews.md:');
    // Docs it names, files it does not name and files that do not exist are not watched.
    repo.write({
      'src/reviews.ts': 'export const a = 1;\n',
      'docs/JOURNAL.md': 'more\n',
      'src/x.ts': '',
    });
    repo.commit('Code');
    repo.write({ 'src/base.ts': 'export const b = 1;\n' });
    repo.commit('More code');
    const { code, out } = run('--check');
    // A note for a person, not a failure.
    expect(code).toBe(0);
    expect(out).toContain(
      'note  area/reviews.md: 2 commits since the page last changed touch src/base.ts, src/reviews.ts: reread it against them',
    );
    // Changed with or after its code, the page is current again.
    repo.write({ 'docs/area/reviews.md': `${PAGE}Updated.\n` });
    repo.commit('Page');
    expect(run().out).not.toContain('area/reviews.md:');
  });

  it("leaves out a file most commits touch: it is every area's", () => {
    run('--write');
    repo.write({ 'docs/area/reviews.md': `${PAGE}The routes: \`src/server.ts\`.\n` });
    repo.commit('Page');
    // 44 commits, 6 of them in src/server.ts: more than 1 in 20.
    for (let i = 0; i < 44; i++) {
      repo.write({ 'src/x.ts': `${i}\n`, ...(i % 8 === 0 ? { 'src/server.ts': `${i}\n` } : {}) });
      repo.commit(`Work ${i}`);
    }
    expect(run().out).not.toContain('area/reviews.md:');
    repo.write({ 'src/server.ts': 'last\n', 'src/reviews.ts': 'export const c = 1;\n' });
    repo.commit('Reviews and a route');
    expect(run().out).toContain(
      'note  area/reviews.md: 1 commit since the page last changed touches src/reviews.ts: reread it against them',
    );
  });

  it("takes a plan's banner back when its area's page goes", () => {
    run('--write');
    repo.git('rm', '--quiet', 'docs/area/reviews.md');
    run('--write');
    expect(read('docs/plan/v1-a.md')).not.toContain('What holds now');
    expect(read('docs/PLAN.md')).toContain('### Reviews\n\n| ID |');
  });
});
