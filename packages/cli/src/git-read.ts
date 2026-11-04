// git's read commands (V35, decision 236; V80, decision 598), the check Nucleus's and Scribe's gates
// share: `git [--no-pager] <command> …` for the commands that read the repository and its history,
// no option that writes a file, runs a program or reads a file outside the repository. Its own
// module so that Nucleus's shell check (`nucleus-shell.ts`, NU9) and its gate use it without
// importing each other; like them, it uses nothing but Node's modules (the hook runs per call).
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

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
export function within(folder: string, target: string): boolean {
  const inside = relative(folder, target);
  return (
    inside === '' || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
  );
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
export const QUIET = ['2>&1', '2>/dev/null', '>/dev/null'];

/** Characters a word may hold unquoted: none that the shell expands or treats as an operator. */
export const PLAIN = /^[A-Za-z0-9_\-./:=@^~,+%]$/;

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
export const takes = (name: string, option: string) =>
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
 * Where git runs besides the call's folder (Nucleus's, V80; NU9): why a folder given with `-C` is
 * refused, and whether git, in that folder or (none given) the call's own, runs in a workspace's
 * worktree, where `git diff` rewrites the index its agent uses.
 */
export interface GitPlace {
  folderProblem: (folder: string) => string | null;
  inWorktree: (folder: string | undefined) => boolean;
}

/** V80's place: `-C` only into an open workspace's worktree, and the checkout not a worktree. */
const worktreesPlace = (worktrees: () => readonly string[]): GitPlace => ({
  folderProblem: (folder) => worktreeProblem(folder, worktrees),
  inWorktree: (folder) => folder !== undefined,
});

/**
 * git's own options before the command: `--no-pager`; with `place` (Nucleus's, V80), also
 * `--no-optional-locks` and one `-C` into a folder the place allows. The command's words, or what
 * is wrong.
 */
export function ownOptions(
  words: readonly string[],
  place?: GitPlace,
): { rest: string[]; folder?: string; quiet: boolean } | string {
  if (!place)
    return { rest: words[0] === '--no-pager' ? words.slice(1) : [...words], quiet: false };
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
    const problem = place.folderProblem(given);
    if (problem) return problem;
    folder = given;
    at++;
  }
  return { rest: words.slice(at), ...(folder ? { folder } : {}), quiet };
}

/**
 * Why git's words after `git` are not one of its read commands `who` runs, or null: the commands
 * in `READ_COMMANDS`, no option that writes or runs a program; with `place` (Nucleus's), also
 * `-C`, `diff-index` and `--no-optional-locks status`, and `git diff` refused in a worktree.
 */
export function gitArgsProblem(
  words: readonly string[],
  place?: GitPlace,
  who = 'Nucleus',
): string | null {
  const own = ownOptions(words, place);
  if (typeof own === 'string') return own;
  const [name, ...args] = own.rest;
  if (name === undefined) return 'say which git command: log, show, blame, diff…';
  if (name.startsWith('-')) {
    return place
      ? `git ${name}: none of git's own options but --no-pager, --no-optional-locks and -C <a workspace's worktree>`
      : `git ${name}: none of git's own options but --no-pager`;
  }
  if (!(place ? NUCLEUS_COMMANDS : READ_COMMANDS).has(name)) {
    return `git ${name} is not one of git's read commands ${who} runs`;
  }
  if (name === 'status' && !own.quiet) {
    return 'git status only as git --no-optional-locks status: without it git rewrites the index';
  }
  if (name === 'diff' && place?.inWorktree(own.folder)) {
    return 'git diff in a worktree rewrites its index, which its agent uses: git -C <worktree> diff-index -p HEAD shows its uncommitted changes';
  }
  for (const arg of args) {
    const option = refusedOption(name, arg);
    if (option) {
      return `git ${name} ${option}: it writes a file, runs a program, or reads a file outside the repository`;
    }
  }
  return null;
}

/**
 * Why `command` is not one of git's read commands Nucleus runs, or null when it is: `git
 * [--no-pager] <command> …` for the commands in `READ_COMMANDS`, no option that writes or runs a
 * program, optionally piped into `head`, `tail`, `wc` or `grep`. With `worktrees` (Nucleus's, V80):
 * also `-C <a workspace's worktree>`, where `git diff` is refused (it rewrites the index), and
 * `diff-index` and `--no-optional-locks status`, here and there. `who` runs them: Nucleus, or the
 * name its conversation started under (decision 686). Scribe's rule (decision 275); Nucleus's
 * gate, given its folders, checks the whole shell command since NU9 (`nucleus-shell.ts`).
 */
export function gitReadProblem(
  command: string,
  worktrees?: () => readonly string[],
  who = 'Nucleus',
): string | null {
  const stages = stagesOf(command);
  if (typeof stages === 'string') return stages;
  const [git = [], ...filters] = stages;
  const [program, ...rest] = git;
  if (program !== 'git') return `${program ?? command}: only git runs`;
  const problem = gitArgsProblem(rest, worktrees ? worktreesPlace(worktrees) : undefined, who);
  if (problem) return problem;
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
