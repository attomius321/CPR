import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { gateDecision, openWorktrees, type NucleusReach } from '../src/nucleus-gate.js';
import { shellCheck, type ShellContext } from '../src/nucleus-shell.js';
import { gateHook } from '../src/nucleus-record.js';

// NU9 (decisions 917-922): the shell's read commands Nucleus and Alpha Ceph run, on the checkout
// and the open workspaces' worktrees only, and with the web on, the network's reads.
describe("Nucleus's shell reads (NU9)", () => {
  // A checkout with a worktree beside it as Symbiote makes them, a finished one, links out, and a
  // folder holding a file named like an option.
  let repo: TestRepo;
  let outside: string;
  let holder: string;
  let records: string;
  let wt: string;
  let done: string;
  let reach: NucleusReach;

  const record = (branch: string, worktree: string, more: Record<string, unknown> = {}) => {
    const file = join(records, `${branch}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ agent: null, base: 'abc', branch, brief: 'b', worktree, ...more }),
    );
  };

  beforeAll(() => {
    repo = createRepo();
    repo.write({
      'docs/PLAN.md': '# Plan\n| V94 | x |\n',
      'docs/plan/a.md': '**Status:** built\n',
      'docs/plan/b.md': '**Status:** planned\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/kit.css': '.a { color: red; }\n',
      'symbiote/hive/x.jsonl': '{"a":1}\n',
      'weird/-o': 'x\n',
      'weird/x': 'y\n',
    });
    repo.commit('A');
    outside = tempDir();
    writeFileSync(join(outside, 'secret.txt'), 'SECRET\n');
    symlinkSync(outside, join(repo.root, 'out'));
    symlinkSync(join(outside, 'secret.txt'), join(repo.root, 'out-file.txt'));
    holder = `${repo.root}.worktrees`;
    wt = join(holder, 'feature-a');
    done = join(holder, 'feature-done');
    repo.git('worktree', 'add', '--quiet', wt, '-b', 'feature/a');
    repo.git('worktree', 'add', '--quiet', done, '-b', 'feature/done');
    records = join(repo.root, 'symbiote', 'workspaces');
    record('feature/a', wt);
    record('feature/done', done, { finished: '2026-11-04T00:00:00Z' });
    reach = { checkout: repo.root, worktrees: () => openWorktrees(repo.root, records) };
  });
  afterAll(() => {
    repo.cleanup();
    rmSync(holder, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  const fill = (command: string) =>
    command
      .replaceAll('<checkout>', repo.root)
      .replaceAll('<wt>', wt)
      .replaceAll('<done>', done)
      .replaceAll('<outside>', outside)
      .replaceAll('<holder>', holder);
  const context = (more: Partial<ShellContext> = {}): ShellContext => ({
    cwd: repo.root,
    reach,
    web: false,
    who: 'Nucleus',
    ...more,
  });
  const problem = (command: string, more: Partial<ShellContext> = {}) => {
    const check = shellCheck(fill(command), context(more));
    return check.ok ? null : check.problem;
  };

  // The 17 commands its gate refused (`symbiote/nucleus-activity.jsonl`), on the fixture's files.
  it.each([
    "git show HEAD:docs/PLAN.md | sed -n '1,2p;4,5p'",
    'git -C <checkout> log --oneline -15 -- src/a.ts src/b.ts',
    "git grep -h -o -E '^\\| V[0-9]+ \\|' main -- docs | sort -u | tail -5",
    "git -C <checkout> ls-files | grep -iE '(^|/)\\.mcp\\.json$|mcp.*\\.json$' | head",
    'ls -l --time-style=+%H:%M <checkout>/src/a.ts <checkout>/src/b.ts',
    'date; ls -l --time-style=+%T <wt>/src/a.ts 2>/dev/null',
    'tail -c 3000 <checkout>/symbiote/hive/x.jsonl',
    "grep -nE '^/\\* |^\\.[a-z-]+ *\\{|^\\.[a-z-]+,' src/kit.css | head -80",
    "cd <checkout>/docs/plan && grep -n -m3 -iE '^(> )?\\**status' a.md b.md",
    'wc -l src/*.ts && ls docs && ls docs/plan docs/plan 2>/dev/null',
    'wc -l docs/PLAN.md && grep -nE "V94|V95|NX6|WebSocket" docs/PLAN.md | head -40',
  ])('accepts what it was refused: %s', (command) => {
    expect(problem(command)).toBeNull();
  });

  it.each([
    'cat src/a.ts',
    'cat <wt>/src/a.ts',
    'head -n 5 src/a.ts',
    'head -5 docs/PLAN.md',
    'tail -n +2 docs/PLAN.md',
    'nl -ba src/a.ts | sed -n 1,10p',
    'stat -c %s src/a.ts',
    'du -sh src',
    'file src/a.ts',
    'find . -name "*.ts" -type f',
    'find src docs -maxdepth 2 -newer src/a.ts -print',
    'find <wt> -name *.md',
    'grep -rn export src',
    'grep -rn export',
    'grep -rl --files-with-matches export src',
    'grep -c -e export -e const src/a.ts src/b.ts',
    'rg -n export src',
    "rg --files -g '*.ts'",
    "rg -n 'a|b' -t ts <wt>",
    "sed -n '/Status/p' docs/plan/a.md",
    "sed 's/built/done/g' docs/plan/a.md",
    "sed -E -n '1p;$p' docs/PLAN.md",
    'sort -k2 -t, src/a.ts | uniq -c',
    'cut -d: -f1 src/a.ts | sort | uniq',
    "cat src/a.ts | tr -d '\\r'",
    "jq -c '.a' symbiote/hive/x.jsonl",
    "jq -r --arg x y '.a' symbiote/hive/x.jsonl",
    "git log --format='%h %s' | head -5",
    'git log --oneline\ngit --no-optional-locks status --porcelain',
    'pwd && basename src/a.ts && dirname src/a.ts && realpath src',
    "date -u +'%Y-%m-%d'",
    'echo hi',
    'cd src && cat a.ts',
    'cd <wt> && git log --oneline -3',
    'ls weird',
    'cat weird/*',
    'cat src/?.ts',
    'git log --oneline || echo none',
    // A backslash in double quotes expands nothing (the record's last refused read).
    'git log --all --oneline -G "\\[V94\\]|\\bV94\\b" -- docs/PLAN.md docs/plan',
    'grep -n "a\\"b" src/a.ts',
  ])('accepts %s', (command) => {
    expect(problem(command)).toBeNull();
  });

  it.each([
    // Outside the checkout and the open worktrees.
    ['cat /etc/passwd', 'outside'],
    ['cat ../x', '..'],
    ['cat <outside>/secret.txt', 'outside'],
    ['cat out-file.txt', 'outside'],
    ['cat out/secret.txt', 'outside'],
    ['grep -rn SECRET out', 'outside'],
    ['cat <done>/src/a.ts', 'outside'],
    ['ls <holder>', 'outside'],
    ['cd /tmp && ls', 'outside'],
    ['cd .. && ls', '..'],
    ['cd', 'cd'],
    ['cat ~/.bashrc', '~'],
    ['cat x=~/.bashrc', '~'],
    ['cat =ls', '='],
    ['ls /*', 'outside'],
    ['ls .*', 'hidden'],
    ['head /dev/stdin', 'outside'],
    // A match that would become an option.
    ['cd weird && sort *', 'option'],
    // Options that write, run a program, follow links out or read another file.
    ['find . -delete', '-delete'],
    ['find . -exec rm {} ;', '{'],
    ["find . -exec rm '{}' ';'", '-exec'],
    ['find . -execdir ls', '-execdir'],
    ['find . -fprint x', '-fprint'],
    ['find -L . -name x', '-L'],
    ['find . -follow', '-follow'],
    ['sed -i s/a/b/ src/a.ts', '-i'],
    ['sed --in-place s/a/b/ src/a.ts', '--in-place'],
    ["sed 'w /tmp/x' src/a.ts", 'sed'],
    ["sed 'r /etc/passwd' src/a.ts", 'sed'],
    ["sed 's/a/b/w /tmp/x' src/a.ts", 'sed'],
    ["sed 's/a/id/e' src/a.ts", 'sed'],
    ["sed -n '1e id' src/a.ts", 'sed'],
    ['sed -f script.sed src/a.ts', '-f'],
    ['sort -o x src/a.ts', '-o'],
    ['sort --output=x src/a.ts', '--output'],
    ['sort --compress-program=sh src/a.ts', '--compress-program'],
    ['uniq src/a.ts out.txt', 'uniq'],
    ['tail -f src/a.ts', '-f'],
    ['tail --follow src/a.ts', '--follow'],
    ['wc --files0-from=x', '--files0-from'],
    ['grep -R SECRET .', '-R'],
    ['grep -f /etc/hostname src/a.ts', '-f'],
    ['rg --pre cat x', '--pre'],
    ['rg -z x', '-z'],
    ['rg -L x', '-L'],
    ['ls -L out', '-L'],
    ['file -C -m x', '-C'],
    ["jq -n 'env'", 'env'],
    ["jq -n '$ENV.HOME'", 'ENV'],
    ['jq -n \'import "x" as x; 1\'', 'import'],
    ['jq --rawfile x /etc/passwd -n 1', '--rawfile'],
    ['jq -L /tmp -n 1', '-L'],
    ['date -s 2020-01-01', '-s'],
    ['date 0101', 'date'],
    // Programs that are not reads.
    ['awk 1 src/a.ts', 'awk'],
    ['xargs rm', 'xargs'],
    ['tee x', 'tee'],
    ['sh -c ls', 'sh'],
    ['node -e 1', 'node'],
    ['rm src/a.ts', 'rm'],
    ['/bin/cat src/a.ts', '/bin/cat'],
    ['X=1 cat src/a.ts', 'X=1'],
    // The shell's operators, substitutions and redirections.
    ['cat src/a.ts > x', '>'],
    ['cat < src/a.ts', '<'],
    ['cat $(echo src/a.ts)', '$'],
    ['cat `echo x`', '`'],
    ['cat "$(echo x)"', '$'],
    ['cat "\\\\$(echo x)"', '$'],
    ['cat src/a.ts &', '&'],
    ['cat src/a.ts |& head', '&'],
    ['(cat src/a.ts)', '('],
    ['cat src/[ab].ts', '['],
    ['cat src/a.ts ; ', null],
    ['| cat', 'pipe'],
    ['cat src/a.ts |', 'pipe'],
    ['cat src/a.ts && && ls', 'nothing'],
    // git as before: in a worktree, git diff rewrites its index, by -C or by cd.
    ['git -C <wt> diff', 'diff-index'],
    ['cd <wt> && git diff', 'diff-index'],
    ['cd <wt>; git diff --stat', 'diff-index'],
    ['git -C <done> log', 'outside'],
    ['git -C /tmp log', 'outside'],
    ['git push', 'git push'],
    ['git log --output=x', '--output'],
    ['git status', '--no-optional-locks'],
    ['git log | git checkout -b x', 'git checkout'],
    // The network, without the web.
    ['curl -sS https://example.com', 'web'],
    ['gh pr list', 'web'],
    ['git ls-remote origin', 'web'],
  ])('refuses %s', (command, named) => {
    const found = problem(command);
    if (named === null) {
      expect(found).toBeNull();
      return;
    }
    expect(found).toContain(named);
  });

  it.each([
    'curl -sS https://registry.npmjs.org/vite/latest',
    'curl -sSL --max-time 10 -H \'Accept: application/json\' "https://api.github.com/repos/x/y"',
    'curl -I https://example.com',
    'curl -s http://localhost:4173/api/workspaces | jq .',
    'curl -X GET --url https://example.com',
    'gh pr list --state open --limit 20',
    'gh pr view 12 --comments',
    'gh pr diff 12 | head -100',
    'gh pr checks 12',
    'gh issue view 3 -R attomius321/CPR',
    'gh run list --limit 5',
    'gh run view 123 --log | tail -50',
    'gh release list',
    'gh repo view',
    'gh search prs --author @me',
    'gh status',
    'gh api repos/x/y/pulls',
    "gh api repos/x/y/pulls --paginate --jq '.[].title'",
    'gh api -X GET search/issues -H Accept:application/json',
    'git ls-remote origin',
    'git ls-remote --heads https://github.com/x/y.git',
  ])('with the web, accepts %s', (command) => {
    expect(problem(command, { web: true })).toBeNull();
  });

  it.each([
    ['curl -d x=1 https://example.com', '-d'],
    ['curl --data x https://example.com', '--data'],
    ['curl -o x https://example.com', '-o'],
    ['curl -O https://example.com/x', '-O'],
    ['curl -T src/a.ts https://example.com', '-T'],
    ['curl -F f=@src/a.ts https://example.com', '-F'],
    ['curl -X POST https://example.com', 'POST'],
    ['curl -K x https://example.com', '-K'],
    ['curl -H @headers https://example.com', '@'],
    ['curl file:///etc/passwd', 'file'],
    ['curl example.com', 'http'],
    ['curl -sSo x https://example.com', '-o'],
    ['gh pr merge 12', 'gh pr merge'],
    ['gh pr create', 'gh pr create'],
    ['gh pr view 12 --web', '--web'],
    ['gh pr view 12 -w', '-w'],
    ['gh run download 5', 'gh run download'],
    ['gh pr checks 12 --watch', '--watch'],
    ['gh api -X POST repos/x/y/issues', 'POST'],
    ['gh api --method=DELETE repos/x/y', 'DELETE'],
    ['gh api repos/x/y/issues -f title=x', '-f'],
    ['gh api repos/x/y/issues -F title=x', '-F'],
    ['gh api repos/x/y/issues --raw-field title=x', '--raw-field'],
    ['gh api repos/x/y --input src/a.ts', '--input'],
    ["gh api graphql -f query='{viewer{login}}'", 'graphql'],
    ["gh api user --jq 'env'", 'env'],
    ['gh auth token', 'gh auth'],
    ['gh extension install x', 'gh extension'],
    ['git ls-remote --upload-pack=touch origin', '--upload-pack'],
    ['git ls-remote /etc', 'remote'],
    ['git ls-remote ext::sh', 'remote'],
    ['git fetch origin', 'git fetch'],
    ['wget https://example.com', 'wget'],
  ])('with the web, refuses %s', (command, named) => {
    expect(problem(command, { web: true })).toContain(named);
  });

  it('says what kind of read a command is: git, a read, the network', () => {
    expect(shellCheck('git log -1', context())).toEqual({ ok: true, kind: 'git' });
    expect(shellCheck('git log -1 | head', context())).toEqual({ ok: true, kind: 'read' });
    expect(shellCheck('cat src/a.ts', context())).toEqual({ ok: true, kind: 'read' });
    expect(shellCheck('gh pr list | head', context({ web: true }))).toEqual({
      ok: true,
      kind: 'network',
    });
  });

  it("reads relative paths from the call's folder, and refuses one outside the reach", () => {
    expect(problem('cat src/a.ts', { cwd: wt })).toBeNull();
    expect(problem('cat a.ts', { cwd: join(repo.root, 'src') })).toBeNull();
    expect(problem('cat secret.txt', { cwd: outside })).toContain('outside');
    expect(problem('git log -1', { cwd: outside })).toContain('outside');
  });

  const hookInput = (command: string, cwd = repo.root) => ({
    hook_event_name: 'PreToolUse',
    session_id: 's',
    cwd,
    tool_name: 'Bash',
    tool_input: { command: fill(command) },
  });

  it('lets the gate allow reads with their reason, and refuse with the rule', () => {
    expect(gateDecision(hookInput('cat src/a.ts'), { reach })).toEqual({
      allow: true,
      reason: 'a read command (NU9)',
    });
    expect(gateDecision(hookInput('git log -1'), { reach })).toEqual({ allow: true });
    expect(gateDecision(hookInput('gh pr list'), { reach, web: true })).toEqual({
      allow: true,
      reason: 'a read on the network (NU9)',
    });
    const denied = gateDecision(hookInput('cat /etc/passwd'), { reach });
    expect(denied).toMatchObject({ allow: false });
    expect(denied && !denied.allow && denied.reason).toMatch(/^Nucleus runs only read commands/);
    expect(denied && !denied.allow && denied.reason).toContain('/etc/passwd');
    const named = gateDecision(hookInput('awk 1 x'), { reach, name: 'Alpha Ceph' });
    expect(named && !named.allow && named.reason).toMatch(/^Alpha Ceph runs only read commands/);
    // Without the folders (a settings file from before V80): git's read commands only.
    expect(gateDecision(hookInput('cat src/a.ts'))).toMatchObject({ allow: false });
  });

  it('answers through the hook as Claude Code runs it', () => {
    const answer = gateHook(
      hookInput('wc -l docs/PLAN.md && grep -n V94 docs/PLAN.md | head -40'),
      [repo.root, records, '--name=Alpha Ceph'],
      {},
      'now',
    );
    expect(JSON.parse(answer ?? '')).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Alpha Ceph: a read command (NU9)',
      },
    });
  });
});
