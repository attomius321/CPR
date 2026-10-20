// Every text CPR's agents are told (V28, decisions 165–171): CPR's own as defaults with
// placeholders, a project's under `prompts` in `cpr/config.json`, and the Settings page's view of
// both. A project's prompts are read at each use: a save applies to the next agent started.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  fileGitState,
  PROMPT_KEYS,
  type GitRepo,
  type PromptChange,
  type PromptKey,
  type PromptPlaceholder,
  type PromptSettings,
  type WorkKind,
} from '@cpr/core';
import { applyEdits, modify, type FormattingOptions } from 'jsonc-parser';
import { CONFIG_FILES } from './plugins.js';

/** Each kind's line after the brief (V24), written into its start prompt. */
const KIND_LINES: Partial<Record<WorkKind, string>> = {
  fix:
    'Reproduce it first, with a failing test where the project has tests, then fix the cause, ' +
    'not the symptom.',
  refactor:
    'Change structure, not behaviour: do not change what existing tests assert; if behaviour ' +
    'must change, stop and say so.',
  chore: 'Keep to what is asked; if it needs a change in behaviour, stop and say so.',
  spike:
    'The answer is what is asked for, not a change to merge: put it in your final report; ' +
    "keep experiments out of the project's code unless the brief says otherwise.",
};

/** A kind's start prompt as CPR writes it: what V18 to V27 gave, today's values as placeholders. */
function startPrompt(kind: WorkKind): string {
  const line = KIND_LINES[kind];
  return [
    `You are starting a new ${kind} in this repository, on the branch {branch}, started from ` +
      '{start}. This folder is a git worktree of its own with that branch checked out: work ' +
      'only here.',
    '',
    "The person's brief:",
    '',
    '{brief}',
    '',
    ...(line ? [line, ''] : []),
    '{plan}',
    '',
    kind === 'spike'
      ? 'Commit nothing unless the brief asks for it. When you have the answer, say it: the ' +
        'person reads your report in CPR.'
      : "Commit your work on {branch} as you go. Push only if the project's instructions say " +
        'so. When it is ready, say so: the person reviews the branch in CPR, and an approved ' +
        'commit is merged into {into}.',
    '',
    `This ${kind}'s record: {record}. Reviews of the branch will be in {reviews}; {agents} ` +
      'says how to act on one. Never edit anything in {cpr}.',
  ].join('\n');
}

/**
 * What an agent does with a review (V17): `cpr/AGENTS.md`, written beside the reviews in any
 * repository and rewritten when the text in use differs.
 */
const REVIEWS = `# CPR reviews

Written by CPR, which rewrites this file when it changes: put your project's own rules in its
own CLAUDE.md or AGENTS.md.

A person reviews your branch with CPR and records a verdict in
\`cpr/reviews/<branch>/<reviewer>.json\` (the branch's slashes are folders). Act on it when the
person asks you to (for example "check my review"), not because you came across it.

## Read only the last verdict

- Act on the last entry of \`verdicts\`. \`drafts\`, \`marks\` and the top-level \`summary\` are a
  review in progress, not feedback. No verdicts: there is nothing to act on yet; say so.
- \`head\` is the commit the person reviewed. Commits after it (\`git log <head>..<branch>\`) were
  not part of the review.

## What each verdict asks

- \`request-changes\`: fix each comment in new commits on the branch. Then say, one line per
  comment, what you changed (with the commit) or why you did not.
- \`comment\`: answer each comment; change code only where a comment asks for it.
- \`approve\` with \`into\`: the approved commit \`head\` is to be merged into \`into\`, and CPR
  merges it (its merger: Merge in CPR, or \`cpr merge <branch>\`). Do not merge it yourself
  unless the person asks you to; there is nothing to do.
- \`approve\` without \`into\` (a review of the default branch's unpushed commits): those commits,
  up to \`head\`, may be pushed.
- Push only when and what the project's own instructions say.

## A merge conflict

When CPR says the branch conflicts with \`into\` (before the review, or when it merged):

1. On the branch, merge \`into\` in (\`git merge <into>\`), resolve the conflicts there and
   commit. Never resolve them on \`into\`: the resolution would be code nobody reviewed.
2. Tell the person the branch needs another review.

## Workspaces

A workspace started in CPR is a branch with a worktree of its own and a record in
\`cpr/workspaces/<branch>.json\`: the person's \`brief\`, the \`base\` it started from, and
\`planFirst\`. If you were started on one:

- Work only in its worktree, on its branch.
- With \`planFirst\`, write the plan (what you will change and how you will check it), then stop
  and wait for the person's OK before changing anything.
- Commit on the branch as you go; say when it is ready for review.

## Comments

Each has \`body\` (what to do) and \`symbol\` (\`<path>#<name>\`); on a line, also \`path\`,
\`line\`, \`side\` and \`code\` (that line's text). Without \`line\` it is about the whole symbol.

- \`side: "head"\`: \`line\` is in the reviewed commit \`head\`, not your working copy. If the
  branch moved since, find the place by \`code\` and \`symbol\`.
- \`side: "base"\`: a line the branch removed, at the file's top-level \`base\` (where the review
  starts: \`git show <base>:<path>\`). Usually the question is whether removing it was right.

## Never

- Rewrite commits the person reviewed (amend, rebase, squash): their review is of those commits.
- Edit, move or commit anything in \`cpr/\`: the reviews are the person's.
`;

/** The merger's instructions (decision 150): its system prompt, before the answer format. */
const MERGER = `You resolve merge conflicts for CPR. A person reviews every answer before it lands.

You are given each conflict region in git's diff3 style, with 3 lines around it: the target branch's side (after <<<<<<<), the common ancestor (after |||||||, empty when both sides added), and the merged branch's side (after =======, up to >>>>>>>). Each side's title says what it was for.

For each region, write the text that replaces the whole region, its marker lines included:
- Keep what both sides meant. Two different additions are usually both kept, the target's first, unless they are the same thing written twice: then keep it once.
- Two changes to the same lines: combine them when they can be combined, and keep the file's style.
- Never drop a side's change to make the conflict go away. When both cannot be kept, or you would have to guess what a side meant, do not answer the regions: say what the person must decide.
- Write no conflict markers. Change nothing outside the regions: CPR writes your text in place of each region and nothing else.

You may read files in this folder when a region is not enough. You cannot edit them, and need not.`;

/**
 * The answer the merger is asked for, after its instructions: CPR parses it, so a project cannot
 * change it (decision 169).
 */
export const MERGER_ANSWER = `Answer with one JSON object and nothing else:
{"regions": {"1": "<text of region 1>", "2": "<text of region 2>"}, "notes": {"1": "<one line: what you kept, and why>"}}
or, when any region needs the person:
{"needsYou": "<the region, and what they must decide>"}`;

/** CPR's text for every prompt: the default until a project changes it. */
export const DEFAULT_PROMPTS: Readonly<Record<PromptKey, string>> = {
  'start.feature': startPrompt('feature'),
  'start.fix': startPrompt('fix'),
  'start.refactor': startPrompt('refactor'),
  'start.chore': startPrompt('chore'),
  'start.spike': startPrompt('spike'),
  'plan.first':
    'First write a plan: what you will change and how you will check it, then stop and wait ' +
    "for the person's OK before changing anything.",
  'plan.direct': "Plan it, build it and check it as the project's own instructions say.",
  'verdict.approve':
    'Approved the branch {branch} at {at}: CPR merges {at} into {into}; do not merge it yourself.',
  'verdict.push': 'Approved the unpushed commits of {branch} up to {at}: they may be pushed.',
  'verdict.address': 'Address this review of the branch {branch} ({reviewer}, at {at}): {what}.',
  'verdict.where': 'The review: {review}; how to act on it: {agents}.',
  reviews: REVIEWS.trimEnd(),
  merger: MERGER,
};

/** Where a prompt is shown, what it is for, what it may hold, and how long it may be. */
interface PromptSpec {
  group: string;
  title: string;
  about: string;
  placeholders: PromptPlaceholder[];
  max: number;
  fixed?: string;
}

const START_PLACEHOLDERS: PromptPlaceholder[] = [
  { name: 'branch', about: "the workspace's branch" },
  { name: 'start', about: 'where it starts: "main at abc1234", or "the commit abc1234"' },
  { name: 'brief', about: "the person's brief, as the start dialog made it", required: true },
  { name: 'plan', about: 'Plan first or Plan without, as the person chose' },
  {
    name: 'into',
    about:
      'the default branch, which an approved commit is merged into ("the branch the person ' +
      'picks" when there is none)',
  },
  { name: 'record', about: "the workspace's record, cpr/workspaces/<branch>.json" },
  { name: 'reviews', about: "the folder the branch's reviews will be in" },
  { name: 'agents', about: 'cpr/AGENTS.md, which says how to act on a review' },
  { name: 'cpr', about: 'the cpr/ folder, which the agent must not edit' },
];

/** A start prompt goes on the agent's command line with a brief of up to 20,000 characters. */
const MAX_START = 8_000;
const MAX_LINE = 1_000;
const MAX_TEXT = 20_000;

const start = (title: string): PromptSpec => ({
  group: 'Workspaces',
  title,
  about:
    `What a ${title} workspace's agent is told when it starts: Claude Code's first prompt, ` +
    "Codex's first turn, and what Copy the prompt copies.",
  placeholders: START_PLACEHOLDERS,
  max: MAX_START,
});
const at = { name: 'at', about: 'the reviewed commit, short' };
const branch = { name: 'branch', about: 'the branch reviewed' };

const SPECS: Readonly<Record<PromptKey, PromptSpec>> = {
  'start.feature': start('Feature'),
  'start.fix': start('Fix'),
  'start.refactor': start('Refactor'),
  'start.chore': start('Chore'),
  'start.spike': start('Spike'),
  'plan.first': {
    group: 'Workspaces',
    title: 'Plan first',
    about: 'What {plan} becomes in a start prompt when the person asks for a plan first.',
    placeholders: [],
    max: MAX_LINE,
  },
  'plan.direct': {
    group: 'Workspaces',
    title: 'Plan without',
    about: 'What {plan} becomes in a start prompt otherwise.',
    placeholders: [],
    max: MAX_LINE,
  },
  'verdict.approve': {
    group: 'Reviews',
    title: 'Approved',
    about: "A verdict's first line for the branch's agent: approved, and CPR merges it.",
    placeholders: [branch, at, { name: 'into', about: 'the branch it is merged into' }],
    max: MAX_LINE,
  },
  'verdict.push': {
    group: 'Reviews',
    title: 'Approved to push',
    about: "A verdict's first line: the default branch's unpushed commits approved.",
    placeholders: [branch, at],
    max: MAX_LINE,
  },
  'verdict.address': {
    group: 'Reviews',
    title: 'Changes or comments',
    about: "A verdict's first line when it requests changes or comments; its comments follow.",
    placeholders: [
      branch,
      { name: 'reviewer', about: "the reviewer's git email" },
      at,
      { name: 'what', about: '"changes requested" or "comments"' },
    ],
    max: MAX_LINE,
  },
  'verdict.where': {
    group: 'Reviews',
    title: 'Where the review is',
    about: "A verdict's last line.",
    placeholders: [
      { name: 'review', about: "the review's file" },
      { name: 'agents', about: 'cpr/AGENTS.md' },
    ],
    max: MAX_LINE,
  },
  reviews: {
    group: 'Reviews',
    title: 'cpr/AGENTS.md',
    about:
      'How any agent acts on a review. CPR writes it into cpr/AGENTS.md beside the reviews, ' +
      'and rewrites the file when it differs.',
    placeholders: [],
    max: MAX_TEXT,
  },
  merger: {
    group: 'Merger',
    title: 'Instructions',
    about:
      "The merger's system prompt, for every conflict; the conflict, the sides' titles and " +
      'cpr/merge.md follow in its prompt.',
    placeholders: [],
    max: MAX_TEXT,
    fixed: MERGER_ANSWER,
  },
};

/** `text` with each `{name}` of `values` replaced in one pass: a value's own braces stay text. */
export function fillPrompt(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? match) : match,
  );
}

/** The prompts in use (V28), from the project's config. */
export interface ProjectPrompts {
  /** The config file, repo-relative: the one read, or `cpr/config.json` when there is none. */
  file: string;
  /** Its text; null when there is no file. */
  source: string | null;
  /** A hash of `source`: a change names it, and is refused when the file changed since. */
  version: string;
  text: Record<PromptKey, string>;
  /** The keys whose project text is in use. */
  changed: Set<PromptKey>;
  /** Why a key's value in the file is not used. */
  warnings: Partial<Record<PromptKey, string>>;
  /** Why none is: the file is not JSON. */
  warning?: string;
}

/** Line ends as `\n`, no blank end: how a prompt is kept and compared. */
const normalized = (text: string) => text.replace(/\r\n?/g, '\n').trimEnd();

/** Why `text` cannot be `key`'s prompt, or null. */
function problemOf(key: PromptKey, text: string): string | null {
  const { max, placeholders } = SPECS[key];
  if (text.length > max) return `is longer than ${max.toLocaleString('en-US')} characters`;
  const missing = placeholders.find((p) => p.required && !text.includes(`{${p.name}}`));
  if (missing) return `has no {${missing.name}}: its agent would not be given ${missing.about}`;
  return null;
}

/** The value at `prompts.<key>`, as given. */
function valueAt(prompts: unknown, key: PromptKey): unknown {
  let value = prompts;
  for (const part of key.split('.')) {
    value =
      value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  }
  return value;
}

/** `prompts` from `cpr/config.json` (else `cpr.config.json`) at `root`, each checked (V28). */
export function readPrompts(root: string): ProjectPrompts {
  const found = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  let source: string | null = null;
  if (found) {
    try {
      source = readFileSync(join(root, found), 'utf8');
    } catch {
      source = null;
    }
  }
  const file = found ?? CONFIG_FILES[0];
  const text = { ...DEFAULT_PROMPTS };
  const read: ProjectPrompts = {
    file,
    source,
    version:
      source === null ? 'none' : createHash('sha256').update(source).digest('hex').slice(0, 16),
    text,
    changed: new Set(),
    warnings: {},
  };
  if (source === null) return read;
  let prompts: unknown;
  try {
    prompts = (JSON.parse(source) as { prompts?: unknown } | null)?.prompts;
  } catch {
    return { ...read, warning: `${file} is not JSON: CPR's prompts are used` };
  }
  for (const key of PROMPT_KEYS) {
    const value = valueAt(prompts, key);
    if (value === undefined) continue;
    const given =
      typeof value === 'string'
        ? value
        : Array.isArray(value) && value.every((line) => typeof line === 'string')
          ? value.join('\n')
          : null;
    const problem =
      given === null
        ? 'is not text (a string, or a list of lines)'
        : problemOf(key, normalized(given));
    if (given === null || problem) {
      read.warnings[key] = `prompts.${key} ${problem}: CPR's is used`;
      continue;
    }
    text[key] = normalized(given);
    read.changed.add(key);
  }
  return read;
}

/** A change the Settings page cannot make: its status and why. */
export class PromptRefused extends Error {
  override name = 'PromptRefused';
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
  }
}

/** The file's own indentation and line ends, for what is written into it. */
function formatting(source: string): FormattingOptions {
  const indent = /\n([ \t]+)"/.exec(source)?.[1] ?? '  ';
  return {
    insertSpaces: !indent.startsWith('\t'),
    tabSize: indent.startsWith('\t') ? 1 : indent.length,
    eol: source.includes('\r\n') ? '\r\n' : '\n',
  };
}

/** One write at a time: each reads the file it changes. */
let writing: Promise<unknown> = Promise.resolve();

/**
 * Sets `key`'s prompt in the project's config, or removes it (`null`, or CPR's own text), with
 * the rest of the file as it was (decision 167); an emptied section is removed with it.
 */
export function writePrompt(root: string, change: PromptChange): Promise<void> {
  const next = writing.then(() => write(root, change));
  writing = next.catch(() => undefined);
  return next;
}

async function write(root: string, change: PromptChange): Promise<void> {
  const { key } = change;
  if (!PROMPT_KEYS.includes(key)) throw new PromptRefused(`not a prompt: ${String(key)}`, 400);
  const current = readPrompts(root);
  if (current.version !== change.version) {
    throw new PromptRefused(`${current.file} changed since you opened it: open it again`, 409);
  }
  if (current.warning) throw new PromptRefused(`${current.file} is not JSON: fix it first`, 409);
  const text = change.text === null ? null : normalized(change.text);
  const problem = text === null ? null : problemOf(key, text);
  if (problem) throw new PromptRefused(`prompts.${key} ${problem}`, 400);
  // A one-line prompt is a string, a longer one its lines (decision 168).
  const value =
    text === null || text === DEFAULT_PROMPTS[key]
      ? undefined
      : text.includes('\n')
        ? text.split('\n')
        : text;
  const before = current.source ?? '{}\n';
  const options = { formattingOptions: formatting(before) };
  const path = ['prompts', ...key.split('.')];
  let after = applyEdits(before, modify(before, path, value, options));
  // A section left empty goes too: `prompts.start`, then `prompts`.
  for (let end = path.length - 1; value === undefined && end > 0; end--) {
    const section = path.slice(0, end);
    const left = section.reduce<unknown>(
      (object, part) => (object as Record<string, unknown> | undefined)?.[part],
      JSON.parse(after),
    );
    if (!left || typeof left !== 'object' || Object.keys(left).length > 0) break;
    after = applyEdits(after, modify(after, section, undefined, options));
  }
  if (after === before) return;
  await mkdir(dirname(join(root, current.file)), { recursive: true });
  await writeFile(join(root, current.file), after);
}

/** The Settings page's prompts (`/api/settings/prompts`). */
export interface PromptSettingsService {
  prompts(): Promise<PromptSettings>;
  /** Saves a change, and answers the prompts as they are after it. */
  setPrompt(change: PromptChange): Promise<PromptSettings>;
}

/** The prompts of `repo`'s checkout, as the Settings page shows and changes them (V28). */
export function promptSettingsService(repo: GitRepo): PromptSettingsService {
  const settings = async (): Promise<PromptSettings> => {
    const read = readPrompts(repo.root);
    return {
      file: read.file,
      version: read.version,
      git: await fileGitState(repo, read.file),
      ...(read.warning ? { warning: read.warning } : {}),
      prompts: PROMPT_KEYS.map((key) => {
        const { fixed, ...spec } = SPECS[key];
        const warning = read.warnings[key];
        return {
          key,
          ...spec,
          text: read.text[key],
          default: DEFAULT_PROMPTS[key],
          changed: read.changed.has(key),
          ...(warning ? { warning } : {}),
          ...(fixed ? { fixed } : {}),
        };
      }),
    };
  };
  return {
    prompts: settings,
    async setPrompt(change) {
      await writePrompt(repo.root, change);
      return settings();
    },
  };
}

/** `POST /api/settings/prompts`'s body, checked: throws with what is wrong. */
export function parsePromptChange(body: string): PromptChange {
  const value = JSON.parse(body) as unknown;
  if (!value || typeof value !== 'object') throw new Error('a change: { key, text, version }');
  const { key, text, version } = value as Record<string, unknown>;
  if (typeof key !== 'string' || !PROMPT_KEYS.includes(key as PromptKey)) {
    throw new Error(`key: one of ${PROMPT_KEYS.join(', ')}`);
  }
  if (text !== null && typeof text !== 'string') {
    throw new Error("text: the prompt, or null for CPR's");
  }
  if (typeof version !== 'string') throw new Error('version: as the prompts were read');
  return { key: key as PromptKey, text, version };
}
