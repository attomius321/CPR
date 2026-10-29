import { describe, expect, it } from 'vitest';
import { gateDecision, gitReadProblem, hookOutput } from '../src/scout-gate.js';

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
