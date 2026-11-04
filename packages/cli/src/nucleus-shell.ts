// Nucleus's shell reads (NU9, decisions 917-922): the Bash commands Nucleus and Alpha Ceph run, as
// the shell would read them, checked word by word. The shell's read commands (`cat`, `grep`,
// `sed`, `find`, `jq`…) with their options that write a file, run a program, follow a link or read
// another file refused; every file or folder they are given in the checkout or an open workspace's
// worktree, by real path (Read's reach, decision 597); git's read commands as before
// (`git-read.ts`); with the web on, `curl` GET, `gh`'s reads and `git ls-remote`. Joined by `&&`,
// `||`, `;`, new lines and pipes, with `cd` into the reach. Nothing runs here: the gate decides,
// once per tool call, in Claude Code's process tree, so this module uses nothing but Node's modules.
import { readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  PLAIN,
  QUIET,
  gitArgsProblem,
  ownOptions,
  realTarget,
  takes,
  within,
  type GitPlace,
} from './git-read.js';

/** What Nucleus reads (V80): the checkout and the open workspaces' worktrees, real paths. */
export interface ShellReach {
  checkout: string;
  worktrees: () => readonly string[];
}

/** Where and as whom a command is checked. */
export interface ShellContext {
  /** The folder Claude Code runs the command in: the hook's `cwd`. */
  cwd: string;
  reach: ShellReach;
  /** Whether the conversation has the web (`--web`, decision 592): the network's reads. */
  web: boolean;
  /** Nucleus, or the name its conversation started under (decision 686). */
  who: string;
}

/** A command's verdict: what is wrong, or what kind of read it is (for the gate's reason). */
export type ShellCheck =
  { ok: false; problem: string } | { ok: true; kind: 'git' | 'read' | 'network' };

/** A word as the shell gives it to the program, and its pattern when it holds a glob. */
interface Word {
  text: string;
  /** The word with its quoted `*`, `?` and `\` escaped, when an unquoted `*` or `?` is in it. */
  glob?: string;
}

type Joint = '&&' | '||' | ';';

/** A command list: pipelines of stages, and how each pipeline joins the one before it. */
interface Pipeline {
  joint: Joint | null;
  stages: Word[][];
}

const SEPARATORS = /[\s|;&]/;

/** `command` split as the shell would split it, or why it is something else. */
function parse(command: string): Pipeline[] | string {
  const pipelines: Pipeline[] = [{ joint: null, stages: [[]] }];
  let text: string | null = null;
  let glob = '';
  let globbed = false;
  const pipeline = () => pipelines.at(-1) as Pipeline;
  const stage = () => pipeline().stages.at(-1) as Word[];
  const end = () => {
    if (text !== null) stage().push(globbed ? { text, glob } : { text });
    text = null;
    glob = '';
    globbed = false;
  };
  const add = (c: string, quoted: boolean) => {
    text = (text ?? '') + c;
    glob += quoted && '*?[\\'.includes(c) ? `\\${c}` : c;
  };
  const join = (joint: Joint) => {
    end();
    const empty = stage().length === 0;
    if (empty && pipeline().stages.length > 1) return 'a pipe with nothing after it';
    if (empty && joint !== ';') return `${joint} with nothing before it`;
    if (empty) return null;
    pipelines.push({ joint, stages: [[]] });
    return null;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command.charAt(i);
    if (c === ' ' || c === '\t') {
      end();
      continue;
    }
    if (c === '\n' || c === '\r' || c === ';') {
      const problem = join(';');
      if (problem) return problem;
      continue;
    }
    const quiet = text === null ? QUIET.find((q) => command.startsWith(q, i)) : undefined;
    const after = quiet ? command.charAt(i + quiet.length) : '';
    if (quiet && (after === '' || SEPARATORS.test(after))) {
      i += quiet.length - 1;
      continue;
    }
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      if (close < 0) return 'a quote is not closed';
      for (const q of command.slice(i + 1, close)) add(q, true);
      if (close === i + 1) text ??= '';
      i = close;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < command.length && command.charAt(j) !== '"'; j++) {
        const inner = command.charAt(j);
        if (inner === '$' || inner === '`') {
          return `no ${inner} in double quotes: use single quotes`;
        }
        // In double quotes a backslash escapes only $, `, ", \ and a new line; else it stays.
        // Either way it expands nothing.
        if (inner === '\\' && j + 1 < command.length) {
          const next = command.charAt(++j);
          if (!'$`"\\\n'.includes(next)) add(inner, true);
          if (next !== '\n') add(next, true);
          continue;
        }
        add(inner, true);
      }
      if (j >= command.length) return 'a quote is not closed';
      text ??= '';
      i = j;
      continue;
    }
    if (c === '|') {
      if (command.charAt(i + 1) === '|') {
        const problem = join('||');
        if (problem) return problem;
        i++;
        continue;
      }
      if (command.charAt(i + 1) === '&') return 'no |&: pipe the output, 2>&1 before the pipe';
      end();
      if (stage().length === 0) return 'a pipe with nothing before it';
      pipeline().stages.push([]);
      continue;
    }
    if (c === '&') {
      if (command.charAt(i + 1) !== '&')
        return 'no & outside quotes: nothing runs in the background';
      const problem = join('&&');
      if (problem) return problem;
      i++;
      continue;
    }
    if (c === '*' || c === '?') {
      add(c, false);
      globbed = true;
      continue;
    }
    if (!PLAIN.test(c)) {
      return `no ${c} outside quotes: no redirections, substitutions, groups or expansions`;
    }
    // A tilde the shell expands: at a word's start, or after = or : (bash's assignments).
    const before = command.charAt(i - 1);
    if (c === '~' && (text === null || ((before === '=' || before === ':') && text !== ''))) {
      return 'no ~ outside quotes: the shell makes it the home folder';
    }
    if (c === '=' && text === null) return 'no word beginning with = (zsh makes it a program)';
    add(c, false);
  }
  end();
  const last = pipeline();
  if (last.stages.at(-1)?.length === 0) {
    if (last.stages.length > 1) return 'a pipe with nothing after it';
    if (last.joint === '&&' || last.joint === '||') return `${last.joint} with nothing after it`;
    pipelines.pop();
  }
  if (pipelines.length === 0) return 'no command given';
  return pipelines;
}

/** Most matches a glob may have: one that lists more is no read to check. */
const MAX_MATCHES = 2000;

/** A glob's segment as a regular expression: `*` and `?` as the shell takes them, `\x` as `x`. */
function segmentRegex(segment: string): RegExp {
  let source = '';
  for (let i = 0; i < segment.length; i++) {
    const c = segment.charAt(i);
    if (c === '\\' && i + 1 < segment.length) {
      source += segment.charAt(++i).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

const active = (segment: string) => /(^|[^\\])[*?]/.test(segment);
const unescape = (segment: string) => segment.replace(/\\(.)/g, '$1');

/**
 * The words the shell gives for `word` in `cwd`: its matches, sorted, when it is a glob that
 * matches (no hidden names but for a segment that begins with `.`), else the word itself.
 */
function expand(word: Word, cwd: string): string[] | string {
  if (word.glob === undefined) return [word.text];
  const segments = word.glob.split('/');
  // [the folder on disk, the word as the shell writes it]
  let found: [string, string][] = [[isAbsolute(word.text) ? '/' : cwd, '']];
  if (isAbsolute(word.text)) segments.shift();
  for (const [index, segment] of segments.entries()) {
    const lead = index === 0 && !isAbsolute(word.text) ? '' : '/';
    if (!active(segment)) {
      const name = unescape(segment);
      found = found.map(([disk, shown]) => [join(disk, name), `${shown}${lead}${name}`]);
      continue;
    }
    if (segment.startsWith('.')) {
      return `${word.text}: no pattern for hidden names (a match could be ..)`;
    }
    const regex = segmentRegex(segment);
    const next: [string, string][] = [];
    for (const [disk, shown] of found) {
      let names: string[];
      try {
        names = readdirSync(disk);
      } catch {
        continue;
      }
      for (const name of names.sort()) {
        if (name.startsWith('.') || !regex.test(name)) continue;
        next.push([join(disk, name), `${shown}${lead}${name}`]);
        if (next.length > MAX_MATCHES) return `${word.text} matches more than ${MAX_MATCHES}`;
      }
    }
    found = next;
  }
  if (found.length === 0) return [word.text];
  const shown = found.map(([, s]) => s);
  const option = shown.find((s) => s.startsWith('-'));
  if (option) return `${word.text} matches ${option}, which the program would take for an option`;
  return shown;
}

/** The folders a part of the command may run in: one, or after `cd` and `;` or `||`, two. */
type Folders = readonly string[];

/** Why `path` is not one Nucleus reads from each of `folders`, or null. */
function pathProblem(path: string, folders: Folders, reach: ShellReach): string | null {
  if (path === '-') return null;
  if (path.split('/').includes('..')) return `${path} holds "..": give the file's own path`;
  const checkout = realTarget(reach.checkout);
  for (const folder of folders) {
    const target = realTarget(resolve(folder, path));
    if (within(checkout, target)) continue;
    if (reach.worktrees().some((w) => within(w, target))) continue;
    return `${path} is outside the checkout and the open workspaces' worktrees`;
  }
  return null;
}

/** Whether `folder` is in an open workspace's worktree (and not the checkout's own). */
function inWorktree(folder: string, reach: ShellReach): boolean {
  const target = realTarget(folder);
  return reach.worktrees().some((w) => within(w, target));
}

/** A read command's options, as GNU's tools parse them, and what its words are. */
interface Spec {
  /** Short options that take a value: the rest of the bundle, or the next word. */
  valued?: string;
  /** Long options that take a value when not given with `=`. */
  valuedLong?: readonly string[];
  /** Short options refused, anywhere in a bundle. */
  refused?: string;
  /** Long options refused, or their unique beginning. */
  refusedLong?: readonly string[];
  /**
   * What its words that are no option are: files and folders; nothing read (`echo`, `tr`); or
   * the first a pattern or a script unless given by `-e` (grep, rg, sed), then files.
   */
  operands: 'paths' | 'none' | 'pattern';
  /** More checks of the options and operands found. */
  check?: (found: Found) => string | null;
  /** Long options by their whole name only (ripgrep's parser takes no abbreviation). */
  exact?: boolean;
}

/**
 * Whether a program would take `name` for `option`: the whole name, or (getopt_long's rule) its
 * beginning of three letters or more; unless `exact`.
 */
const names = (name: string, option: string, exact = false) =>
  name === option || (!exact && name.length >= 3 && option.startsWith(name));

/** The options and operands of one stage. */
interface Found {
  options: { name: string; value?: string }[];
  operands: string[];
}

const SED_ADDRESS = String.raw`(?:\d+|\$|\d+~\d+|/(?:[^/\\]|\\.)*/I?)`;
const SED_PART = new RegExp(
  String.raw`^(?:${SED_ADDRESS}(?:,(?:${SED_ADDRESS}|[+~]\d+))?)?\s*!?\s*` +
    String.raw`(?:[pdqQ=]|s/(?:[^/\\]|\\.)*/(?:[^/\\]|\\.)*/[gpiImM0-9]*)$`,
);

/** Why a sed script would do more than print, delete or substitute, or null. */
function sedProblem(script: string): string | null {
  for (const part of script.split(/[;\n]/)) {
    const trimmed = part.trim();
    if (trimmed === '' || SED_PART.test(trimmed)) continue;
    return `sed's script ${trimmed}: only addresses with p, d, q, = or s/…/…/ (no w, r or e)`;
  }
  return null;
}

/** jq's and gh's filters must not print the environment, which holds the tokens. */
const ENV_WORDS = /\benv\b|\$ENV\b|\$__loc__|\bimport\b|\binclude\b|\binput_filename\b/;

const envProblem = (filter: string, what: string) => {
  const found = ENV_WORDS.exec(filter);
  return found ? `${what} ${found[0]}: it would print the environment or read another file` : null;
};

/** The read commands (decision 917), as GNU's coreutils, grep, sed, findutils, ripgrep and jq. */
const READS: Record<string, Spec> = {
  cat: { operands: 'paths' },
  head: { valued: 'cn', valuedLong: ['--bytes', '--lines'], operands: 'paths' },
  tail: {
    valued: 'cns',
    valuedLong: ['--bytes', '--lines', '--sleep-interval', '--max-unchanged-stats'],
    refused: 'fF',
    refusedLong: ['--follow', '--pid', '--retry'],
    operands: 'paths',
  },
  wc: { refusedLong: ['--files0-from'], operands: 'paths' },
  ls: {
    valued: 'ITw',
    valuedLong: [
      '--block-size',
      '--format',
      '--hide',
      '--ignore',
      '--indicator-style',
      '--quoting-style',
      '--sort',
      '--tabsize',
      '--time',
      '--time-style',
      '--width',
    ],
    refused: 'L',
    refusedLong: ['--dereference'],
    operands: 'paths',
  },
  stat: { valued: 'c', valuedLong: ['--format', '--printf'], operands: 'paths' },
  du: {
    valued: 'dBt',
    valuedLong: ['--max-depth', '--block-size', '--threshold', '--time-style', '--exclude'],
    refused: 'LX',
    refusedLong: ['--dereference', '--exclude-from', '--files0-from'],
    operands: 'paths',
  },
  file: {
    valued: 'FeP',
    valuedLong: ['--separator', '--exclude', '--exclude-quiet', '--parameter'],
    refused: 'fmC',
    refusedLong: ['--files-from', '--magic-file', '--compile'],
    operands: 'paths',
  },
  nl: { valued: 'bdfhilnsvw', operands: 'paths' },
  cut: {
    valued: 'bcdf',
    valuedLong: ['--bytes', '--characters', '--delimiter', '--fields', '--output-delimiter'],
    operands: 'paths',
  },
  tr: { operands: 'none' },
  uniq: {
    valued: 'fsw',
    valuedLong: ['--skip-fields', '--skip-chars', '--check-chars'],
    operands: 'paths',
    check: ({ operands }) =>
      operands.length > 1 ? 'uniq takes one file at most: a second is its output' : null,
  },
  sort: {
    valued: 'kSt',
    valuedLong: [
      '--key',
      '--field-separator',
      '--buffer-size',
      '--parallel',
      '--batch-size',
      '--sort',
    ],
    refused: 'oT',
    refusedLong: [
      '--output',
      '--temporary-directory',
      '--compress-program',
      '--files0-from',
      '--random-source',
    ],
    operands: 'paths',
  },
  basename: { valued: 's', valuedLong: ['--suffix'], operands: 'none' },
  dirname: { operands: 'none' },
  realpath: { valuedLong: ['--relative-to', '--relative-base'], operands: 'paths' },
  pwd: { operands: 'none' },
  echo: { operands: 'none' },
  date: {
    valued: 'dI',
    valuedLong: ['--date'],
    refused: 'sfr',
    refusedLong: ['--set', '--file', '--reference'],
    operands: 'none',
    check: ({ operands }) => {
      const other = operands.find((o) => !o.startsWith('+'));
      return other === undefined ? null : `date ${other}: only a +format (a date sets the clock)`;
    },
  },
  grep: {
    valued: 'eABCmdD',
    valuedLong: [
      '--regexp',
      '--max-count',
      '--after-context',
      '--before-context',
      '--context',
      '--label',
      '--binary-files',
      '--include',
      '--exclude',
      '--exclude-dir',
      '--directories',
      '--devices',
      '--group-separator',
    ],
    refused: 'fR',
    refusedLong: ['--file', '--exclude-from', '--dereference-recursive'],
    operands: 'pattern',
  },
  rg: {
    valued: 'eEgtTmABCMjrd',
    valuedLong: [
      '--regexp',
      '--glob',
      '--iglob',
      '--type',
      '--type-not',
      '--type-add',
      '--type-clear',
      '--max-count',
      '--after-context',
      '--before-context',
      '--context',
      '--max-columns',
      '--threads',
      '--replace',
      '--max-depth',
      '--max-filesize',
      '--sort',
      '--sortr',
      '--colors',
      '--encoding',
      '--engine',
      '--context-separator',
      '--field-match-separator',
      '--field-context-separator',
      '--path-separator',
    ],
    refused: 'zLf',
    refusedLong: [
      '--pre',
      '--pre-glob',
      '--search-zip',
      '--follow',
      '--file',
      '--ignore-file',
      '--hostname-bin',
    ],
    operands: 'pattern',
    exact: true,
  },
  sed: {
    valued: 'el',
    valuedLong: ['--expression', '--line-length'],
    refused: 'fi',
    refusedLong: ['--file', '--in-place'],
    operands: 'pattern',
  },
};

/** Why a stage's words are not GNU's options and operands `spec` allows, or what they are. */
function options(program: string, words: readonly string[], spec: Spec): Found | string {
  const found: Found = { options: [], operands: [] };
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    if (word === '--') {
      found.operands.push(...words.slice(i + 1));
      break;
    }
    if (word.startsWith('--')) {
      const [name = word, ...rest] = word.split('=');
      if (spec.refusedLong?.some((option) => names(name, option, spec.exact))) {
        return `${program} ${name}: it writes, runs a program, follows a link or reads another file`;
      }
      const valued = spec.valuedLong?.some((option) => names(name, option, spec.exact));
      const value = rest.length > 0 ? rest.join('=') : valued ? words[++i] : undefined;
      found.options.push({ name, ...(value !== undefined ? { value } : {}) });
      continue;
    }
    if (/^-\d+$/.test(word)) {
      // A count: head -5, tail -20.
      found.options.push({ name: word });
      continue;
    }
    if (word.startsWith('-') && word !== '-') {
      for (let k = 1; k < word.length; k++) {
        const letter = word.charAt(k);
        if (spec.refused?.includes(letter)) {
          return `${program} -${letter}: it writes, runs a program, follows a link or reads another file`;
        }
        if (spec.valued?.includes(letter)) {
          const value = k < word.length - 1 ? word.slice(k + 1) : words[++i];
          found.options.push({ name: `-${letter}`, ...(value !== undefined ? { value } : {}) });
          break;
        }
        found.options.push({ name: `-${letter}` });
      }
      continue;
    }
    found.operands.push(word);
  }
  return found;
}

/** The files a read command is given: its operands, but a pattern or script given first. */
function pathsOf(program: string, spec: Spec, found: Found): string[] {
  if (spec.operands === 'none') return [];
  if (spec.operands === 'paths') return found.operands;
  if (program === 'rg' && found.options.some((o) => o.name === '--files')) return found.operands;
  const given = found.options.some((o) =>
    ['-e', '--regexp', '--expression'].some((name) => names(o.name, name, spec.exact)),
  );
  return given ? found.operands : found.operands.slice(1);
}

/** `find`'s primaries that write, run a program, follow links or read a list of files. */
const FIND_REFUSED = new Set([
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
  '-follow',
  '-files0-from',
  '-L',
]);

/** Why a `find` would do more than list, or its start folders. */
function findPaths(words: readonly string[]): string[] | string {
  let at = 0;
  // Its own options before the folders: -H and -P (links only as given), -O and -D.
  while (/^-([HP]|O\d*|D)$/.test(words[at] ?? '')) at += words[at] === '-D' ? 2 : 1;
  const paths: string[] = [];
  for (; at < words.length && !(words[at] as string).startsWith('-'); at++) {
    paths.push(words[at] as string);
  }
  for (const word of words) {
    if (FIND_REFUSED.has(word)) {
      return `find ${word}: it writes, runs a program, follows links or reads another file`;
    }
  }
  return paths;
}

/** Why jq's words would read another file or the environment, or its files. */
function jqPaths(words: readonly string[]): string[] | string {
  const operands: string[] = [];
  let args = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    if (args) continue;
    if (['--args', '--jsonargs'].includes(word)) {
      args = true;
      continue;
    }
    if (['--arg', '--argjson'].includes(word)) {
      i += 2;
      continue;
    }
    if (['--indent'].includes(word)) {
      i++;
      continue;
    }
    if (word.startsWith('--')) {
      if (['--rawfile', '--slurpfile', '--from-file', '--library-path'].includes(word)) {
        return `jq ${word}: it reads another file`;
      }
      continue;
    }
    if (word.startsWith('-') && word !== '-') {
      const letter = [...word.slice(1)].find((l) => 'fL'.includes(l));
      if (letter) return `jq -${letter}: it reads another file`;
      continue;
    }
    operands.push(word);
  }
  const [filter, ...paths] = operands;
  if (filter === undefined) return [];
  return envProblem(filter, 'jq') ?? paths;
}

/** curl's options Nucleus may use (decision 920): reading, never sending a file or writing one. */
const CURL_FLAGS = 'sSLIifvkGg';
const CURL_VALUED = 'HAemwrX';
const CURL_LONG_FLAGS = new Set([
  '--silent',
  '--show-error',
  '--location',
  '--head',
  '--include',
  '--fail',
  '--fail-with-body',
  '--verbose',
  '--insecure',
  '--get',
  '--globoff',
  '--compressed',
  '--http1.1',
  '--http2',
  '--no-progress-meter',
]);
const CURL_LONG_VALUED = new Set([
  '--header',
  '--user-agent',
  '--referer',
  '--max-time',
  '--connect-timeout',
  '--retry',
  '--retry-delay',
  '--retry-max-time',
  '--write-out',
  '--max-redirs',
  '--range',
  '--url',
  '--request',
]);

const URL = /^https?:\/\/[^\s]/i;

/** Why a `curl` would send, write or read more than an http(s) GET or HEAD, or null. */
function curlProblem(words: readonly string[]): string | null {
  const value = (name: string, given: string | undefined): string | null => {
    if (given === undefined) return `curl ${name} takes a value`;
    if (given.startsWith('@') && name !== '-X' && name !== '--request') {
      return `curl ${name} ${given}: a value from a file (@) is read from disk`;
    }
    if ((name === '-X' || name === '--request') && !/^(GET|HEAD)$/i.test(given)) {
      return `curl ${name} ${given}: GET or HEAD only, a read`;
    }
    if (name === '--url' && !URL.test(given)) {
      return `curl reads http:// and https:// URLs only: ${given}`;
    }
    return null;
  };
  let urls = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    if (word.startsWith('--')) {
      const [name = word, ...rest] = word.split('=');
      if (CURL_LONG_FLAGS.has(name)) continue;
      if (!CURL_LONG_VALUED.has(name)) return `curl ${name}: not one of the options it may use`;
      const problem = value(name, rest.length > 0 ? rest.join('=') : words[++i]);
      if (problem) return problem;
      if (name === '--url') urls++;
      continue;
    }
    if (word.startsWith('-') && word !== '-') {
      for (let k = 1; k < word.length; k++) {
        const letter = word.charAt(k);
        if (CURL_FLAGS.includes(letter)) continue;
        if (!CURL_VALUED.includes(letter))
          return `curl -${letter}: not one of the options it may use`;
        const problem = value(`-${letter}`, k < word.length - 1 ? word.slice(k + 1) : words[++i]);
        if (problem) return problem;
        break;
      }
      continue;
    }
    if (!URL.test(word)) return `curl reads http:// and https:// URLs only: ${word}`;
    urls++;
  }
  return urls === 0 ? 'curl: give the URL to read' : null;
}

/** gh's read commands (decision 920), by group: what reads, never what changes. */
const GH_READS: Record<string, readonly string[]> = {
  pr: ['view', 'list', 'diff', 'checks', 'status'],
  issue: ['view', 'list', 'status'],
  run: ['view', 'list'],
  release: ['view', 'list'],
  repo: ['view'],
  workflow: ['view', 'list'],
  search: ['repos', 'issues', 'prs', 'code', 'commits'],
};

/** Why a `gh` would change something, open a browser, or print the environment, or null. */
function ghProblem(words: readonly string[]): string | null {
  const [group, sub] = words;
  if (group === undefined) return 'gh: say which read: pr, issue, run, release, repo, search, api';
  const filters = (from: number): string | null => {
    for (let i = from; i < words.length; i++) {
      const word = words[i] as string;
      const [name = word, ...rest] = word.split('=');
      if (['--jq', '-q', '--template', '-t'].includes(name)) {
        const given = rest.length > 0 ? rest.join('=') : (words[i + 1] ?? '');
        const problem = envProblem(given, `gh ${name}`);
        if (problem) return problem;
      }
    }
    return null;
  };
  if (group === 'status') return filters(1);
  if (group === 'api') {
    const endpoint = words.slice(1).find((w) => !w.startsWith('-'));
    if (endpoint === 'graphql') return 'gh api graphql: a query may change something (a mutation)';
    for (let i = 1; i < words.length; i++) {
      const word = words[i] as string;
      const [name = word, ...rest] = word.split('=');
      if (name === '-X' || name === '--method' || /^-X./.test(word)) {
        const given =
          word.startsWith('-X') && word.length > 2
            ? word.slice(2)
            : rest.length > 0
              ? rest.join('=')
              : words[++i];
        if (!/^GET$/i.test(given ?? '')) return `gh api ${name} ${given ?? ''}: GET only, a read`;
        continue;
      }
      if (['--field', '--raw-field', '--input'].includes(name)) {
        return `gh api ${name}: it sends a value or a file (and makes the request a POST)`;
      }
      if (/^-[^-]/.test(word)) {
        const letter = [...word.slice(1)].find((l) => 'fF'.includes(l));
        if (letter)
          return `gh api -${letter}: it sends a value or a file (and makes the request a POST)`;
      }
    }
    return filters(1);
  }
  const reads = GH_READS[group];
  if (!reads) return `gh ${group} is not one of gh's reads it runs`;
  if (sub === undefined || !reads.includes(sub))
    return `gh ${group} ${sub ?? ''} is not one of gh's reads it runs`;
  for (const word of words.slice(2)) {
    const [name = word] = word.split('=');
    if (name === '--web' || name === '--watch')
      return `gh ${group} ${sub} ${name}: it opens a browser or keeps watching`;
    if (/^-[^-]/.test(word) && word.slice(1).includes('w')) {
      return `gh ${group} ${sub} -w: it opens a browser`;
    }
  }
  return filters(2);
}

/** A remote `git ls-remote` reads: a name, or an https://, ssh://, git:// or git@ URL. */
const REMOTE =
  /^([A-Za-z0-9][A-Za-z0-9_.-]*|(https?|ssh|git):\/\/\S+|[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+:\S*)$/;

/** Why a `git ls-remote` would run a program or read a local repository, or null. */
function lsRemoteProblem(words: readonly string[]): string | null {
  const operands: string[] = [];
  for (const word of words) {
    const [name = word] = word.split('=');
    if (name.startsWith('--') && ['--upload-pack', '--exec'].some((o) => takes(name, o))) {
      return `git ls-remote ${name}: it runs a program`;
    }
    if (/^-[^-]/.test(word) && word.includes('u')) return 'git ls-remote -u: it runs a program';
    if (!word.startsWith('-')) operands.push(word);
  }
  const [remote] = operands;
  if (remote !== undefined && !REMOTE.test(remote)) {
    return `git ls-remote ${remote}: give a remote, its name or an https://, ssh:// or git@ URL`;
  }
  return null;
}

/** The programs that read the network (decision 920). */
const NETWORK = new Set(['curl', 'gh']);

/** Why one stage may not run in `folders`, or null. */
function stageCheck(
  words: readonly string[],
  folders: Folders,
  context: ShellContext,
): string | null {
  const { reach, web, who } = context;
  const [program = '', ...args] = words;
  const noWeb = (what: string) =>
    `${what} reads the web, and ${who} has no web in this conversation: nucleus.web is false in symbiote/config.json, or the conversation started before ${who} had it`;
  if (program === 'git') {
    const place: GitPlace = {
      folderProblem: (folder) => {
        if (!isAbsolute(folder)) return `git -C ${folder}: give an absolute path`;
        return pathProblem(folder, ['/'], reach);
      },
      inWorktree: (folder) =>
        folder === undefined
          ? folders.some((f) => inWorktree(f, reach))
          : inWorktree(folder, reach),
    };
    const own = ownOptions(args, place);
    if (typeof own !== 'string' && own.rest[0] === 'ls-remote') {
      if (!web) return noWeb('git ls-remote');
      return lsRemoteProblem(own.rest.slice(1));
    }
    if (typeof own !== 'string' && own.folder === undefined) {
      const problem = folders.map((f) => pathProblem(f, ['/'], reach)).find(Boolean);
      if (problem) return `git runs here: ${problem}`;
    }
    return gitArgsProblem(args, place, who);
  }
  if (NETWORK.has(program)) {
    if (!web) return noWeb(program);
    return program === 'curl' ? curlProblem(args) : ghProblem(args);
  }
  let paths: string[] | string;
  if (program === 'find') paths = findPaths(args);
  else if (program === 'jq') paths = jqPaths(args);
  else {
    const spec = READS[program];
    if (!spec) {
      return `${program} is not one of the read commands ${who} runs`;
    }
    const found = options(program, args, spec);
    if (typeof found === 'string') return found;
    const problem =
      spec.check?.(found) ??
      (program === 'sed' ? sedScripts(found).map(sedProblem).find(Boolean) : null);
    if (problem) return problem;
    paths = pathsOf(program, spec, found);
  }
  if (typeof paths === 'string') return paths;
  for (const path of paths) {
    const problem = pathProblem(path, folders, reach);
    if (problem) return problem;
  }
  return null;
}

/** What kind of read an allowed stage is: git's, the network's, or the shell's. */
function stageKind([program, ...args]: readonly string[]): 'git' | 'read' | 'network' {
  if (NETWORK.has(program ?? '')) return 'network';
  if (program !== 'git') return 'read';
  const own = ownOptions(args, { folderProblem: () => null, inWorktree: () => false });
  return typeof own !== 'string' && own.rest[0] === 'ls-remote' ? 'network' : 'git';
}

/** sed's scripts: those given with -e, else its first operand. */
function sedScripts(found: Found): string[] {
  const given = found.options
    .filter((o) => o.name === '-e' || names(o.name, '--expression'))
    .map((o) => o.value ?? '');
  return given.length > 0 ? given : found.operands.slice(0, 1);
}

/**
 * Whether `command` is one Nucleus may run (NU9): what is wrong, or the kind of read — `git` when
 * it is git's read commands alone, `network` when it reads the web, else `read`.
 */
export function shellCheck(command: string, context: ShellContext): ShellCheck {
  const parsed = parse(command.trim());
  if (typeof parsed === 'string') return { ok: false, problem: parsed };
  let folders: Folders = [context.cwd];
  const kinds = new Set<string>();
  let stages = 0;
  for (const { joint, stages: pipeline } of parsed) {
    const [first] = pipeline;
    if (first?.[0]?.text === 'cd' && first[0].glob === undefined) {
      if (pipeline.length > 1 || first.length !== 2) {
        return { ok: false, problem: 'cd takes one folder, alone: cd <folder> && …' };
      }
      const target = first[1] as Word;
      if (target.glob !== undefined || target.text === '-') {
        return { ok: false, problem: `cd ${target.text}: give the folder itself` };
      }
      const problem = pathProblem(target.text, folders, context.reach);
      if (problem) return { ok: false, problem };
      const next = folders.map((f) => resolve(f, target.text));
      // After &&, the parts run only where cd went; after ; or ||, where it went or not.
      folders = joint === null || joint === '&&' ? next : [...new Set([...folders, ...next])];
      continue;
    }
    if (joint === ';' || joint === '||') folders = [...new Set(folders)];
    for (const words of pipeline) {
      const argv: string[] = [];
      for (const [index, word] of words.entries()) {
        const program = index === 0;
        if (program && word.glob !== undefined) {
          return { ok: false, problem: `${word.text}: a program's name, not a pattern` };
        }
        if (program && (word.text.includes('/') || word.text.includes('='))) {
          return { ok: false, problem: `${word.text}: name a read command, nothing else` };
        }
        for (const folder of folders) {
          const words = expand(word, folder);
          if (typeof words === 'string') return { ok: false, problem: words };
          if (word.glob !== undefined && words[0] !== word.text) {
            for (const match of words) {
              const problem = pathProblem(match, [folder], context.reach);
              if (problem) return { ok: false, problem };
            }
          }
          if (folder === folders[0]) argv.push(...words);
        }
      }
      const problem = stageCheck(argv, folders, context);
      if (problem) return { ok: false, problem };
      kinds.add(stageKind(argv));
      stages++;
    }
  }
  if (stages === 0) return { ok: false, problem: 'no command given: cd alone reads nothing' };
  if (kinds.has('network')) return { ok: true, kind: 'network' };
  if (kinds.has('read')) return { ok: true, kind: 'read' };
  return {
    ok: true,
    kind: kinds.size === 1 && parsed.every((p) => p.stages.length === 1) ? 'git' : 'read',
  };
}
