// Scout's gate (V35, decision 236): what Scout's Claude Code may run, decided by Symbiote before
// Claude Code's own rules. Read, Grep and Glob pass to those rules; Bash runs only git's read
// commands this module parses; every other tool is denied. Claude Code's allow rules cannot do this:
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

function writingOption(command: string, word: string): string | null {
  if (word.startsWith('--')) {
    const name = word.split('=')[0] ?? word;
    const hit = WRITING.some(
      (option) => name.length >= 3 && (option.startsWith(name) || name.startsWith(option)),
    );
    return hit ? name : null;
  }
  if (word.startsWith('-O')) return '-O';
  if (command === 'grep' && /^-[^-]*O/.test(word)) return word;
  return null;
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
    const option = writingOption(name, arg);
    if (option) return `git ${name} ${option}: it writes a file or runs a program`;
  }
  for (const [filter] of filters) {
    if (!filter || !FILTERS.has(filter)) {
      return `a pipe into ${filter ?? 'nothing'}: only head, tail, wc or grep`;
    }
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
  return {
    allow: false,
    reason: `Scout is read-only: it reads files (Read, Grep, Glob) and git's history, and changes nothing (${v.tool_name}).`,
  };
}

/** The hook's output: Claude Code's PreToolUse decision, or nothing to leave it to its rules. */
export function hookOutput(decision: GateDecision): string {
  if (!decision) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.allow ? 'allow' : 'deny',
      permissionDecisionReason: decision.allow
        ? "Scout: one of git's read commands"
        : decision.reason,
    },
  });
}
