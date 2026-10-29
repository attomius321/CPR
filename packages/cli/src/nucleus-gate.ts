// Nucleus's gate (V35, decision 236): what Nucleus's Claude Code may run, decided by Symbiote before
// Claude Code's own rules. Read, Grep and Glob pass to those rules, but in an open workspace's
// worktree, which the gate opens (V80, decisions 596-597); Bash runs only git's read commands this
// module parses, there too with `-C` (decision 598); Symbiote's own MCP tools pass (MC1: the asked
// ones wait for the person in Symbiote); WebSearch and WebFetch pass when Symbiote gives it the web
// (NU1, decision 592); every other tool, and every other server's, is denied. Claude Code's allow
// rules cannot do this: `Bash(git log *)` matches `git log --output=<file>`. The hook runs once per
// tool call in Claude Code's process tree (`nucleus-hook.ts`), so this module uses nothing but
// Node's modules.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

/** What the gate says of one tool call: allowed (and why, when not one of git's read commands),
 * denied with the reason, or null: Claude Code's own rules decide. */
export type GateDecision =
  { allow: true; reason?: string } | { allow: false; reason: string } | null;

/** `path`'s real path: its nearest folder that exists, made real, then the rest as written. */
export function realTarget(path: string): string {
  const rest: string[] = [];
  let head = path;
  for (;;) {
    try {
      return join(realpathSync(head), ...rest);
    } catch {
      // Not there yet: a new skill's folder, a new file.
    }
    const up = dirname(head);
    if (up === head) return path;
    rest.unshift(basename(head));
    head = up;
  }
}

/** Whether `target` is `folder` or in it. */
function within(folder: string, target: string): boolean {
  const inside = relative(folder, target);
  return (
    inside === '' || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
  );
}

/**
 * The open workspaces' worktrees (V80, decision 596), as real paths: the folder of each record in
 * `records` (`symbiote/workspaces/<branch>.json`) without `finished`, that git lists as a linked
 * worktree of `checkout`'s repository. Not the folder holding them, which a setting may put
 * anywhere; read at each tool call, so a workspace started during a conversation is in.
 */
export function openWorktrees(checkout: string, records: string): string[] {
  const named = new Set<string>();
  let files: string[];
  try {
    files = readdirSync(records, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const v = JSON.parse(readFileSync(join(records, file), 'utf8')) as Record<string, unknown>;
      const { branch, worktree } = v;
      // The file must be the branch's, as Symbiote reads them (`readRecords`).
      if (typeof branch !== 'string' || file !== `${branch.split('/').join(sep)}.json`) continue;
      if (typeof worktree !== 'string' || !isAbsolute(worktree) || v.finished !== undefined) {
        continue;
      }
      named.add(realpathSync(worktree));
    } catch {
      // Not a record, or its folder is gone.
    }
  }
  if (named.size === 0) return [];
  let listed: string;
  try {
    listed = execFileSync('git', ['-C', checkout, 'worktree', 'list', '--porcelain', '-z'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
  } catch {
    return [];
  }
  const found: string[] = [];
  // The first is the main worktree: the checkout, never a workspace's.
  for (const line of listed
    .split('\0')
    .filter((l) => l.startsWith('worktree '))
    .slice(1)) {
    try {
      const folder = realpathSync(line.slice('worktree '.length));
      if (named.has(folder)) found.push(folder);
    } catch {
      // Listed, and gone: `git worktree prune` would remove it.
    }
  }
  return found;
}

/** What Nucleus reads besides the checkout (V80): the open workspaces' worktrees. */
export interface NucleusReach {
  /** The checkout it runs in: a path there is Claude Code's to decide, as before. */
  checkout: string;
  /** The open workspaces' worktrees, real paths (`openWorktrees`). */
  worktrees: () => readonly string[];
}

/**
 * The reach the hook's arguments give: the checkout and the records folder, from Nucleus's settings
 * file; without both (a file written before V80), none: the checkout only. Read once, when asked.
 */
export function nucleusReach(args: readonly string[]): NucleusReach | undefined {
  // Its two folders come first; `--web` (NU1) is a flag after them.
  const [checkout, records] = args.filter((arg) => !arg.startsWith('--'));
  if (!checkout || !records) return undefined;
  let found: readonly string[] | undefined;
  return { checkout, worktrees: () => (found ??= openWorktrees(checkout, records)) };
}

/** Why `folder` is not in an open workspace's worktree for `git -C`, or null. */
function worktreeProblem(folder: string, worktrees: () => readonly string[]): string | null {
  if (!isAbsolute(folder)) return `git -C ${folder}: give a workspace's worktree, an absolute path`;
  if (folder.split(/[\\/]/).includes('..')) {
    return `git -C ${folder} holds "..": give the worktree's own path`;
  }
  const target = realTarget(folder);
  return worktrees().some((w) => within(w, target))
    ? null
    : `git -C ${folder}: not a workspace's worktree`;
}

/**
 * What the gate is told by its arguments in the settings file: the worktrees Nucleus reads (V80),
 * and whether it has the web (NU1).
 */
export interface GateOptions {
  reach?: NucleusReach;
  web?: boolean;
}

/**
 * The gate's options from its arguments: the checkout and the records folder (V80), and `--web`
 * when the conversation was started with the web (NU1). A settings file written before NU1, or
 * with `nucleus.web` false, gives no web; one written before V80, no reach.
 */
export function gateOptions(args: readonly string[]): GateOptions {
  const reach = nucleusReach(args);
  return { ...(reach ? { reach } : {}), web: args.includes('--web') };
}

/** Claude Code's tools on the web (NU1): a search at Anthropic, a page read by GET from here. */
const WEB = ['WebSearch', 'WebFetch'];

/** git's commands Nucleus runs: they read the repository and its history, and write nothing. */
const READ_COMMANDS = new Set([
  'log',
  'show',
  'blame',
  'diff',
  'shortlog',
  'grep',
  'rev-parse',
  'merge-base',
  'ls-files',
  'ls-tree',
]);

/**
 * Nucleus's besides (V80, decision 598): `diff-index`, the uncommitted changes, and `status` with
 * `--no-optional-locks`; neither writes the index, where `git diff` and a plain `git status` do.
 */
const NUCLEUS_COMMANDS = new Set([...READ_COMMANDS, 'diff-index', 'status']);

/** What a git read command may be piped into: filters that write nothing. */
const FILTERS = new Set(['head', 'tail', 'wc', 'grep']);

/** Redirections that only merge or drop output, accepted after a command. */
const QUIET = ['2>&1', '2>/dev/null', '>/dev/null'];

/** Characters a word may hold unquoted: none that the shell expands or treats as an operator. */
const PLAIN = /^[A-Za-z0-9_\-./:=@^~,+%]$/;

/**
 * Options that write a file or run a program: `--output` (log, show, diff),
 * `--open-files-in-pager` and `-O` (grep), `--ext-diff` (a configured diff program); `--no-index`
 * reads files outside the repository. git takes a long option's unique beginning (`--open=vi`), so
 * one is refused, and for grep any bundle of short options holding `O` (`-nOvi`).
 */
const WRITING = ['--output', '--open-files-in-pager', '--ext-diff', '--no-index'];

/**
 * Options that read a file anywhere and print it, or its first line in an error, as `--no-index`
 * would (fix/security-and-bugs): blame's `--contents`, `--ignore-revs-file` and `-S`, grep's
 * `--file` and `-f`. `--ignore-rev`, a commit to ignore, is blame's own and reads nothing.
 */
const READING = ['--contents', '--ignore-revs-file', '--file'];
const OWN = new Set(['--ignore-rev']);

/** Whether git would take `name` for `option`: the option itself, or its unique beginning. */
const takes = (name: string, option: string) =>
  name.length >= 3 && (option.startsWith(name) || name.startsWith(option));

function refusedOption(command: string, word: string): string | null {
  if (word.startsWith('--')) {
    const name = word.split('=')[0] ?? word;
    if (WRITING.some((option) => takes(name, option))) return name;
    if (!OWN.has(name) && READING.some((option) => takes(name, option))) return name;
    return null;
  }
  if (word.startsWith('-O')) return '-O';
  if (command === 'grep' && /^-[^-]*[Of]/.test(word)) return word;
  if (command === 'blame' && /^-[^-]*S/.test(word)) return word;
  return null;
}

/** Short options of grep's that take a value (`-e PATTERN`, `-m NUM`…), bundled last or alone. */
const GREP_VALUED = 'eABCm';
const GREP_VALUED_LONG = [
  '--regexp',
  '--max-count',
  '--after-context',
  '--before-context',
  '--context',
  '--label',
  '--binary-files',
];
/** grep's options that read files or folders, as short letters and long names. */
const GREP_READING = 'rRfdD';
const GREP_READING_LONG = [
  '--recursive',
  '--dereference-recursive',
  '--file',
  '--directories',
  '--devices',
  '--include',
  '--exclude',
  '--exclude-from',
  '--exclude-dir',
];

/**
 * Why a filter after a pipe would read something besides git's output, or null: `head` and `tail`
 * take options and counts, `wc` its counting options, `grep` its options but those that read files
 * and one pattern (none after `-e`); no file of their own (fix/security-and-bugs: `| tail ~/.bashrc`
 * read it).
 */
function filterProblem([filter, ...words]: string[]): string | null {
  const noFile = (word: string) => `${filter} ${word}: a filter reads git's output, no file`;
  if (filter === 'head' || filter === 'tail') {
    const file = words.find((w) => !w.startsWith('-') && !/^\+?\d+[a-zA-Z]*$/.test(w));
    return file === undefined ? null : noFile(file);
  }
  if (filter === 'wc') {
    const other = words.find(
      (w) => !/^-[clmwL]+$|^--(lines|words|bytes|chars|max-line-length)$/.test(w),
    );
    return other === undefined ? null : noFile(other);
  }
  // grep
  let patterns = 0;
  const operands: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    if (word === '--') {
      operands.push(...words.slice(i + 1));
      break;
    }
    if (word.startsWith('--')) {
      const name = word.split('=')[0] ?? word;
      if (GREP_READING_LONG.some((option) => takes(name, option))) return noFile(name);
      const valued = GREP_VALUED_LONG.find((option) => takes(name, option));
      if (valued === '--regexp') patterns++;
      if (valued && !word.includes('=')) i++;
      continue;
    }
    if (word.startsWith('-') && word !== '-') {
      for (let k = 1; k < word.length; k++) {
        const letter = word.charAt(k);
        if (GREP_READING.includes(letter)) return noFile(word);
        if (GREP_VALUED.includes(letter)) {
          if (letter === 'e') patterns++;
          if (k === word.length - 1) i++;
          break;
        }
      }
      continue;
    }
    operands.push(word);
  }
  const files = operands.slice(patterns > 0 ? 0 : 1);
  return files.length === 0 ? null : noFile(files[0] as string);
}

/** A command split into pipeline stages of words, or what makes it something else. */
function stagesOf(command: string): string[][] | string {
  const stages: string[][] = [[]];
  let word: string | null = null;
  const end = () => {
    if (word !== null) stages.at(-1)?.push(word);
    word = null;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command.charAt(i);
    if (c === ' ' || c === '\t') {
      end();
      continue;
    }
    if (c === '\n' || c === '\r') return 'one command on one line';
    // A redirection that only merges or drops output, as a word of its own.
    const quiet = word === null ? QUIET.find((q) => command.startsWith(q, i)) : undefined;
    if (quiet && /^(\s|\||$)/.test(command.slice(i + quiet.length, i + quiet.length + 1))) {
      i += quiet.length - 1;
      continue;
    }
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      if (close < 0) return 'a quote is not closed';
      word = (word ?? '') + command.slice(i + 1, close);
      i = close;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < command.length && command.charAt(j) !== '"'; j++) {
        const inner = command.charAt(j);
        if (inner === '$' || inner === '`' || inner === '\\') {
          return `no ${inner} in double quotes: use single quotes`;
        }
      }
      if (j >= command.length) return 'a quote is not closed';
      word = (word ?? '') + command.slice(i + 1, j);
      i = j;
      continue;
    }
    if (c === '|') {
      if (command.charAt(i + 1) === '|') return 'no ||: one command';
      end();
      if (stages.at(-1)?.length === 0) return 'a pipe with nothing before it';
      stages.push([]);
      continue;
    }
    if (!PLAIN.test(c)) {
      return `no ${c} outside quotes: no operators, redirections, substitutions or expansions`;
    }
    word = (word ?? '') + c;
  }
  end();
  if (stages.at(-1)?.length === 0) return 'a pipe with nothing after it';
  return stages;
}

/**
 * git's own options before the command: `--no-pager`; with `worktrees` (Nucleus's, V80), also
 * `--no-optional-locks` and one `-C` into an open workspace's worktree. The command's words, or
 * what is wrong.
 */
function ownOptions(
  words: string[],
  worktrees?: () => readonly string[],
): { rest: string[]; folder?: string; quiet: boolean } | string {
  if (!worktrees) return { rest: words[0] === '--no-pager' ? words.slice(1) : words, quiet: false };
  let folder: string | undefined;
  let quiet = false;
  let at = 0;
  for (; at < words.length; at++) {
    const word = words[at];
    if (word === '--no-pager') continue;
    if (word === '--no-optional-locks') {
      quiet = true;
      continue;
    }
    if (word !== '-C') break;
    if (folder !== undefined) return 'one -C at most';
    const given = words[at + 1];
    if (given === undefined) return "git -C takes a folder: a workspace's worktree";
    const problem = worktreeProblem(given, worktrees);
    if (problem) return problem;
    folder = given;
    at++;
  }
  return { rest: words.slice(at), ...(folder ? { folder } : {}), quiet };
}

/**
 * Why `command` is not one of git's read commands Nucleus runs, or null when it is: `git
 * [--no-pager] <command> …` for the commands in `READ_COMMANDS`, no option that writes or runs a
 * program, optionally piped into `head`, `tail`, `wc` or `grep`. With `worktrees` (Nucleus's, V80):
 * also `-C <a workspace's worktree>`, where `git diff` is refused (it rewrites the index), and
 * `diff-index` and `--no-optional-locks status`, here and there.
 */
export function gitReadProblem(
  command: string,
  worktrees?: () => readonly string[],
): string | null {
  const stages = stagesOf(command);
  if (typeof stages === 'string') return stages;
  const [git = [], ...filters] = stages;
  const [program, ...rest] = git;
  if (program !== 'git') return `${program ?? command}: only git runs`;
  const own = ownOptions(rest, worktrees);
  if (typeof own === 'string') return own;
  const [name, ...args] = own.rest;
  if (name === undefined) return 'say which git command: log, show, blame, diff…';
  if (name.startsWith('-')) {
    return worktrees
      ? `git ${name}: none of git's own options but --no-pager, --no-optional-locks and -C <a workspace's worktree>`
      : `git ${name}: none of git's own options but --no-pager`;
  }
  if (!(worktrees ? NUCLEUS_COMMANDS : READ_COMMANDS).has(name)) {
    return `git ${name} is not one of git's read commands Nucleus runs`;
  }
  if (name === 'status' && !own.quiet) {
    return 'git status only as git --no-optional-locks status: without it git rewrites the index';
  }
  if (name === 'diff' && own.folder) {
    return 'git diff in a worktree rewrites its index, which its agent uses: git -C <worktree> diff-index -p HEAD shows its uncommitted changes';
  }
  for (const arg of args) {
    const option = refusedOption(name, arg);
    if (option) {
      return `git ${name} ${option}: it writes a file, runs a program, or reads a file outside the repository`;
    }
  }
  for (const stage of filters) {
    const [filter] = stage;
    if (!filter || !FILTERS.has(filter)) {
      return `a pipe into ${filter ?? 'nothing'}: only head, tail, wc or grep`;
    }
    const problem = filterProblem(stage);
    if (problem) return problem;
  }
  return null;
}

const READS = ['Read', 'Grep', 'Glob'];

/**
 * Read (`file_path`), Grep and Glob (`path`) in an open workspace's worktree (V80, decision 597):
 * allowed when the path is absolute, holds no `..` (Node takes it before links), and its real path
 * is there (Read follows links). Anything else is Claude Code's to decide: the checkout, read as
 * before; elsewhere, denied in `dontAsk`.
 */
function readDecision(
  tool: string,
  input: { file_path?: unknown; path?: unknown },
  reach: NucleusReach | undefined,
): GateDecision {
  const path = tool === 'Read' ? input.file_path : input.path;
  if (!reach || typeof path !== 'string' || !isAbsolute(path)) return null;
  if (path.split(/[\\/]/).includes('..')) return null;
  const target = realTarget(path);
  // The checkout's own: no record read.
  if (within(realTarget(reach.checkout), target)) return null;
  return reach.worktrees().some((w) => within(w, target))
    ? { allow: true, reason: "a workspace's worktree" }
    : null;
}

/**
 * The gate's answer to one PreToolUse hook's input (Claude Code's documented fields): `reach`, the
 * worktrees Nucleus reads besides the checkout (V80); `web`, whether it has the web (NU1).
 */
export function gateDecision(
  input: unknown,
  { reach, web = false }: GateOptions = {},
): GateDecision {
  if (!input || typeof input !== 'object') return null;
  const v = input as { hook_event_name?: unknown; tool_name?: unknown; tool_input?: unknown };
  if (v.hook_event_name !== 'PreToolUse' || typeof v.tool_name !== 'string') return null;
  if (READS.includes(v.tool_name)) {
    return readDecision(v.tool_name, v.tool_input ?? {}, reach);
  }
  if (v.tool_name === 'Bash') {
    const command = (v.tool_input as { command?: unknown } | null)?.command;
    const problem =
      typeof command === 'string'
        ? gitReadProblem(command.trim(), reach?.worktrees)
        : 'no command given';
    if (problem === null) return { allow: true };
    return {
      allow: false,
      reason: reach
        ? "Nucleus runs only git's read commands (git log, show, blame, diff, shortlog, grep, " +
          'rev-parse, merge-base, ls-files, ls-tree, diff-index, and status with ' +
          "--no-optional-locks), one at a time, here or with -C <a workspace's worktree>, piped " +
          `into head, tail, wc or grep at most: ${problem}. Read, Grep and Glob read files.`
        : "Nucleus runs only git's read commands (git log, show, blame, diff, shortlog, grep, " +
          'rev-parse, merge-base, ls-files, ls-tree), one at a time, piped into head, tail, wc or ' +
          `grep at most: ${problem}. Read, Grep and Glob read files.`,
    };
  }
  if (v.tool_name.startsWith('mcp__')) {
    if (v.tool_name.startsWith(SYMBIOTE_TOOLS) && v.tool_name.length > SYMBIOTE_TOOLS.length) {
      return { allow: true };
    }
    return {
      allow: false,
      reason: `Nucleus acts only through Symbiote's tools (${SYMBIOTE_TOOLS}…), not ${v.tool_name}.`,
    };
  }
  if (WEB.includes(v.tool_name)) {
    if (web) return { allow: true };
    return {
      allow: false,
      reason: `Nucleus has no web in this conversation (${v.tool_name}): nucleus.web is false in symbiote/config.json, or the conversation started before Nucleus had it. A new conversation takes the setting.`,
    };
  }
  return {
    allow: false,
    reason: `Nucleus changes no file: it reads files (Read, Grep, Glob) and git's history, and acts only through Symbiote's tools (${v.tool_name}).`,
  };
}

/** The MCP tools Nucleus's session is given (MC1): Symbiote's server's, and no other's. */
const SYMBIOTE_TOOLS = 'mcp__symbiote__';

/**
 * The hook's output: Claude Code's PreToolUse decision, or nothing to leave it to its rules; `who`
 * is the agent whose gate let a command through (Nucleus's, or Scribe's since V41).
 */
export function hookOutput(decision: GateDecision, who = 'Nucleus'): string {
  if (!decision) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.allow ? 'allow' : 'deny',
      permissionDecisionReason: decision.allow
        ? `${who}: ${decision.reason ?? "one of git's read commands"}`
        : decision.reason,
    },
  });
}
