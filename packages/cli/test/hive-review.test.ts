// HV3: the running reviewer's parts — what a rerun keeps, the files it takes, its arguments and
// settings, the message's findings within their room, and bubblewrap's confinement of a rerun.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HiveFinding } from '@symbiote/core';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import {
  bubblewrapCommand,
  fileProblem,
  findingsText,
  installCommands,
  parseReviewAnswer,
  readReviewerConfig,
  reviewerArgs,
  reviewerSettings,
  reviewPrompt,
  rerunVerdict,
  reviewerSettingsService,
  reviewerEvents,
  sandboxMissing,
} from '../src/hive-review.js';
import type { ClaudeCode } from '../src/claude-code.js';
import { runGroup } from '../src/programs.js';
import { HIVE_REVIEW_ANSWER } from '../src/prompts.js';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
const folder = () => {
  const dir = tempDir();
  folders.push(dir);
  return dir;
};

describe("Symbiote's rerun of a reviewer's test (decision 678)", () => {
  it('keeps a finding only when its test failed by itself and its output names it', () => {
    expect(rerunVerdict('one says one', { code: 1, output: 'FAIL one says one\n' })).toEqual({
      kept: true,
    });
    // Colours do not hide the name.
    expect(rerunVerdict('a > b', { code: 1, output: '\u001b[31mFAIL\u001b[39m a > b' })).toEqual({
      kept: true,
    });
    expect(rerunVerdict('t', { code: 0, output: 'PASS t' })).toEqual({
      kept: false,
      why: "its test passed on Symbiote's rerun",
    });
    expect(
      rerunVerdict('counts nested comments', { code: 1, output: 'No test files found' }),
    ).toEqual({
      kept: false,
      why: 'its command failed, but its output does not name "counts nested comments"',
    });
    expect(rerunVerdict('t', { code: 127, output: 'sh: vitset: not found t' })).toMatchObject({
      kept: false,
      why: 'its command could not run (exit 127)',
    });
    expect(rerunVerdict('t', { code: null, output: 't' })).toMatchObject({ kept: false });
    expect(rerunVerdict('', { code: 1, output: 'FAIL' })).toEqual({
      kept: false,
      why: 'it named no test',
    });
  });

  it('takes only repo-relative files inside the copy', () => {
    const copy = folder();
    mkdirSync(join(copy, 'test'));
    writeFileSync(join(copy, 'test', 'a.test.ts'), 'x');
    symlinkSync(homedir(), join(copy, 'home'));
    expect(fileProblem('test/a.test.ts', copy)).toBeNull();
    expect(fileProblem('/etc/passwd', copy)).toBe('/etc/passwd is not repo-relative');
    expect(fileProblem('test/../../x', copy)).toBe('test/../../x holds ".."');
    expect(fileProblem('test/b.test.ts', copy)).toBe('test/b.test.ts is not in the copy');
    expect(fileProblem('home/.bashrc', copy)).toMatch(/leads outside the copy|is not in the copy/);
  });
});

describe("the reviewer's run (decisions 676, 677)", () => {
  it("is asked with Symbiote's settings only: no user, project or local settings, no MCP, no session kept", () => {
    const args = reviewerArgs({
      settings: '/cache/s.json',
      instructions: 'Review it.\n',
      model: 'opus',
      effort: 'high',
    });
    const after = (name: string) => args[args.indexOf(name) + 1];
    expect(args[0]).toBe('-p');
    expect(after('--output-format')).toBe('stream-json');
    expect(after('--setting-sources')).toBe('');
    expect(after('--settings')).toBe('/cache/s.json');
    expect(after('--permission-mode')).toBe('dontAsk');
    expect(after('--tools')).toBe('Bash,Read,Edit,Write,Grep,Glob');
    expect(after('--max-budget-usd')).toBe('5');
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--no-session-persistence');
    expect(JSON.parse(after('--json-schema') ?? '')).toMatchObject({
      required: ['summary', 'ran', 'findings'],
    });
    // Its instructions, then Symbiote's answer, which a project cannot change.
    expect(after('--append-system-prompt')).toBe(`Review it.\n\n${HIVE_REVIEW_ANSWER}`);
  });

  it('runs every command in the sandbox, refuses to start without it, and runs no hook', () => {
    const settings = JSON.parse(reviewerSettings()) as Record<string, Record<string, unknown>>;
    expect(settings.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
    });
    // Every command allowed, and run in the sandbox: measured, a write outside its copy fails
    // ("Read-only file system") and the network is refused. Without the rule, `dontAsk` refused a
    // whole command line that reached outside before it ran.
    expect(settings.permissions).toEqual({
      defaultMode: 'dontAsk',
      allow: ['Bash', 'Edit(./**)', 'Write(./**)'],
    });
    expect(settings.disableAllHooks).toBe(true);
  });

  it("reads the project's model and level, and leaves a word it does not take", () => {
    const root = folder();
    expect(readReviewerConfig(root)).toEqual({});
    mkdirSync(join(root, 'symbiote'));
    writeFileSync(
      join(root, 'symbiote', 'config.json'),
      JSON.stringify({ hive: { reviewer: { model: 'sonnet', effort: 'max' } } }),
    );
    expect(readReviewerConfig(root)).toEqual({ model: 'sonnet', effort: 'max' });
    writeFileSync(
      join(root, 'symbiote', 'config.json'),
      JSON.stringify({ hive: { reviewer: { model: 'rm -rf /', effort: 7 } } }),
    );
    expect(readReviewerConfig(root)).toEqual({});
  });

  it("installs with the check's leading package-manager installs only", () => {
    expect(installCommands(['pnpm install --frozen-lockfile', 'pnpm check', 'pnpm build'])).toEqual(
      ['pnpm install --frozen-lockfile'],
    );
    expect(installCommands(['npm ci', 'npm test'])).toEqual(['npm ci']);
    expect(installCommands(['make test', 'npm install'])).toEqual([]);
    expect(installCommands(['pnpm installer'])).toEqual([]);
  });

  it('reads its answer, leaving out a finding without a defect', () => {
    expect(parseReviewAnswer(null)).toBeNull();
    expect(parseReviewAnswer({ summary: 'x' })).toBeNull();
    expect(
      parseReviewAnswer({
        summary: ' Two. ',
        ran: 'tests',
        findings: [
          { defect: 'd', test: 't', command: 'c', files: ['a', 3, ''] },
          { defect: '', test: 't', command: 'c', files: [] },
        ],
      }),
    ).toEqual({
      summary: 'Two.',
      ran: 'tests',
      findings: [{ defect: 'd', test: 't', command: 'c', files: ['a'] }],
    });
  });

  it('is told the brief, the change, the check, and the round before as claims to check', () => {
    const before = {
      round: 1,
      findings: [
        {
          defect: 'uno',
          test: 'one says one',
          command: 'sh t.sh',
          files: ['t.sh'],
          kept: true,
        },
      ],
      report: 'I fixed it; the second test is wrong because the brief says nothing of it.',
    };
    const prompt = reviewPrompt({
      brief: 'Write one.',
      branch: 'feature/one',
      base: 'a'.repeat(40),
      tip: 'b'.repeat(40),
      diff: `+${'x'.repeat(90_000)}`,
      check: { ok: true, ms: 12_400, commands: ['pnpm install', 'pnpm check'] },
      installs: ['pnpm install'],
      before,
    });
    expect(prompt).toContain('Write one.');
    expect(prompt).toContain('git diff aaaaaaa..bbbbbbb (cut at 80,000 characters');
    expect(prompt).toContain(
      "Symbiote's check passed on bbbbbbb in 12 s: `pnpm install`, `pnpm check`.",
    );
    expect(prompt).toContain('In round 1, a reviewer proved these defects');
    expect(prompt).toContain('the second test is wrong because');
    expect(prompt).toContain('its dependencies installed (`pnpm install`)');
    expect(prompt.length).toBeLessThan(82_000);
  });
});

describe("the writer's message (decision 679)", () => {
  const finding = (n: number): HiveFinding => ({
    defect: `defect ${n}`,
    test: `test ${n}`,
    command: `sh t${n}.sh`,
    files: [`t${n}.sh`],
    kept: true,
    code: 1,
    output: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'),
  });

  it('gives each kept finding its defect, command, files and output; a dropped one not', () => {
    const files = new Map([['t1.sh', 'exit 1\n']]);
    const text = findingsText(
      [finding(1), { ...finding(2), kept: false, why: 'passed' }],
      files,
      '/s/hive/feature/x/r1',
      10_000,
    );
    expect(text).toContain('1. defect 1');
    expect(text).toContain('Test: test 1, run with `sh t1.sh`');
    expect(text).toContain('t1.sh (kept in /s/hive/feature/x/r1/t1.sh):\n```\nexit 1\n```');
    expect(text).toContain("Symbiote's rerun, its last lines:");
    expect(text).not.toContain('defect 2');
  });

  it('fits its room: the largest files leave first, named where they are kept', () => {
    const files = new Map([
      ['t1.sh', 'a'.repeat(9_000)],
      ['t2.sh', 'b'.repeat(500)],
    ]);
    const text = findingsText([finding(1), finding(2)], files, '/kept', 3_000);
    expect(text.length).toBeLessThanOrEqual(3_000);
    expect(text).toContain('t1.sh: its text is in /kept/t1.sh');
    expect(text).toContain('b'.repeat(500));
  });

  it('fences a file holding backticks with a longer fence', () => {
    const text = findingsText([finding(1)], new Map([['t1.sh', 'echo ```']]), '/k', 10_000);
    expect(text).toContain('````\necho ```\n````');
  });
});

const bwrap = ['/usr/bin/bwrap', '/bin/bwrap'].find((path) => existsSync(path));

describe('bubblewrap confines a rerun (decision 678)', () => {
  it('reads everything, writes only its copy, and has no network', () => {
    const line = bubblewrapCommand('/usr/bin/bwrap', 'npx vitest run "a b"', '/c/copy');
    expect(line).toBe(
      "'/usr/bin/bwrap' '--ro-bind' '/' '/' '--dev' '/dev' '--proc' '/proc' '--tmpfs' '/tmp' " +
        "'--bind' '/c/copy' '/c/copy' '--unshare-net' '--die-with-parent' '--chdir' '/c/copy' " +
        "'--' 'sh' '-c' 'npx vitest run \"a b\"'",
    );
  });

  it.skipIf(!bwrap || process.platform !== 'linux')(
    'a real rerun: the copy written, a file outside it and the network refused',
    async () => {
      const copy = folder();
      const outside = folder();
      // A user namespace may be refused (some containers): then there is nothing to check here.
      try {
        execFileSync(bwrap ?? 'bwrap', ['--ro-bind', '/', '/', 'true']);
      } catch {
        return;
      }
      const command = [
        'echo inside > in.txt',
        `(echo outside > ${outside}/out.txt) 2>/dev/null || echo "WRITE REFUSED"`,
        '(exec 3<>/dev/tcp/1.1.1.1/53) 2>/dev/null || echo "NETWORK REFUSED"',
        'exit 3',
      ].join('; ');
      const result = await runGroup(
        bubblewrapCommand(bwrap ?? 'bwrap', `bash -c '${command}'`, copy),
        copy,
      ).done;
      expect(result.code).toBe(3);
      expect(result.output).toContain('WRITE REFUSED');
      expect(result.output).toContain('NETWORK REFUSED');
      expect(existsSync(join(copy, 'in.txt'))).toBe(true);
      expect(existsSync(join(outside, 'out.txt'))).toBe(false);
    },
  );
});

describe("Settings' Reviewer (decision 680)", () => {
  const levels = ['low', 'medium', 'high', 'xhigh', 'max'];
  const claude = {
    efforts: () => Promise.resolve(levels),
    models: () =>
      Promise.resolve([
        { id: 'opus', name: 'Opus 5.5', efforts: { levels } },
        { id: 'sonnet', name: 'Sonnet 5.5', efforts: { levels: ['low', 'medium', 'high'] } },
        { id: 'haiku', name: 'Haiku 4.5' },
      ]),
  } as unknown as ClaudeCode;

  it("says Opus at high by default, Symbiote's, and keeps a change in the config", async () => {
    const root = folder();
    const settings = reviewerSettingsService(root, () => Promise.resolve(claude));
    const read = await settings.efforts();
    expect(read).toMatchObject({
      agents: [
        {
          kind: 'claude',
          efforts: { levels, default: 'high', by: 'symbiote' },
          defaultModel: { id: 'opus', by: 'symbiote' },
        },
      ],
      file: 'symbiote/config.json',
    });
    expect(read.model).toBeUndefined();
    const set = await settings.setModel({ model: 'sonnet' });
    expect(set.model).toBe('sonnet');
    // Sonnet's own levels now.
    expect(set.agents[0]?.efforts?.levels).toEqual(['low', 'medium', 'high']);
    await expect(settings.setEffort({ effort: 'max' })).rejects.toThrow(
      /Sonnet 5.5 takes low, medium or high: max/,
    );
    expect((await settings.setEffort({ effort: 'medium' })).effort).toBe('medium');
    expect(readReviewerConfig(root)).toEqual({ model: 'sonnet', effort: 'medium' });
    expect(
      JSON.parse(readFileSync(join(root, 'symbiote', 'config.json'), 'utf8')) as unknown,
    ).toEqual({ hive: { reviewer: { model: 'sonnet', effort: 'medium' } } });
    await settings.setModel({ model: null });
    await settings.setEffort({ effort: null });
    expect(readReviewerConfig(root)).toEqual({});
    await expect(settings.setModel({ model: 'gpt-6' })).rejects.toThrow(/lists no model gpt-6/);
  });
});

describe("the reviewer's events for its log (decision 696)", () => {
  it('its words and thinking come whole, then its calls, a command as typed and a path short', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'The parser first.' },
          { type: 'text', text: 'I will run the tests.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'pnpm vitest run a.test.ts\nmore' } },
          { type: 'tool_use', name: 'Read', input: { file_path: '/copy/src/a.ts' } },
        ],
      },
    });
    expect(reviewerEvents(line, '/copy')).toEqual([
      { think: 'The parser first.\n' },
      { say: 'I will run the tests.\n' },
      { tool: 'Bash', input: 'pnpm vitest run a.test.ts' },
      { tool: 'Read', input: 'src/a.ts' },
    ]);
    expect(reviewerEvents('not json', '/copy')).toEqual([]);
    // Its answer is a call of its own (`--json-schema`): said, not shown whole.
    const answer = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'StructuredOutput', input: { summary: 'None.' } }],
      },
    });
    expect(reviewerEvents(answer, '/copy')).toEqual([{ note: 'Writing its answer' }]);
    expect(
      reviewerEvents(
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'tool_result', content: 'a\nb\n' }] },
        }),
        '/copy',
      ),
    ).toEqual([{ result: '2 lines' }]);
  });
});

describe("Claude Code's refusal of a missing sandbox (HV3, fix)", () => {
  const SAID = 'sandbox required but unavailable: socat not installed';
  it('is read on its errors or a plain line of its output, never inside its stream', () => {
    expect(sandboxMissing({ stdout: '', stderr: `Error: ${SAID}\nmore` })).toBe(SAID);
    expect(sandboxMissing({ stdout: `${SAID}\n`, stderr: '' })).toBe(SAID);
    const quoted = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: `const X = /${SAID}/;` }] },
    });
    expect(sandboxMissing({ stdout: `${quoted}\n`, stderr: '' })).toBeNull();
    // It answered: whatever its errors say, it ran.
    const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false });
    expect(sandboxMissing({ stdout: `${result}\n`, stderr: SAID })).toBeNull();
  });
});
