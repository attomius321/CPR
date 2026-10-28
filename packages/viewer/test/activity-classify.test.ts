// What each call is (V73): classified by its tool and its command's program, never by a guess at
// intent; a test run's counts read only from what it printed.
import { describe, expect, it } from 'vitest';
import {
  callKind,
  commandKind,
  gitVerbs,
  isCommitCommand,
  shortPath,
  shownCommand,
  testCommand,
} from '../src/workspaces/activity/classify.js';
import { countsText, testCounts } from '../src/workspaces/activity/test-summary.js';

const W = '/home/ada/projects/app.worktrees/feature-x';

describe('commandKind (V73)', () => {
  it('names tests, checks and builds as testing, whatever runs them', () => {
    for (const command of [
      'pnpm check',
      `cd ${W} && pnpm check 2>&1 | tail -20`,
      'npx vitest run packages/viewer/test/a.test.ts -t "x"',
      'env -u WAYLAND_DISPLAY npx playwright test e2e/a.spec.ts --reporter=line',
      'pnpm test:e2e',
      'pnpm typecheck 2>&1 | tail -15; npx vitest run packages/viewer',
      'pnpm build 2>&1 | grep -iE "error|built in"',
      'npx prettier --check packages/viewer/src',
      'npx tsc -b packages/core',
      'npx eslint packages/cli/src',
      'cargo test --all',
      'python -m pytest -q',
      'go test ./...',
      'npm test',
      '(pnpm check 2>&1 | tail -5) && echo done',
      'timeout 600 pnpm test:e2e',
    ]) {
      expect([command, commandKind(command)]).toEqual([command, 'test']);
    }
  });

  it('names writing git commands as git; reading ones and a fetch as exploring', () => {
    expect(commandKind("git add -A docs && git commit -q -F - <<'EOF'\nPlan V1\nEOF")).toBe('git');
    expect(commandKind('git push -q -u origin feature/x')).toBe('git');
    expect(commandKind('git merge --no-edit -q origin/main')).toBe('git');
    expect(commandKind('git stash push -u -m tag')).toBe('git');
    expect(commandKind('git log --oneline -5; git status --short')).toBe('explore');
    expect(commandKind('git diff main -- src/a.ts')).toBe('explore');
    expect(commandKind('git fetch -q origin; git log HEAD..origin/main')).toBe('explore');
    // A commit after its check is the commit.
    expect(commandKind('pnpm check && git commit -am "x"')).toBe('git');
  });

  it('names screenshots as visual inspection: by the command or by the agent’s words', () => {
    expect(commandKind('node .claude/skills/symbiote-style/shots.mjs http://127.0.0.1:4000')).toBe(
      'visual',
    );
    expect(commandKind('npx playwright screenshot http://localhost:3000 out.png')).toBe('visual');
    expect(commandKind('node /tmp/take.mjs', 'Screenshot the activity tab')).toBe('visual');
  });

  it('names edits in the worktree as implementing; scratch files elsewhere as nothing', () => {
    expect(commandKind("sed -i 's/a/b/' packages/viewer/src/a.ts")).toBe('implement');
    expect(commandKind('cat > src/new.ts <<EOF\nx\nEOF')).toBe('implement');
    expect(commandKind('mv src/a.ts src/b.ts')).toBe('implement');
    expect(commandKind('cat > /tmp/probe.py <<EOF\nx\nEOF')).toBeNull();
    expect(commandKind('S=/home/ada/.claude/jobs/1/tmp; cat > $S/shot.mjs <<EOF\nx\nEOF')).toBe(
      'visual',
    );
  });

  it('names reading commands as exploring; waits and installs as nothing of their own', () => {
    for (const command of [
      'grep -rn "activity" packages --include=*.ts | head',
      'sed -n 1,80p packages/viewer/src/a.ts',
      'cat packages/a.ts; ls packages/',
      "python3 - <<'EOF'\nprint(1)\nEOF",
      'wc -l src/*.ts',
      'find . -name "*.md"',
    ]) {
      expect([command, commandKind(command)]).toEqual([command, 'explore']);
    }
    expect(commandKind('sleep 5')).toBeNull();
    expect(commandKind('pnpm install --frozen-lockfile --offline')).toBeNull();
    expect(commandKind('npx prettier --write packages/a.ts')).toBeNull();
    expect(commandKind('')).toBeNull();
  });

  it('the test a command runs, as a summary says it', () => {
    expect(testCommand(`cd ${W} && pnpm check 2>&1 | tail -20`)).toBe('pnpm check');
    expect(
      testCommand('env -u WAYLAND_DISPLAY npx playwright test --reporter=line > /tmp/e2e.log 2>&1'),
    ).toBe('npx playwright test --reporter=line');
    expect(testCommand('npx vitest run a.test.ts -t "grouping"')).toBe('npx vitest run a.test.ts');
    expect(testCommand('grep -n x a.ts')).toBeNull();
  });

  it("commits are found in a command's segments", () => {
    expect(isCommitCommand('git add -A && git commit -q -F - <<EOF\nx\nEOF')).toBe(true);
    expect(isCommitCommand('git -C /w commit -m x')).toBe(true);
    expect(isCommitCommand('git merge --no-ff x -m "Merge"')).toBe(true);
    expect(isCommitCommand('git log --grep commit')).toBe(false);
    expect(isCommitCommand('echo "git commit later"')).toBe(false);
    expect(gitVerbs('git add -A && git commit -m x && git push -q')).toEqual([
      'add',
      'commit',
      'push',
    ]);
  });
});

describe('callKind (V73)', () => {
  const kind = (tool: string, subject?: string, input?: string, about?: string) =>
    callKind({
      tool,
      ...(subject ? { subject } : {}),
      ...(input ? { input } : {}),
      ...(about ? { about } : {}),
    });
  it("by the tool, a command by its whole text, an edit by its file's place", () => {
    expect(kind('Read', 'src/a.ts')).toBe('explore');
    expect(kind('Read', '/home/ada/.claude/jobs/1/tmp/shot.png')).toBe('visual');
    expect(kind('Grep', 'parseToken')).toBe('explore');
    expect(kind('Glob', 'src/**')).toBe('explore');
    expect(kind('WebFetch', 'https://docs.rs')).toBe('explore');
    expect(kind('Agent', 'Find callers')).toBe('explore');
    expect(kind('Edit', 'src/a.ts')).toBe('implement');
    expect(kind('Write', 'docs/plan/v1.md')).toBe('docs');
    expect(kind('Edit', 'README.md')).toBe('docs');
    expect(kind('Edit', '/home/ada/.claude/jobs/1/tmp/a.mjs')).toBeNull();
    expect(kind('fileChange', 'src/lib.rs, README.md')).toBe('implement');
    expect(kind('fileChange', 'docs/a.md, README.md')).toBe('docs');
    // The subject cut at 160 characters; the whole command says it is a commit.
    expect(
      kind('Bash', `cd ${W}; grep -n x a.ts`, `cd ${W}; grep -n x a.ts && git commit -m x`),
    ).toBe('git');
    expect(kind('command', 'cargo test')).toBe('test');
    expect(kind('Bash', 'node /tmp/x.mjs', undefined, 'Take screenshots of the tab')).toBe(
      'visual',
    );
    for (const tool of ['TaskCreate', 'TaskUpdate', 'ToolSearch', 'Skill', 'mcp__x__y', 'Nope']) {
      expect([tool, kind(tool)]).toEqual([tool, null]);
    }
  });
});

describe('shownCommand and shortPath (V73)', () => {
  it("drops a leading cd to an absolute folder and writes the worktree's and home's paths short", () => {
    expect(shownCommand(`cd ${W} && pnpm check 2>&1 | tail -20`, W)).toBe(
      'pnpm check 2>&1 | tail -20',
    );
    expect(shownCommand(`cd ${W}; cd /tmp && ls`, W)).toBe('ls');
    expect(shownCommand(`cat ${W}/src/a.ts ${W}`, W)).toBe('cat src/a.ts .');
    expect(shownCommand('S=/home/ada/.claude/jobs/1/tmp; ls $S', W)).toBe(
      'S=~/.claude/jobs/1/tmp; ls $S',
    );
    // A folder in the worktree stays: it says where the command runs.
    expect(shownCommand('cd packages/viewer && npx playwright test', W)).toBe(
      'cd packages/viewer && npx playwright test',
    );
  });

  it('a path inside the worktree from it, one in the home from ~', () => {
    expect(shortPath('src/a.ts', W)).toBe('src/a.ts');
    expect(shortPath(`${W}/src/a.ts`, W)).toBe('src/a.ts');
    expect(shortPath('/home/ada/.claude/jobs/1/a.png', W)).toBe('~/.claude/jobs/1/a.png');
    expect(shortPath('/etc/hosts', W)).toBe('/etc/hosts');
  });
});

describe('testCounts (V73): what a test run printed, read from its end', () => {
  it("Vitest's summary", () => {
    const output = [
      ' Test Files  146 passed (146)',
      '      Tests  2020 passed (2020)',
      '   Start at  10:25:36',
      '   Duration  41.20s (transform 62%, import 36%, tests 2%)',
    ].join('\n');
    expect(testCounts(output)).toEqual({ passed: 2020 });
    expect(
      testCounts(
        ' FAIL  packages/cli/test/a.test.ts > x\n      Tests  8 failed | 1 passed | 113 skipped (122)',
      ),
    ).toEqual({ failed: 8, passed: 1, skipped: 113 });
  });

  it("Playwright's, failed and passed on lines of their own", () => {
    const output = [
      '[2/2] e2e/hermes.spec.ts:107:1 › Hermes is not offered where no terminal can run',
      '  1 failed',
      '    e2e/hermes.spec.ts:29:1 › Hermes in its terminal: started',
      '  1 flaky',
      '  2 skipped',
      '  1 passed (6.8s)',
    ].join('\n');
    expect(testCounts(output)).toEqual({ failed: 1, flaky: 1, skipped: 2, passed: 1 });
  });

  it("Jest's, pytest's, cargo's and node's", () => {
    expect(testCounts('Tests:       1 failed, 2 skipped, 40 passed, 43 total')).toEqual({
      failed: 1,
      skipped: 2,
      passed: 40,
    });
    expect(testCounts('==== 3 failed, 120 passed, 2 skipped in 4.20s ====')).toEqual({
      failed: 3,
      passed: 120,
      skipped: 2,
    });
    expect(
      testCounts('test result: FAILED. 3 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out'),
    ).toEqual({ passed: 3, failed: 1, skipped: 0 });
    expect(testCounts('# tests 12\n# pass 11\n# fail 1')).toEqual({ passed: 11, failed: 1 });
  });

  it("ESLint's and TypeScript's problems", () => {
    expect(testCounts('✖ 3 problems (1 error, 2 warnings)')).toEqual({ errors: 1, warnings: 2 });
    expect(testCounts('Found 2 errors in 1 file.')).toEqual({ errors: 2 });
  });

  it('the last summary when a check runs several; nothing when none was printed', () => {
    const output = '✖ 1 problem (1 error, 0 warnings)\n\n  18 passed (35.6s)';
    expect(testCounts(output)).toEqual({ passed: 18 });
    expect(testCounts('all good')).toBeNull();
    expect(testCounts('')).toBeNull();
  });

  it('says the counts briefly, failures first', () => {
    expect(countsText({ passed: 2020 })).toBe('2,020 passed');
    expect(countsText({ failed: 2, passed: 18, skipped: 1, flaky: 1 })).toBe(
      '2 failed · 18 passed · 1 flaky · 1 skipped',
    );
    expect(countsText({ errors: 1, warnings: 0 })).toBe('1 error');
  });
});
