// The Settings page's view of each prompt (V28b): its title, what it is for, its placeholders and
// their examples, its limits.
import { NUCLEUS_NAMES, type PromptKey, type PromptPlaceholder } from '@symbiote/core';
import { HIVE_REVIEW_ANSWER, MERGER_ANSWER, nucleusAbout } from './prompt-text.js';

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
  { name: 'worktree', about: "the workspace's worktree, the folder its agent starts in" },
  { name: 'start', about: 'where it starts: "main at abc1234", or "the commit abc1234"' },
  { name: 'brief', about: "the person's brief, as the start page made it", required: true },
  { name: 'plan', about: 'Plan first or Plan without, as the person chose' },
  {
    name: 'documents',
    about:
      'Documents, when the person gave files with the brief; else its line goes (added at the ' +
      'end when a prompt leaves it out)',
  },
  {
    name: 'into',
    about:
      'the default branch, which an approved commit is merged into ("the branch the person ' +
      'picks" when there is none)',
  },
  { name: 'record', about: "the workspace's record, symbiote/workspaces/<branch>.json" },
  { name: 'reviews', about: "the folder the branch's reviews will be in" },
  { name: 'agents', about: 'symbiote/AGENTS.md, which says how to act on a review' },
  { name: 'symbiote', about: 'the symbiote/ folder, which the agent must not edit' },
  {
    name: 'hive',
    about:
      'Hive, for a workspace Hive drives; else its line goes (added at the end when a prompt ' +
      'leaves it out)',
  },
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

export const SPECS: Readonly<Record<PromptKey, PromptSpec>> = {
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
  documents: {
    group: 'Workspaces',
    title: 'Documents',
    about:
      'What {documents} becomes in a start prompt when the person gave files with the brief, ' +
      "kept beside the workspace's record; added after a start prompt without {documents}.",
    placeholders: [
      {
        name: 'folder',
        about: 'the folder holding them, symbiote/documents/<branch>/',
        required: true,
      },
      { name: 'files', about: 'their names, one per line' },
    ],
    max: MAX_LINE,
  },
  'verdict.approve': {
    group: 'Reviews',
    title: 'Approved',
    about: "A verdict's first line for the branch's agent: approved, and Symbiote merges it.",
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
      { name: 'agents', about: 'symbiote/AGENTS.md' },
    ],
    max: MAX_LINE,
  },
  reviews: {
    group: 'Reviews',
    title: 'symbiote/AGENTS.md',
    about:
      'How any agent acts on a review. Symbiote writes it into symbiote/AGENTS.md beside the reviews, ' +
      'and rewrites the file when it differs.',
    placeholders: [],
    max: MAX_TEXT,
  },
  merger: {
    group: 'Merger',
    title: 'Instructions',
    about:
      "The merger's system prompt, for every conflict; the conflict, the sides' titles and " +
      'symbiote/merge.md follow in its prompt.',
    placeholders: [],
    max: MAX_TEXT,
    fixed: MERGER_ANSWER,
  },
  'merge.failed': {
    group: 'Merger',
    title: 'Check failed',
    about:
      "What Send to the agent types into a branch's workspace when its merge's check failed: " +
      'the command, its last lines, and what the agent is asked.',
    placeholders: [
      { name: 'output', about: "the last lines of the check's output", required: true },
      { name: 'command', about: 'the command that failed' },
      { name: 'branch', about: 'the branch merged' },
      { name: 'at', about: 'the approved commit merged, short' },
      { name: 'into', about: 'the branch it was merged into' },
    ],
    max: MAX_LINE,
  },
  nucleus: {
    group: 'Nucleus',
    title: 'Instructions',
    about: nucleusAbout(NUCLEUS_NAMES.off),
    placeholders: [
      { name: 'name', about: 'its name: Nucleus, or Alpha Ceph while Hive mode is on' },
    ],
    max: MAX_START,
  },
  scribe: {
    group: 'Scribe',
    title: 'Instructions',
    about:
      "Scribe's system prompt, from a conversation's start: appended to Claude Code's, Codex's " +
      "developer instructions. The person's words follow, in its terminal. It writes only skills, " +
      'in .claude/skills and the skill library, whatever it says.',
    placeholders: [
      { name: 'skills', about: 'the skills folder, .claude/skills in the checkout' },
      { name: 'checkout', about: 'the checkout Scribe works in' },
      {
        name: 'library',
        about: 'the prompt Library when a skill library is set; else its line goes',
      },
    ],
    max: MAX_START,
  },
  library: {
    group: 'Scribe',
    title: 'Library',
    about:
      "What {library} becomes in Scribe's instructions when the person keeps a skill library " +
      '(Settings, Skill library): where it is, and what a skill there holds.',
    placeholders: [
      { name: 'folder', about: "the library's folder", required: true },
      { name: 'skills', about: 'the skills folder, .claude/skills in the checkout' },
    ],
    max: MAX_LINE,
  },
  advisor: {
    group: 'Workspaces',
    title: 'Suggest settings',
    about:
      "What the advisor is told when Suggest settings is pressed on the Start page: Claude Code's " +
      "system prompt, Codex's instructions. The brief follows as its message. Its answer's shape " +
      "is Symbiote's: one of the agent's models, a level, plan first and why.",
    placeholders: [
      { name: 'models', about: "the agent's models, each with its levels", required: true },
      { name: 'agent', about: "the agent's name, Claude Code or Codex" },
    ],
    max: MAX_START,
  },
  'hive.classify': {
    group: 'Hive',
    title: 'Classifier',
    about:
      "The classifier's system prompt: how it takes, asks or refuses an issue and writes the brief " +
      "a writer gets. The project's card and the issue follow as its message; its answer's shape " +
      "and Symbiote's rules around it are Symbiote's.",
    placeholders: [],
    max: MAX_TEXT,
  },
  'hive.start': {
    group: 'Hive',
    title: 'Start',
    about:
      'What {hive} becomes in a start prompt when Hive drives the workspace; added after a start ' +
      'prompt without {hive}.',
    placeholders: [
      { name: 'check', about: 'the check Symbiote runs: its commands, or that none is set' },
      { name: 'rounds', about: 'how many rounds before Hive stops for the person: 3' },
    ],
    max: MAX_LINE,
  },
  'hive.check': {
    group: 'Hive',
    title: 'Check failed',
    about: "What Hive sends the writer when the check fails on its branch's tip.",
    placeholders: [
      { name: 'output', about: "the last lines of the check's output", required: true },
      { name: 'command', about: 'the command that failed' },
      { name: 'branch', about: "the workspace's branch" },
      { name: 'at', about: 'the commit checked, short' },
      { name: 'round', about: "the writer's round" },
      { name: 'rounds', about: 'how many rounds before Hive stops for the person' },
    ],
    max: MAX_LINE,
  },
  'hive.commit': {
    group: 'Hive',
    title: 'Not committed',
    about:
      'What Hive sends the writer when it ended a turn with files not committed, or with no ' +
      'commit on the branch.',
    placeholders: [
      { name: 'what', about: '"3 files not committed: a.ts, b.ts, c.ts" or "no commit"' },
      { name: 'branch', about: "the workspace's branch" },
    ],
    max: MAX_LINE,
  },
  'hive.resume': {
    group: 'Hive',
    title: 'Resume',
    about: 'What Hive sends a writer it stopped mid-turn when Hive was turned off, once it is on.',
    placeholders: [],
    max: MAX_LINE,
  },
  'hive.land': {
    group: 'Hive',
    title: 'Landing failed',
    about:
      'What Hive sends the writer when a landing failed: a conflict with the branch it lands in, ' +
      'the check failing on the merge, or that branch moved past a fast-forward.',
    placeholders: [
      {
        name: 'why',
        about: 'what failed: the files, or the command and its last lines',
        required: true,
      },
      { name: 'branch', about: "the workspace's branch" },
      { name: 'at', about: 'the commit Hive tried to land, short' },
      { name: 'into', about: 'the branch it lands in: the one the workspace started from' },
      { name: 'merge', about: 'which time Hive asks this' },
      { name: 'merges', about: 'how many times Hive asks before it stops: 2' },
    ],
    max: MAX_LINE,
  },
  'hive.plan': {
    group: 'Hive',
    title: 'Plan OK',
    about: "Hive's OK to a plan a writer wrote first, in place of the person's.",
    placeholders: [],
    max: MAX_LINE,
  },
  'hive.decide': {
    group: 'Hive',
    title: 'No one to ask',
    about: 'What Hive sends a writer that asks the person a question or for a permission.',
    placeholders: [],
    max: MAX_LINE,
  },
  'hive.review': {
    group: 'Hive',
    title: 'Defects proven',
    about:
      "What Hive sends the writer when its running reviewer proved defects: each kept finding's " +
      "defect, its test's command and files, and the last lines of Symbiote's rerun.",
    placeholders: [
      {
        name: 'findings',
        about: "each kept finding: its defect, test, command, files and the rerun's last lines",
        required: true,
      },
      { name: 'count', about: 'how many defects: "1 defect", "2 defects"' },
      { name: 'branch', about: "the workspace's branch" },
      { name: 'at', about: 'the commit reviewed, short' },
      { name: 'round', about: "the writer's round" },
      { name: 'rounds', about: 'how many rounds before Hive stops for the person' },
      { name: 'folder', about: "where the tests are kept, beside Hive's record" },
    ],
    max: MAX_LINE,
  },
  'hive.reviewer': {
    group: 'Hive',
    title: 'Reviewer',
    about:
      "The running reviewer's system prompt, appended to Claude Code's; the brief, the change and " +
      "the check's result follow in its prompt.",
    placeholders: [],
    max: MAX_TEXT,
    fixed: HIVE_REVIEW_ANSWER,
  },
  'hive.nucleus': {
    group: 'Hive',
    title: 'Alpha Ceph',
    about:
      "What Alpha Ceph is told of Hive, at its instructions' end while Hive mode is on: given to " +
      'each conversation that starts as Alpha Ceph.',
    placeholders: [
      { name: 'rounds', about: 'how many rounds before Hive stops for the person: 3' },
    ],
    max: MAX_START,
  },
};
