import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import {
  gateDecision,
  gitReadProblem,
  hookOutput,
  openWorktrees,
  scoutReach,
  type ScoutReach,
} from '../src/scout-gate.js';

describe('gitReadProblem (V35, decision 236)', () => {
  it.each([
    'git log --oneline -3',
    'git --no-pager log -n 20 --stat',
    "git log -S'MERGER_ANSWER' --oneline",
    'git log -S"merger answer" --oneline -- packages/cli/src',
    "git log --format='%h %ad %s' --date=short -5",
    'git log --follow --oneline -- README.md',
    'git log main..HEAD~3 --grep=V26',
    'git show --stat HEAD',
    'git show HEAD~1:README.md',
    'git show 84bc324 -- docs/PLAN.md',
    'git blame -L 1,40 packages/cli/src/prompts.ts',
    'git blame -L /MERGER/,+10 packages/cli/src/prompts.ts',
    'git diff HEAD~3 --stat',
    'git diff main...feature/x -- src/a.ts',
    'git shortlog -sn -5 HEAD',
    "git grep -n 'newestSession' HEAD~10 -- packages/cli/src",
    'git rev-parse HEAD',
    'git merge-base main HEAD',
    'git ls-files packages/cli/src',
    'git ls-tree -r --name-only HEAD packages/viewer',
    'git log --oneline | head -20',
    'git log --oneline 2>&1 | grep -i merger | wc -l',
    'git log --oneline 2>/dev/null',
    'git show HEAD | tail -n 40',
    // A capital O in a pickaxe string or a pattern is no option.
    "git log -S'Options' --oneline",
    'git grep -n -e Options HEAD',
    // Filters over git's output, with their options (fix/security-and-bugs).
    'git log --oneline | head -n 20',
    'git log | tail -n +5',
    'git log | head -c 100',
    'git log | grep -i -n merger',
    'git log | grep -e foo -e bar',
    'git log | grep -A 3 --max-count 2 foo',
    'git log | grep -- -x',
    'git log | wc -lw',
    'git blame --ignore-rev 84bc324 README.md',
  ])('accepts %s', (command) => {
    expect(gitReadProblem(command)).toBeNull();
  });

  it.each([
    // Options that write a file or run a program.
    ['git log -1 --output=/tmp/x', '--output'],
    ['git diff HEAD~1 --output /tmp/x', '--output'],
    ["git grep -O'touch /tmp/x' foo", '-O'],
    ['git grep --open-files-in-pager=vi foo', '--open-files-in-pager'],
    ['git diff --ext-diff HEAD~1', '--ext-diff'],
    // git takes a long option's unique beginning, and short options bundled (git 2.43: each of
    // these ran `true` as the pager).
    ['git grep --open=true hello', '--open'],
    ['git grep -nOtrue hello', '-nOtrue'],
    ['git log -1 --outp=/tmp/x', '--outp'],
    ['git diff --no-ind a b', '--no-ind'],
    ['git diff --no-index /etc/passwd README.md', '--no-index'],
    // Options that read a file outside the repository and print it, or its first line in an
    // error (fix/security-and-bugs: --no-index was refused, these went through).
    ['git blame --contents=/etc/hostname -- README.md', '--contents'],
    ['git blame --contents /etc/hostname README.md', '--contents'],
    ['git blame --cont=/etc/hostname README.md', '--cont'],
    ['git blame --ignore-revs-file /etc/hostname README.md', '--ignore-revs-file'],
    ['git blame -S /etc/hostname README.md', '-S'],
    ['git blame -wS /etc/hostname README.md', '-wS'],
    ['git grep -f /etc/hostname', '-f'],
    ['git grep -nf/etc/hostname', '-nf/etc/hostname'],
    ['git grep --file=/etc/hostname', '--file'],
    // A filter reads git's output, never a file of its own.
    ['git log -1 | tail -n 3 ~/.bashrc', '~/.bashrc'],
    ['git log | head /etc/hostname', '/etc/hostname'],
    ['git log | grep -r PRIVATE /home', '-r'],
    ['git log | grep -nR PRIVATE', '-nR'],
    ['git log | grep --recursive PRIVATE', '--recursive'],
    ['git log | grep -f /etc/hostname', '-f'],
    ['git log | grep --file=/etc/hostname', '--file'],
    ['git log | grep root /etc/passwd', '/etc/passwd'],
    ['git log | grep -e root /etc/passwd', '/etc/passwd'],
    ['git log | wc -l /etc/passwd', '/etc/passwd'],
    ['git log | wc --files0-from=/etc/x', '--files0-from'],
    // git's own options before the command.
    ['git -c core.pager=touch log', 'git -c'],
    ['git -C /tmp log', 'git -C'],
    ['git --git-dir=/tmp/x log', 'git --git-dir=/tmp/x'],
    ['git -p log', 'git -p'],
    // Commands that change something, or that are not git's read commands.
    ['git checkout -b scout', 'git checkout'],
    ['git commit -m x', 'git commit'],
    ['git push', 'git push'],
    ['git stash', 'git stash'],
    ['git status', 'git status'],
    ['git', 'which git command'],
    ['ls', 'ls'],
    ['cat README.md', 'cat'],
    ['touch x', 'touch'],
    ['GIT_PAGER=touch git log', 'GIT_PAGER=touch'],
    ['/usr/bin/git log', '/usr/bin/git'],
    // Shell operators, substitutions, redirections and expansions.
    ['git log -1 && touch x', '&'],
    ['git log -1; touch x', ';'],
    ['git log -1 || touch x', '||'],
    ['git log -1 & touch x', '&'],
    ['git log $(touch x)', '$'],
    ['git log "$(touch x)"', '$'],
    ['git log `touch x`', '`'],
    ['git log "`touch x`"', '`'],
    ['git log > out.txt', '>'],
    ['git log 2> err.txt', '>'],
    ['git log >> out.txt', '>'],
    ['git log < in.txt', '<'],
    ['git log {--output=x,-1}', '{'],
    ['git log *', '*'],
    ['git log -- src/?.ts', '?'],
    ['git log -- [ab].ts', '['],
    ['git log \\--output=x', '\\'],
    ['git log "a\\"b"', '\\'],
    ['git log -1\ntouch x', 'line'],
    ["git log 'unclosed", 'quote'],
    ['git log | sort -o x', 'sort'],
    ['git log | sh', 'sh'],
    ['git log | xargs rm', 'xargs'],
    ['git log |', 'nothing after'],
    ['git log | head | git checkout -b x', 'git'],
    ['git log ! touch', '!'],
    ['git log #; touch x', '#'],
    ['(git log)', '('],
  ])('refuses %s', (command, named) => {
    expect(gitReadProblem(command)).toContain(named);
  });
});

describe('gateDecision (V35)', () => {
  const input = (tool_name: string, tool_input: unknown) => ({
    hook_event_name: 'PreToolUse',
    session_id: 's',
    cwd: '/repo',
    tool_name,
    tool_input,
  });

  it("leaves Read, Grep and Glob to Claude Code's own rules", () => {
    expect(gateDecision(input('Read', { file_path: '/repo/README.md' }))).toBeNull();
    expect(gateDecision(input('Grep', { pattern: 'merger' }))).toBeNull();
    expect(gateDecision(input('Glob', { pattern: '**/*.ts' }))).toBeNull();
  });

  it('allows git read commands in Bash, and denies any other command with the rule', () => {
    expect(gateDecision(input('Bash', { command: "git log -S'x' --oneline" }))).toEqual({
      allow: true,
    });
    const denied = gateDecision(input('Bash', { command: 'ls -la' }));
    expect(denied).toMatchObject({ allow: false });
    expect(denied && !denied.allow && denied.reason).toMatch(
      /^Scout runs only git's read commands/,
    );
    expect(gateDecision(input('Bash', {}))).toMatchObject({ allow: false });
  });

  it('denies every other tool: Scout changes no file', () => {
    for (const tool of ['Edit', 'Write', 'NotebookEdit', 'WebFetch', 'Agent']) {
      const decision = gateDecision(input(tool, {}));
      expect(decision).toMatchObject({ allow: false });
      expect(decision && !decision.allow && decision.reason).toMatch(/Scout changes no file/);
    }
  });

  it("lets Symbiote's own tools through; every other server's is denied (MC1)", () => {
    expect(gateDecision(input('mcp__symbiote__overview', {}))).toEqual({ allow: true });
    expect(gateDecision(input('mcp__symbiote__queue_merge', { branch: 'fix/a' }))).toEqual({
      allow: true,
    });
    for (const tool of ['mcp__x__y', 'mcp__github__create_pull_request', 'mcp__symbiote']) {
      const decision = gateDecision(input(tool, {}));
      expect(decision).toMatchObject({ allow: false });
      expect(decision && !decision.allow && decision.reason).toMatch(
        /Scout acts only through Symbiote's tools/,
      );
    }
  });

  it('says nothing of what is not a tool call', () => {
    expect(gateDecision(null)).toBeNull();
    expect(gateDecision({ hook_event_name: 'Stop' })).toBeNull();
  });

  it("answers in Claude Code's PreToolUse format", () => {
    expect(hookOutput(null)).toBe('');
    expect(JSON.parse(hookOutput({ allow: true }))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: "Scout: one of git's read commands",
      },
    });
    expect(JSON.parse(hookOutput({ allow: false, reason: 'No.' }))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'No.',
      },
    });
  });
});

describe("Scout reads the workspaces' worktrees (V80, decisions 585-587)", () => {
  // A checkout, its worktrees beside it as Symbiote makes them, and their records:
  // - feature-a: an open workspace, with uncommitted work and links out of it;
  // - "with space": an open workspace whose folder has a space;
  // - feature-done: a finished workspace whose worktree is still there;
  // - feature-hand: a worktree no record names;
  // - ghost: a record whose folder git does not list as a worktree.
  let repo: TestRepo;
  let outside: string;
  let holder: string;
  let records: string;
  let wt: string;
  let spaced: string;
  let done: string;
  let hand: string;
  let ghost: string;
  let reach: ScoutReach;

  const record = (branch: string, worktree: string, more: Record<string, unknown> = {}) => {
    const file = join(records, `${branch}.json`);
    mkdirSync(dirname(file), { recursive: true });
    const workspace = {
      agent: null,
      base: 'abc',
      branch,
      brief: 'b',
      created: '2026-10-29T00:00:00Z',
    };
    writeFileSync(file, JSON.stringify({ ...workspace, planFirst: false, worktree, ...more }));
  };

  beforeAll(() => {
    repo = createRepo();
    repo.write({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n' });
    repo.commit('A');
    outside = tempDir();
    writeFileSync(join(outside, 'secret.txt'), 'SECRET\n');
    holder = `${repo.root}.worktrees`;
    wt = join(holder, 'feature-a');
    spaced = join(holder, 'with space');
    done = join(holder, 'feature-done');
    hand = join(holder, 'feature-hand');
    ghost = join(holder, 'ghost');
    for (const [folder, branch] of [
      [wt, 'feature/a'],
      [spaced, 'feature/spaced'],
      [done, 'feature/done'],
      [hand, 'feature/hand'],
    ] as const) {
      repo.git('worktree', 'add', '--quiet', folder, '-b', branch);
    }
    mkdirSync(ghost);
    writeFileSync(join(wt, 'src/a.ts'), 'export const a = 3;\n');
    writeFileSync(join(wt, 'notes.md'), 'not committed\n');
    symlinkSync(outside, join(wt, 'out'));
    symlinkSync(join(outside, 'secret.txt'), join(wt, 'out-file.txt'));
    records = join(repo.root, 'symbiote', 'workspaces');
    record('feature/a', wt);
    record('feature/spaced', spaced);
    record('feature/done', done, { finished: '2026-10-29T01:00:00Z' });
    record('feature/ghost', ghost);
    record('feature/root', '/');
    reach = { checkout: repo.root, worktrees: () => openWorktrees(repo.root, records) };
  });
  afterAll(() => {
    repo.cleanup();
    rmSync(holder, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("opens an open workspace's worktree that git lists, nothing else", () => {
    expect([...openWorktrees(repo.root, records)].sort()).toEqual([wt, spaced].sort());
    // No records folder, or a repository git cannot read: none.
    expect(openWorktrees(repo.root, join(repo.root, 'nothing'))).toEqual([]);
    expect(openWorktrees(outside, records)).toEqual([]);
  });

  const read = (tool: string, tool_input: unknown) => ({
    hook_event_name: 'PreToolUse',
    cwd: repo.root,
    tool_name: tool,
    tool_input,
  });

  it("allows Read, Grep and Glob in an open workspace's worktree, by real path", () => {
    const allowed = { allow: true, reason: "a workspace's worktree" };
    for (const input of [
      read('Read', { file_path: join(wt, 'src/a.ts') }),
      read('Read', { file_path: join(wt, 'notes.md') }),
      // Claude Code says a missing file is missing.
      read('Read', { file_path: join(wt, 'not-yet.md') }),
      read('Read', { file_path: join(spaced, 'src/b.ts') }),
      read('Grep', { pattern: 'export', path: wt }),
      read('Grep', { pattern: 'export', path: join(wt, 'src'), glob: '*.ts' }),
      read('Glob', { pattern: '**/*.ts', path: wt }),
    ]) {
      expect(gateDecision(input, reach)).toEqual(allowed);
    }
    expect(JSON.parse(hookOutput(allowed))).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'allow',
        permissionDecisionReason: "Scout: a workspace's worktree",
      },
    });
  });

  it("leaves every other path to Claude Code's own rules", () => {
    for (const input of [
      // The checkout: Claude Code reads it, as before.
      read('Read', { file_path: join(repo.root, 'src/a.ts') }),
      read('Grep', { pattern: 'x', path: repo.root }),
      // Around the checkout, the folder holding the worktrees, other worktrees.
      read('Read', { file_path: join(dirname(repo.root), 'x.txt') }),
      read('Glob', { pattern: '**', path: holder }),
      read('Read', { file_path: join(done, 'src/a.ts') }),
      read('Read', { file_path: join(hand, 'src/a.ts') }),
      read('Read', { file_path: join(ghost, 'x') }),
      read('Read', { file_path: '/etc/hostname' }),
      read('Grep', { pattern: 'root', path: '/etc' }),
      // Links out of a worktree, and "..".
      read('Read', { file_path: join(wt, 'out-file.txt') }),
      read('Read', { file_path: join(wt, 'out', 'secret.txt') }),
      read('Grep', { pattern: 'SECRET', path: join(wt, 'out') }),
      read('Read', { file_path: `${wt}/../feature-hand/src/a.ts` }),
      read('Read', { file_path: `${wt}/src/../../feature-hand/src/a.ts` }),
      // Relative, or no path: Claude Code's folder.
      read('Grep', { pattern: 'x', path: 'feature-a' }),
      read('Grep', { pattern: 'x' }),
      read('Glob', { pattern: '**/*.ts' }),
      read('Read', {}),
    ]) {
      expect(gateDecision(input, reach)).toBeNull();
    }
    // Without the folders (a settings file from before V80): main's gate.
    expect(gateDecision(read('Read', { file_path: join(wt, 'src/a.ts') }))).toBeNull();
  });

  /** A command with its folders named: `<wt>`, `<holder>`, `<done>`, `<hand>`, `<ghost>`… */
  const fill = (command: string) =>
    command
      .replaceAll('<wt>', wt)
      .replaceAll('<spaced>', spaced)
      .replaceAll('<holder>', holder)
      .replaceAll('<done>', done)
      .replaceAll('<hand>', hand)
      .replaceAll('<ghost>', ghost)
      .replaceAll('<checkout>', repo.root)
      .replaceAll('<around>', dirname(repo.root));

  it.each([
    'git --no-optional-locks -C <wt> status --short',
    'git -C <wt> --no-optional-locks status --porcelain',
    'git -C <wt> diff-index -p HEAD',
    'git -C <wt> diff-index --stat HEAD -- src',
    'git -C <wt> ls-files --others --exclude-standard',
    'git --no-pager -C <wt> log --oneline -3',
    'git -C <wt> show HEAD:src/a.ts | head -5',
    'git -C <wt>/src grep -n export',
    'git -C <wt> blame src/a.ts',
    "git -C '<spaced>' log --oneline",
    'git -C "<spaced>/src" diff-index -p HEAD',
    // Scout's two new commands in the checkout too.
    'git --no-optional-locks status --short',
    'git diff-index -p HEAD',
  ])('accepts %s', (command) => {
    expect(gitReadProblem(fill(command), reach.worktrees)).toBeNull();
  });

  it.each([
    // -C anywhere but an open workspace's worktree.
    ['git -C <around> log', 'not a workspace'],
    ['git -C /home log', 'not a workspace'],
    ['git -C <holder> log', 'not a workspace'],
    ['git -C <checkout> log', 'not a workspace'],
    ['git -C <done> log', 'not a workspace'],
    ['git -C <hand> log', 'not a workspace'],
    ['git -C <ghost> log', 'not a workspace'],
    ['git -C / log', 'not a workspace'],
    ['git -C <wt>/out log', 'not a workspace'],
    ['git -C <wt>/../feature-hand log', '..'],
    ['git -C feature-a log', 'absolute'],
    ['git -C ~/projects log', 'absolute'],
    ['git -C <wt> -C src log', 'one -C'],
    ['git -C', 'a folder'],
    ['git -C <wt>', 'which git command'],
    // In a worktree, git diff rewrites its index; status only with --no-optional-locks.
    ['git -C <wt> diff', 'diff-index'],
    ['git -C <wt> diff HEAD --stat', 'diff-index'],
    ['git -C <wt> status', '--no-optional-locks'],
    ['git status --short', '--no-optional-locks'],
    // Every refusal of fix/security-and-bugs, with -C in front.
    ['git -C <wt> log -1 --output=/tmp/x', '--output'],
    ['git -C <wt> diff-index --output=/tmp/x HEAD', '--output'],
    ['git -C <wt> diff-index --ext-diff -p HEAD', '--ext-diff'],
    ['git -C <wt> grep --no-index x /etc', '--no-index'],
    ["git -C <wt> grep -O'touch /tmp/x' foo", '-O'],
    ['git -C <wt> blame --contents=/etc/hostname README.md', '--contents'],
    ['git -C <wt> grep -f /etc/hostname', '-f'],
    ['git -C <wt> log -1 | tail -n 3 ~/.bashrc', '~/.bashrc'],
    ['git -C <wt> -c core.pager=touch log', 'git -c'],
    ['git -C <wt> --git-dir=/tmp/x log', 'git --git-dir=/tmp/x'],
    ['git --no-optional-locks -C <wt> checkout -b x', 'git checkout'],
    ['git -C <wt> stash', 'git stash'],
    ['git -C <wt> log; touch x', ';'],
    ['git -C $(echo <wt>) log', '$'],
  ])('refuses %s', (command, named) => {
    expect(gitReadProblem(fill(command), reach.worktrees)).toContain(named);
  });

  it("keeps Scribe's rule: no -C, status or diff-index without the worktrees", () => {
    expect(gitReadProblem(`git -C ${wt} log`)).toContain('git -C');
    expect(gitReadProblem('git --no-optional-locks status')).toContain('--no-optional-locks');
    expect(gitReadProblem('git diff-index -p HEAD')).toContain('git diff-index');
    expect(gitReadProblem('git status')).toContain('git status');
  });

  it('says where Scout runs git when it refuses a command', () => {
    const bash = (command: string) => read('Bash', { command });
    expect(gateDecision(bash(`git -C ${wt} diff-index -p HEAD`), reach)).toEqual({ allow: true });
    const denied = gateDecision(bash(`git -C ${hand} log`), reach);
    expect(denied).toMatchObject({ allow: false });
    expect(denied && !denied.allow && denied.reason).toMatch(/-C <a workspace's worktree>/);
    // Main's words without the folders.
    const before = gateDecision(bash(`git -C ${wt} log`));
    expect(before && !before.allow && before.reason).not.toMatch(/worktree/);
  });

  it('writes nothing in the worktree: its index stays as it was, but git diff rewrites it', () => {
    const index = execFileSync(
      'git',
      ['-C', wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index'],
      { encoding: 'utf8' },
    ).trim();
    let tick = Date.now() / 1000 + 60;
    // A file's time changed and its text did not: git refreshes the index when it may.
    const stale = () => {
      tick += 5;
      utimesSync(join(wt, 'src/b.ts'), tick, tick);
    };
    const state = () => `${statSync(index).mtimeMs} ${readFileSync(index).toString('base64')}`;
    const forms = [
      ['--no-optional-locks', '-C', wt, 'status', '--short'],
      ['-C', wt, 'diff-index', '-p', 'HEAD'],
      ['-C', wt, 'diff-index', '--stat', 'HEAD'],
      ['-C', wt, 'ls-files', '--others', '--exclude-standard'],
      ['-C', wt, 'log', '--oneline', '-1'],
      ['-C', wt, 'show', 'HEAD:src/a.ts'],
      ['-C', wt, 'grep', '-n', 'export'],
      ['-C', wt, 'blame', 'src/b.ts'],
    ];
    for (const args of forms) {
      expect(gitReadProblem(`git ${args.join(' ')}`, reach.worktrees)).toBeNull();
      stale();
      const before = state();
      execFileSync('git', args, { stdio: 'ignore' });
      expect(state(), args.join(' ')).toBe(before);
    }
    stale();
    const before = state();
    execFileSync('git', ['-C', wt, 'diff'], { stdio: 'ignore' });
    expect(state()).not.toBe(before);
  });
});

describe("scoutReach (V80): the hook's arguments", () => {
  it("takes the checkout and the records folder; without both, none (main's gate)", () => {
    const reach = scoutReach(['/repo', '/repo/symbiote/workspaces']);
    expect(reach?.checkout).toBe('/repo');
    expect(reach?.worktrees()).toEqual([]);
    expect(scoutReach([])).toBeUndefined();
    expect(scoutReach(['/repo'])).toBeUndefined();
    expect(scoutReach(['', ''])).toBeUndefined();
  });
});
