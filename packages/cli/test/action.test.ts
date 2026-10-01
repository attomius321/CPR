import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createRepo, tempDir } from '../../core/test/helpers/git-repo.js';

const script = fileURLToPath(new URL('../../../action/run.sh', import.meta.url));

/** action/run.sh, with a stub in place of cpr that prints its arguments. */
describe('action/run.sh', () => {
  const repo = createRepo();
  repo.write({ 'a.ts': 'export const a = 1;\n' });
  repo.commit('one');
  const dir = tempDir();
  const stub = join(dir, 'stub.mjs');
  writeFileSync(
    stub,
    "console.log('summary for ' + JSON.stringify(process.argv.slice(2)));\n" +
      'process.exit(Number(process.env.STUB_EXIT ?? 0));\n',
  );
  afterAll(() => {
    repo.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  function run(env: Record<string, string>) {
    const summary = join(dir, 'step-summary.md');
    const output = join(dir, 'output.txt');
    writeFileSync(summary, '');
    writeFileSync(output, '');
    const result = spawnSync('bash', [script], {
      cwd: repo.root,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        RUNNER_TEMP: dir,
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_OUTPUT: output,
        CPR_CLI: `${process.execPath} ${stub}`,
        ...env,
      },
    });
    const args = JSON.parse(/summary for (.*)/.exec(result.stdout)?.[1] ?? 'null') as string[];
    return {
      status: result.status,
      args,
      summary: readFileSync(summary, 'utf8'),
      output: readFileSync(output, 'utf8'),
    };
  }

  it('runs cpr pr with the inputs that are set', () => {
    const { status, args, summary, output } = run({
      CPR_POST_FINDINGS: 'warning',
      CPR_FAIL_ON: 'error',
      CPR_DEPTH: '2',
      CPR_PROJECT: '',
    });
    expect(status).toBe(0);
    expect(args).toEqual([
      'pr',
      '--summary',
      '--out',
      join(dir, 'cpr', 'graph.json'),
      '--post-findings',
      'warning',
      '--fail-on',
      'error',
      '--depth',
      '2',
    ]);
    expect(summary).toContain('### CPR\n\n```\nsummary for ["pr"');
    expect(output).toBe(`graph=${join(dir, 'cpr', 'graph.json')}\n`);
  });

  it('writes where GitLab wants its Code Quality report', () => {
    const report = join(dir, 'gl-code-quality-report.json');
    const { args } = run({ CPR_OUT: join(dir, 'out'), CPR_CODEQUALITY: report });
    expect(args).toEqual([
      'pr',
      '--summary',
      '--out',
      join(dir, 'out', 'graph.json'),
      '--codequality',
      report,
    ]);
  });

  it('passes a number and keeps the exit status of cpr', () => {
    const { status, args } = run({ CPR_PULL_REQUEST: '7', STUB_EXIT: '1' });
    expect(status).toBe(1);
    expect(args.slice(0, 2)).toEqual(['pr', '7']);
  });
});
