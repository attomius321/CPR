// What each of an agent's calls is (V73, decision 515): by its tool, a command by its programs, an
// edit by its file's place — never by a guess at what the agent meant. A command is also written
// short here for the timeline: its whole text stays in its details.
import type { ActivityEntry } from '@symbiote/core';

/**
 * The work a call is part of: exploring, implementing (code) or documenting (Markdown and text),
 * testing (tests, checks, builds), looking at screenshots, or git's writes. A call that is none
 * (a task's update, a scratch file, a wait) takes its neighbours' phase.
 */
export type WorkKind = 'explore' | 'implement' | 'docs' | 'test' | 'visual' | 'git';

export const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const DOC = /\.(md|mdx|markdown|txt|rst|adoc)$/i;

const EXPLORE_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'WebFetch',
  'WebSearch',
  'webSearch',
  'Task',
  'Agent',
]);
export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'fileChange']);
export const COMMAND_TOOLS = new Set(['Bash', 'command']);

/** Git's commands that change the repository; the rest read it. */
const GIT_WRITES = new Set([
  'add',
  'commit',
  'push',
  'pull',
  'merge',
  'rebase',
  'checkout',
  'switch',
  'stash',
  'tag',
  'reset',
  'restore',
  'rm',
  'mv',
  'cherry-pick',
  'revert',
  'am',
  'apply',
  'worktree',
  'branch',
]);
/** Git's commands that make a commit. */
const GIT_COMMITS = new Set(['commit', 'merge', 'cherry-pick', 'revert']);

/** Programs that test, check or build: run by themselves. */
const TEST_PROGRAMS = new Set([
  'vitest',
  'jest',
  'mocha',
  'ava',
  'tsc',
  'eslint',
  'stylelint',
  'pytest',
  'tox',
  'phpunit',
  'rspec',
]);
/** A package script that tests, checks or builds: `pnpm check`, `npm test`, `pnpm test:e2e`. */
const TEST_SCRIPT =
  /^(test|tests|check|lint|typecheck|type-check|build|e2e|verify|ci)(?:[:-]|$)|:check$/;
/** Scripts and programs that are none of the phases: installing, formatting, waiting. */
const NOTHING = new Set([
  'sleep',
  'wait',
  'until',
  'while',
  'cd',
  'export',
  'true',
  ':',
  'kill',
  'pkill',
  'set',
  'source',
]);
const INSTALL = /^(install|i|add|remove|update|up|ci|dlx|format)$/;

const SCREENSHOT = /\bscreenshots?\b|\bscreen shots?\b|\bshots?\b/i;

/** A path outside the worktree: absolute, the home's, a variable's. */
export const outside = (path: string): boolean => /^(\/|~|\$|[A-Za-z]:[\\/]|\\\\)/.test(path);

/** A command without its here-documents' bodies and its quoted strings' contents. */
function bare(command: string): string {
  const kept: string[] = [];
  let until: string | null = null;
  for (const line of command.split('\n')) {
    if (until !== null) {
      if (line.trim() === until) until = null;
      continue;
    }
    kept.push(line);
    const here = /<<-?\s*['"]?(\w+)['"]?/.exec(line);
    if (here?.[1]) until = here[1];
  }
  return kept
    .join('\n')
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

/** A command's simple commands: split at `&&`, `||`, `;`, pipes, new lines and parentheses. */
function segments(command: string): string[][] {
  return bare(command)
    .split(/&&|\|\||[;|\n()`]|\$\(/)
    .map((segment) => words(segment))
    .filter((tokens) => tokens.length > 0);
}

/** A simple command's words, without what only sets how it runs (variables, `env`, `timeout`). */
function words(segment: string): string[] {
  const tokens = segment
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '');
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i] ?? '';
    if (/^\w+=/.test(token)) i += 1;
    else if (token === 'env') {
      i += 1;
      while (tokens[i]?.startsWith('-') || /^\w+=/.test(tokens[i] ?? '')) {
        i += tokens[i] === '-u' ? 2 : 1;
      }
    } else if (token === 'timeout') i += 2;
    else if (['time', 'nice', 'exec', 'command', 'noglob'].includes(token)) i += 1;
    else break;
  }
  return tokens.slice(i);
}

/** Git's subcommand in a simple command: past `-C <dir>`, `-c <x=y>` and other options. */
function gitVerb(tokens: string[]): string | null {
  if (tokens[0] !== 'git') return null;
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    if (token === '-C' || token === '-c') i += 1;
    else if (!token.startsWith('-')) return token;
  }
  return null;
}

/** The program a package runner runs, and its first word: `npx vitest` → `vitest`. */
function runThrough(tokens: string[]): string[] {
  let rest = tokens;
  if (rest[0] === 'npx' || rest[0] === 'bunx') rest = rest.slice(1);
  else if (
    ['pnpm', 'npm', 'yarn'].includes(rest[0] ?? '') &&
    ['exec', 'dlx', 'x'].includes(rest[1] ?? '')
  ) {
    rest = rest.slice(2);
  }
  while (rest[0]?.startsWith('-')) rest = rest.slice(1);
  const program = rest[0]?.replace(/^.*node_modules\/\.bin\//, '');
  return program ? [program, ...rest.slice(1)] : [];
}

/** The script a package manager runs: `pnpm check`, `pnpm --filter x test`, `npm run build`. */
function scriptOf(tokens: string[]): string | null {
  if (!['pnpm', 'npm', 'yarn', 'bun'].includes(tokens[0] ?? '')) return null;
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    if (['--filter', '-F', '--dir', '-C', '--prefix', '-w'].includes(token)) i += 1;
    else if (token === 'run' || token.startsWith('-')) continue;
    else return token;
  }
  return null;
}

/** Where a simple command writes a file, when it is one that writes: its target's path. */
function writes(tokens: string[]): string | null {
  const program = tokens[0] ?? '';
  const redirect = tokens.findIndex((t) => t === '>' || t === '>>' || /^>>?[^>&]/.test(t));
  if (['cat', 'echo', 'printf', 'tee'].includes(program)) {
    if (program === 'tee') return tokens.find((t, i) => i > 0 && !t.startsWith('-')) ?? null;
    if (redirect < 0) return null;
    const token = tokens[redirect] ?? '';
    return token.length > 2 && token !== '>>'
      ? token.replace(/^>>?/, '')
      : (tokens[redirect + 1] ?? null);
  }
  if (program === 'sed' && tokens.some((t) => /^-i/.test(t) || t === '--in-place')) {
    return tokens.at(-1) ?? null;
  }
  if (program === 'perl' && tokens.some((t) => /^-p?i/.test(t))) return tokens.at(-1) ?? null;
  if (['mv', 'cp', 'rm', 'mkdir', 'touch', 'patch', 'ln'].includes(program)) {
    return tokens.at(-1) ?? null;
  }
  return null;
}

/** One simple command's kind; null for one that is none of them. */
function segmentKind(tokens: string[]): WorkKind | null {
  const verb = gitVerb(tokens);
  if (verb) return GIT_WRITES.has(verb) ? 'git' : 'explore';
  if (tokens[0] === 'gh') return ['pr', 'release'].includes(tokens[1] ?? '') ? 'git' : 'explore';
  const line = tokens.join(' ');
  const [program, first] = runThrough(tokens);
  if (program === 'playwright') return first === 'test' ? 'test' : 'visual';
  if (program === 'prettier') {
    return tokens.some((t) => ['--check', '-c', '--list-different', '-l'].includes(t))
      ? 'test'
      : null;
  }
  if (program && TEST_PROGRAMS.has(program)) return 'test';
  const script = scriptOf(tokens);
  if (script !== null) {
    if (TEST_SCRIPT.test(script)) return 'test';
    if (INSTALL.test(script) || script.startsWith('format')) return null;
  }
  if (['cargo', 'go', 'make', 'dotnet', 'mvn', 'gradle', './gradlew'].includes(tokens[0] ?? '')) {
    if (/^(test|build|check|clippy|vet|nextest|lint|verify)$/.test(tokens[1] ?? '')) return 'test';
  }
  if (
    /^python[\d.]*$/.test(tokens[0] ?? '') &&
    tokens[1] === '-m' &&
    /^(pytest|unittest)$/.test(tokens[2] ?? '')
  ) {
    return 'test';
  }
  if (tokens[0] === 'node' && tokens.includes('--test')) return 'test';
  if (SCREENSHOT.test(line) || tokens.some((t) => IMAGE.test(t))) return 'visual';
  const target = writes(tokens);
  if (target !== null) return outside(target) ? null : 'implement';
  if (NOTHING.has(tokens[0] ?? '') || script !== null) return null;
  return 'explore';
}

/** Which is said when a command does several: a commit over its check, a check over its reads. */
const ORDER: (WorkKind | null)[] = ['git', 'test', 'visual', 'implement', 'explore', null];

/**
 * What a command is (V73): its strongest simple command's kind — git's writes, then tests and
 * checks, screenshots, edits in the worktree, reads. `about`, the agent's own words for it, says
 * a screenshot the command does not.
 */
export function commandKind(command: string, about?: string): WorkKind | null {
  let best: WorkKind | null = null;
  for (const tokens of segments(command)) {
    const kind = segmentKind(tokens);
    if (ORDER.indexOf(kind) < ORDER.indexOf(best)) best = kind;
  }
  if ((best === 'explore' || best === null) && about && SCREENSHOT.test(about)) return 'visual';
  return best;
}

/** Whether a command makes a commit: `git commit`, a merge, a cherry-pick, a revert. */
export function isCommitCommand(command: string): boolean {
  return segments(command).some((tokens) => GIT_COMMITS.has(gitVerb(tokens) ?? ''));
}

/** Git's writes in a command, in order, once each: `add`, `commit`, `push`. */
export function gitVerbs(command: string): string[] {
  const verbs: string[] = [];
  for (const tokens of segments(command)) {
    const verb = gitVerb(tokens);
    if (verb && GIT_WRITES.has(verb) && !verbs.includes(verb)) verbs.push(verb);
  }
  return verbs;
}

/** The paths an edit's subject names: one, or Codex's changes joined by ", ". */
export const editPaths = (tool: string, subject: string | undefined): string[] =>
  !subject ? [] : tool === 'fileChange' ? subject.split(', ') : [subject];

/** What a call is (V73); null for one that is none of the phases. */
export function callKind(
  call: Pick<ActivityEntry, 'tool' | 'subject' | 'input' | 'about'>,
): WorkKind | null {
  const { tool, subject, input, about } = call;
  if (COMMAND_TOOLS.has(tool)) return commandKind(input ?? subject ?? '', about);
  if (EDIT_TOOLS.has(tool)) {
    const paths = editPaths(tool, subject);
    if (paths.length === 0) return 'implement';
    const inside = paths.filter((path) => !outside(path));
    if (inside.length === 0) return null;
    return inside.every((path) => DOC.test(path)) ? 'docs' : 'implement';
  }
  if (tool === 'Read' && subject && IMAGE.test(subject)) return 'visual';
  if (EXPLORE_TOOLS.has(tool)) return 'explore';
  return null;
}

/** The home folder a worktree is in (`/home/ada`, `/Users/ada`), to write paths in it with `~`. */
function homeOf(worktree: string): string | null {
  return /^(\/home\/[^/]+|\/Users\/[^/]+|\/root)(?=\/|$)/.exec(worktree)?.[1] ?? null;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Paths in a text written short: the worktree's from it ("."), the home's from "~". */
function shortPaths(text: string, worktree: string): string {
  let shown = text;
  if (worktree !== '') {
    shown = shown.replace(new RegExp(`${escaped(worktree)}/`, 'g'), '');
    shown = shown.replace(new RegExp(`${escaped(worktree)}(?![\\w.-])`, 'g'), '.');
  }
  const home = homeOf(worktree);
  if (home) shown = shown.replace(new RegExp(`${escaped(home)}(?=/|(?![\\w.-]))`, 'g'), '~');
  return shown;
}

/**
 * A command as the timeline shows it (V73): without a leading `cd` to an absolute folder (where it
 * runs, not what it does), the worktree's paths from it and the home's from `~`. Its whole text
 * stays in its details.
 */
export function shownCommand(command: string, worktree: string): string {
  let shown = command.trim();
  const cd = /^cd\s+(?:"[/~][^"]*"|'[/~][^']*'|[/~]\S*)\s*(?:&&|;)\s*/;
  while (cd.test(shown)) shown = shown.replace(cd, '');
  return shortPaths(shown, worktree);
}

/** A path as the timeline shows it: inside the worktree from it, in the home from `~`. */
export function shortPath(path: string, worktree: string): string {
  if (worktree !== '' && path.startsWith(`${worktree}/`)) return path.slice(worktree.length + 1);
  return shortPaths(path, worktree);
}

/** Redirections a summary leaves out: `2>&1`, `>/dev/null`, `> out.txt`. */
const REDIRECT = /^(\d?>>?&?\d*|\d?>>?\S+|&>\S*)$/;

/**
 * The test a command runs, as a phase's summary says it (V73): its first simple command that
 * tests, checks or builds, without what only routes its output — `pnpm check`, not `cd … &&
 * pnpm check 2>&1 | tail -20`. Null when none does.
 */
export function testCommand(command: string): string | null {
  for (const tokens of segments(command)) {
    if (segmentKind(tokens) !== 'test') continue;
    const kept: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] ?? '';
      // A redirection to the next word: both left out.
      if (/^(\d|&)?>>?$/.test(token)) {
        i += 1;
        continue;
      }
      if (REDIRECT.test(token)) continue;
      // A quoted word, emptied to classify: left out, with the option it was given to.
      if (token === "''" || token === '""') {
        if (kept.at(-1)?.startsWith('-')) kept.pop();
        continue;
      }
      kept.push(token);
    }
    return kept.join(' ');
  }
  return null;
}
