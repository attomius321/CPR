// What Symbiote posts on an issue at each step (HV11, decisions 1019, 1020, 1072, 1076): its fixed
// sentences filled with its own values (a branch, a commit, a link), the step's label, the
// closing. The classifier's question is the one text an agent wrote that is posted, cleaned and
// cut. The step's values are all an answer is made from: never the reasons, the brief, the
// writer's report or the issue's words.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClassifierRefusal, IssueRecord } from '@symbiote/core';
import type { ForgeKind, NewLabel } from '@symbiote/forge';
import { HIVE_STOPS, type HiveStopKind } from './hive-record.js';
import { CONFIG_FILES } from './plugins.js';

export const STOP_KINDS = HIVE_STOPS;

/** A step Symbiote answers on the issue, with the values its sentence is filled with. */
export type AnswerStep =
  | { step: 'taken'; branch: string }
  | {
      step: 'asked';
      /** The snapshot's hash: one answer a classification of the issue's text. */
      hash: string;
      /** The question cleaned and cut; null when it is not posted, `held` says why. */
      question: string | null;
      held?: 'personal' | 'empty';
    }
  | { step: 'refused'; hash: string; refusal: ClassifierRefusal | 'none' }
  | { step: 'request'; number: number; url: string }
  | { step: 'landed'; branch: string; via: 'queue'; into: string; sha: string }
  | { step: 'landed'; branch: string; via: 'request'; into: string; number: number }
  | { step: 'stopped'; branch: string; stop: HiveStopKind; at: string };

/** The labels of the steps, by role. */
export interface AnswerLabels {
  working: NewLabel;
  question: NewLabel;
  declined: NewLabel;
  stopped: NewLabel;
}

/** The labels Symbiote makes, renamable in `hive.issues.labels` (decision 1018). */
export const ANSWER_LABELS: AnswerLabels = {
  working: {
    name: 'symbiote: working',
    color: '#6e56cf',
    description: "Symbiote's Hive is working on this",
  },
  question: {
    name: 'symbiote: question',
    color: '#d4a72c',
    description: 'Symbiote needs an answer before it can work on this',
  },
  declined: {
    name: 'symbiote: declined',
    color: '#8b949e',
    description: 'Symbiote will not work on this',
  },
  stopped: {
    name: 'symbiote: stopped',
    color: '#cf222e',
    description: 'Symbiote stopped work on this',
  },
};

const ROLES = ['working', 'question', 'declined', 'stopped'] as const;

/** What one step writes: a comment or none, the labels, the closing. */
export interface Answer {
  comment?: string;
  add: NewLabel[];
  remove: string[];
  /**
   * `completed`: Symbiote closes it. `after-request`: the forge closes it through `Closes #n`;
   * Symbiote closes it a request poll after the merge if it is still open (decision 1074).
   */
  close?: 'completed' | 'after-request';
}

/** The most of a question posted, its ellipsis counted (decision 1019). */
export const MAX_QUESTION = 500;

/** A step's key: one answer a step (decision 1022). */
export function answerKey(step: AnswerStep): string {
  switch (step.step) {
    case 'taken':
    case 'landed':
      return `${step.step}:${step.branch}`;
    case 'asked':
    case 'refused':
      return `${step.step}:${step.hash}`;
    case 'request':
      return `request:${step.number}`;
    case 'stopped':
      return `stopped:${step.branch}:${step.at}`;
  }
}

const REFUSALS: Record<ClassifierRefusal | 'none', string> = {
  'not-a-change': 'it does not ask for a change to the code',
  'out-of-scope': "it is outside what this project's maintainers set Symbiote to take on",
  'too-large': 'it is too large for one change',
  unsafe: 'it asks for something Symbiote does not do on its own',
  none: 'it is not one Symbiote takes on',
};

const STOPS: Record<HiveStopKind, (request: string) => string> = {
  rounds: () => 'its rounds of checks and reviews ran out',
  budget: () => 'it reached its budget',
  asked: () => 'the writer asked for a person too often',
  failed: () => 'the writer failed twice',
  'request-closed': (request) => `its ${request} was closed without a merge`,
  landing: () => 'the change could not be landed',
  unseen: () => "the writer's work could not be followed",
  sandbox: () => 'the writer needed a host it may not reach',
};

/** A value quoted as code: no backtick can end the quote. */
const code = (value: string) => `\`${value.replace(/`/g, '')}\``;

/** The step's comment, labels and closing (decision 1020). */
export function answerOf(step: AnswerStep, labels: AnswerLabels, forge: ForgeKind): Answer {
  const request = forge === 'github' ? 'pull request' : 'merge request';
  /** The role's label added, the other three removed. */
  const only = (role: (typeof ROLES)[number]) => ({
    add: [labels[role]],
    remove: ROLES.filter((r) => r !== role).map((r) => labels[r].name),
  });
  switch (step.step) {
    case 'taken':
      return {
        comment: `Symbiote's Hive is working on this in ${code(step.branch)}.`,
        ...only('working'),
      };
    case 'asked':
      return {
        ...(step.question
          ? { comment: `Before Symbiote can work on this, it needs an answer: ${step.question}` }
          : {}),
        ...only('question'),
      };
    case 'refused':
      return {
        comment: `Symbiote will not work on this: ${REFUSALS[step.refusal] ?? REFUSALS.none}.`,
        ...only('declined'),
      };
    case 'request':
      return { comment: `A ${request} is open: ${step.url}.`, add: [], remove: [] };
    case 'landed': {
      const remove = ROLES.map((r) => labels[r].name);
      if (step.via === 'request') return { add: [], remove, close: 'after-request' };
      return {
        comment: `Landed in ${code(step.into)} at ${step.sha.slice(0, 7)}.`,
        add: [],
        remove,
        close: 'completed',
      };
    }
    case 'stopped':
      return {
        comment: `Symbiote stopped work on this: ${(STOPS[step.stop] ?? STOPS.failed)(request)}.`,
        ...only('stopped'),
      };
  }
}

/** Characters that hide or reorder text (zero-width, bidirectional, soft hyphen): Unicode's Cf. */
const HIDDEN = /\p{Cf}/gu;
/** Control characters but the newline, which Markdown's line rules below read. */
const CONTROL = /(?!\n)\p{Cc}/gu;

/**
 * The classifier's question as plain text a forge neither formats nor links (decision 1019):
 * no HTML, image, link, address, @-mention, nor a reference to an issue, request, label,
 * milestone or epic (posting one would notify there); Markdown's marks dropped, one line, at most
 * 500 characters cut at a word. Null when nothing is left.
 */
export function cleanQuestion(text: string): string | null {
  let s = text.normalize('NFKC').replace(HIDDEN, '').replace(CONTROL, ' ');
  s = s
    .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
    .replace(/```[^\n]*$/gm, ' ')
    .replace(/<[^>]*>?/g, ' ')
    // Images go whole; a link keeps its text; a reference's definition goes.
    .replace(/!\[[^\]]*\]\([^)]*\)?/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)?/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/^\s*\[[^\]]*\]:.*$/gm, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, ' ')
    .replace(/\b(?:javascript|data|mailto|file|vbscript):\S*/gi, ' ')
    .replace(/\bwww\.\S*/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/@[\w-]+(?:\/[\w.-]+)?/g, ' ')
    // References: owner/repo#12, #12, !12, &12, GH-12, ~label, ~"a label", %milestone, $snippet.
    .replace(/[\w.-]+\/[\w.-]+[#!@&][\w.-]+/g, ' ')
    .replace(/\bGH-\d+\b/gi, ' ')
    .replace(/[#!&$]\d+\b/g, ' ')
    .replace(/(^|\s)[~%](?:"[^"]*"?|\w\S*)/g, '$1 ')
    // Markdown's marks: headings, quotes, lists, rules, tables, emphasis, code.
    .replace(/^\s*#{1,6}\s+/gm, ' ')
    .replace(/^\s*>+/gm, ' ')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, ' ')
    .replace(/^\s*[-*_=]{3,}\s*$/gm, ' ')
    .replace(/(^|[^\w])_+|_+(?=[^\w]|$)/g, '$1')
    .replace(/[`*~|<>[\]\\#]/g, ' ');
  s = s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:?!])/g, '$1')
    .replace(/([,;:])[,;:]+/g, '$1')
    .trim();
  if (!/[\p{L}\p{N}]/u.test(s)) return null;
  if (s.length <= MAX_QUESTION) return s;
  const cut = s.slice(0, MAX_QUESTION - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > MAX_QUESTION / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The classifier's answer as a step (decisions 1019, 1076): an ask with its question cleaned, or
 * held when 1037's check found the person in it; a refusal with its word; null for anything else.
 */
export function askedStep(record: IssueRecord): AnswerStep | null {
  const hash = record.snapshot?.hash;
  if (!hash) return null;
  if (record.decision === 'refuse') {
    return {
      step: 'refused',
      hash,
      refusal: record.refusal ?? (record.refusedBy?.length ? 'unsafe' : 'none'),
    };
  }
  if (record.decision !== 'ask') return null;
  if (record.personal?.question?.length) {
    return { step: 'asked', hash, question: null, held: 'personal' };
  }
  const question = cleanQuestion(record.answer?.question ?? '');
  return { step: 'asked', hash, question, ...(question ? {} : { held: 'empty' as const }) };
}

/** `hive.issues.answer` and `hive.issues.labels` as read. */
export interface AnswerConfig {
  answer: boolean;
  labels: AnswerLabels;
}

/** A label's name the person set: 1–50 characters, no comma (GitLab splits on commas). */
const labelName = (value: unknown) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= 50 &&
  !value.includes(',')
    ? value.trim()
    : undefined;

/** `hive.issues.answer` (on unless `false`) and the labels' names in the project's config. */
export function readAnswerConfig(root: string): AnswerConfig {
  const file = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  let issues: Record<string, unknown> = {};
  if (file) {
    try {
      const value = JSON.parse(readFileSync(join(root, file), 'utf8')) as {
        hive?: { issues?: unknown };
      } | null;
      const read = value?.hive?.issues;
      if (read && typeof read === 'object') issues = read as Record<string, unknown>;
    } catch {
      // an unreadable config: the defaults
    }
  }
  const named = (issues.labels && typeof issues.labels === 'object' ? issues.labels : {}) as Record<
    string,
    unknown
  >;
  const labels = Object.fromEntries(
    ROLES.map((role) => {
      const name = labelName(named[role]);
      return [role, name ? { ...ANSWER_LABELS[role], name } : ANSWER_LABELS[role]];
    }),
  ) as unknown as AnswerLabels;
  return { answer: issues.answer !== false, labels };
}
