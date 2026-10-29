// Scout's gate (V35, decision 236): what Scout's Claude Code may run, decided by Symbiote before
// Claude Code's own rules. Read, Grep and Glob pass to those rules; Bash runs only git's read
// commands this module parses; Symbiote's own MCP tools pass (MC1: the asked ones wait for the
// person in Symbiote); every other tool, and every other server's, is denied. Claude Code's allow rules cannot do this:
// `Bash(git log *)` matches `git log --output=<file>`. The hook runs once per tool call in Claude
// Code's process tree (`scout-hook.ts`), so this module uses nothing but plain TypeScript.

/** What the gate says of one tool call: allowed, denied with the reason, or null: Claude Code's
 * own rules decide. */
export type GateDecision = { allow: true } | { allow: false; reason: string } | null;

/** git's commands Scout runs: they read the repository and its history, and write nothing. */
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
 * Why `command` is not one of git's read commands Scout runs, or null when it is: `git
 * [--no-pager] <command> …` for the commands in `READ_COMMANDS`, no option that writes or runs a
 * program, optionally piped into `head`, `tail`, `wc` or `grep`.
 */
export function gitReadProblem(command: string): string | null {
  const stages = stagesOf(command);
  if (typeof stages === 'string') return stages;
  const [git = [], ...filters] = stages;
  const [program, ...rest] = git;
  if (program !== 'git') return `${program ?? command}: Scout runs git only`;
  const words = rest[0] === '--no-pager' ? rest.slice(1) : rest;
  const [name, ...args] = words;
  if (name === undefined) return 'say which git command: log, show, blame, diff…';
  if (name.startsWith('-')) return `git ${name}: none of git's own options but --no-pager`;
  if (!READ_COMMANDS.has(name)) return `git ${name} is not one of git's read commands Scout runs`;
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

/** The gate's answer to one PreToolUse hook's input (Claude Code's documented fields). */
export function gateDecision(input: unknown): GateDecision {
  if (!input || typeof input !== 'object') return null;
  const v = input as { hook_event_name?: unknown; tool_name?: unknown; tool_input?: unknown };
  if (v.hook_event_name !== 'PreToolUse' || typeof v.tool_name !== 'string') return null;
  if (READS.includes(v.tool_name)) return null;
  if (v.tool_name === 'Bash') {
    const command = (v.tool_input as { command?: unknown } | null)?.command;
    const problem =
      typeof command === 'string' ? gitReadProblem(command.trim()) : 'no command given';
    if (problem === null) return { allow: true };
    return {
      allow: false,
      reason:
        "Scout runs only git's read commands (git log, show, blame, diff, shortlog, grep, " +
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
      reason: `Scout acts only through Symbiote's tools (${SYMBIOTE_TOOLS}…), not ${v.tool_name}.`,
    };
  }
  return {
    allow: false,
    reason: `Scout changes no file: it reads files (Read, Grep, Glob) and git's history, and acts only through Symbiote's tools (${v.tool_name}).`,
  };
}

/** The MCP tools Scout's session is given (MC1): Symbiote's server's, and no other's. */
const SYMBIOTE_TOOLS = 'mcp__symbiote__';

/**
 * The hook's output: Claude Code's PreToolUse decision, or nothing to leave it to its rules; `who`
 * is the agent whose gate let a command through (Scout's, or Scribe's since V41).
 */
export function hookOutput(decision: GateDecision, who = 'Scout'): string {
  if (!decision) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.allow ? 'allow' : 'deny',
      permissionDecisionReason: decision.allow
        ? `${who}: one of git's read commands`
        : decision.reason,
    },
  });
}
