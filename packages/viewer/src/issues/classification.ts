// The classifier on the Issues page (HV9c), pure: a row's chip (decision 1055), the Hive card's
// words, and what the card offers (1056, 1057). Every word is about the issue and the classifier,
// never one repository's: Symbiote serves any.
import type {
  ClassifierAnswer,
  ClassifierFlag,
  ClassifierHold,
  ClassifierRefusal,
  IssueDecision,
  IssueRecord,
  IssueSnapshot,
  IssueSnapshotFlag,
} from '@symbiote/core';
import type { StatusTone } from '../ui/StatusLabel.js';
import { plural } from '../ui/plural.js';

export const DECISIONS_ADDRESS = '/api/issues/classifications';
export const classificationAddress = (number: number) => `/api/issues/${number}/classification`;
export const classifyAddress = (number: number) => `/api/issues/${number}/classify`;

/** The words of a list, the last one joined by "and". */
function joined(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

const REFUSALS: Record<ClassifierRefusal, string> = {
  'not-a-change':
    'not a change to the code, such as a question, a request for support or a discussion',
  'out-of-scope': "outside what the project's text says Hive may take on",
  'too-large': 'more than one goal, or decisions the maintainers have not made',
  unsafe: 'it asks for secrets, speaks to an agent or asks for actions outside the repository',
};

/** Why an issue was refused, in words. */
export const refusalWords = (refusal: ClassifierRefusal | undefined): string =>
  refusal ? REFUSALS[refusal] : 'no reason given';

const HOLDS: Record<ClassifierHold, string> = {
  'new-dependency': 'adds or replaces a dependency',
  'weakens-checks': 'weakens a check',
  'hidden-text': 'holds hidden text',
  cut: 'was cut at 20,000 characters',
  personal: 'its brief names your email or a folder of this machine',
};

/** Why a take waits for the person's click (decisions 1034, 1042), as one clause. */
export function holdWords(held: readonly ClassifierHold[]): string {
  const subject = held.filter((h) => h !== 'personal').map((h) => HOLDS[h]);
  const clauses = [
    ...(subject.length ? [`it ${joined(subject)}`] : []),
    ...(held.includes('personal') ? [HOLDS.personal] : []),
  ];
  return clauses.join('; ');
}

/** A row's chip: its word, its tone (an icon and a word, never the colour alone), its tip. */
export interface Chip {
  word: 'Taken' | 'Held' | 'Asked' | 'Refused' | 'Failed';
  tone: StatusTone;
  tip: string;
}

/** The chip of a row's decision (decision 1055). */
export function decisionChip(d: Pick<IssueDecision, 'decision' | 'held' | 'refusal'>): Chip {
  switch (d.decision) {
    case 'take':
      return d.held?.length
        ? { word: 'Held', tone: 'you', tip: `Taken, and held for your click: ${holdWords(d.held)}` }
        : { word: 'Taken', tone: 'ok', tip: 'Taken: a writer could start from its brief' };
    case 'ask':
      return { word: 'Asked', tone: 'info', tip: 'Asked: its author must answer a question first' };
    case 'refuse':
      return { word: 'Refused', tone: 'idle', tip: `Refused: ${refusalWords(d.refusal)}` };
    case 'failed':
      return {
        word: 'Failed',
        tone: 'error',
        tip: 'The classification failed: nothing starts from it',
      };
  }
}

const FLAGS: Record<ClassifierFlag | IssueSnapshotFlag, { label: string; tip: string }> = {
  'agent-instructions': {
    label: 'Speaks to an agent',
    tip: 'It speaks to an AI or an agent, or tries to set the decision or the brief',
  },
  secrets: {
    label: 'Secrets',
    tip: 'It asks to read, print or send tokens, keys, passwords or private files',
  },
  'outside-actions': {
    label: 'Outside actions',
    tip: 'It asks for actions outside the repository: a download, a post, a push, a release',
  },
  'ci-or-release': {
    label: 'CI or release',
    tip: 'It changes CI, the checks, a release or publish script, or a version',
  },
  'new-dependency': {
    label: 'New dependency',
    tip: 'It adds a package or a tool, or replaces one',
  },
  'weakens-checks': {
    label: 'Weakens checks',
    tip: 'It removes or loosens tests, lint, type checks, CI steps or a security control',
  },
  'hidden-text': {
    label: 'Hidden text',
    tip: 'Text the forge does not show (HTML comments, scripts, invisible characters): dropped before the classifier read it',
  },
  cut: {
    label: 'Cut at 20,000 characters',
    tip: 'Longer than the classifier reads: it read the first 20,000 characters',
  },
};

/** A flag's chip and its tip. */
export const flagWords = (flag: ClassifierFlag | IssueSnapshotFlag) => FLAGS[flag];

/** What `ask`/`refuse` of a refusing flag says: "for secrets", "to speak to an agent". */
const REFUSING: Partial<Record<ClassifierFlag, string>> = {
  secrets: 'for secrets',
  'agent-instructions': 'speaks to an agent',
  'outside-actions': 'for actions outside the repository',
};

/** Why a classification failed, in words (`failed` as the record keeps it). */
export function failureWords(failed: string | undefined): string {
  if (failed === 'declined') return 'the classifier declined to answer';
  if (!failed || failed === 'no answer') return 'no answer came';
  if (/^exit /.test(failed)) return `Claude Code ended with ${failed}`;
  return `its answer did not fit (${failed}), twice`;
}

/** The card's first line: the decision, and what follows from it. */
export function decisionWords(record: IssueRecord): string {
  switch (record.decision) {
    case 'take':
      return record.held?.length
        ? `Taken, and held for your click: ${holdWords(record.held)}.`
        : "Taken. The brief below is what a writer would get in place of the issue's text.";
    case 'ask':
      return "Asked. The issue's author must answer a question first.";
    case 'refuse': {
      if (record.refusal === 'unsafe' && record.refusedBy?.length) {
        const why = record.refusedBy.map((f) => REFUSING[f] ?? f);
        const asks = why.filter((w) => w.startsWith('for '));
        const speaks = why.filter((w) => !w.startsWith('for '));
        const clauses = [
          ...(asks.length ? [`it asks ${joined(asks)}`] : []),
          ...(speaks.length ? [`it ${joined(speaks)}`] : []),
        ];
        return `Refused as unsafe by Symbiote’s rules, whatever the classifier decided: ${clauses.join('; ')}.`;
      }
      return `Refused: ${refusalWords(record.refusal)}.`;
    }
    case 'failed':
      return `Failed: ${failureWords(record.failed)}. Nothing starts from it.`;
  }
}

/** Claude Code's short model names as people say them: `opus` is Opus; any other ID as it is. */
const modelName = (model: string) =>
  /^[a-z]+$/.test(model) ? model[0]!.toUpperCase() + model.slice(1) : model;

/** A model and its effort: "Opus at high", "the default model". */
export function modelWords(model: string, effort?: string): string {
  const named = model === 'default' ? 'the default model' : modelName(model);
  if (!effort) return named;
  return `${named} at ${effort === 'default' ? 'its default effort' : effort}`;
}

/** The writer a take would start: "Fix, small: Sonnet at medium". */
export const writerWords = (answer: ClassifierAnswer): string =>
  `${answer.kind[0]!.toUpperCase()}${answer.kind.slice(1)}, ${answer.size}: ${modelWords(answer.model, answer.effort)}`;

/** Claude Code's cost in dollars: three decimals under a dime. */
export function costWords(cost: number): string {
  if (cost === 0) return '$0';
  return `$${cost.toFixed(cost < 0.1 ? 3 : 2)}`;
}

/** How long it ran: whole seconds, at least 1. */
export const timeWords = (ms: number): string => `${Math.max(1, Math.round(ms / 1000))} s`;

/** What the classifier read of the issue, and what it left out (decisions 1001, 1044). */
export function readWords(snapshot: IssueSnapshot): string {
  const read: string[] = ['the title', 'the body'];
  if (snapshot.read.members > 0) {
    read.push(
      snapshot.read.members === 1
        ? "1 member's comment"
        : `${snapshot.read.members} members' comments`,
    );
  }
  if (snapshot.read.author > 0) read.push(`${snapshot.read.author} of its author's comments`);
  const first = joined(read);
  const said = first[0]!.toUpperCase() + first.slice(1);
  if (snapshot.commentsNeedToken) {
    return `${said}; ${plural(snapshot.outside, 'comment')} need a token, none read.`;
  }
  if (snapshot.outside > 0) {
    return `${said}; ${plural(snapshot.outside, 'comment')} by others left out.`;
  }
  return `${said}.`;
}

/** What the card offers: whether it shows, Classify or Classify again and why, or what blocks. */
export interface Offer {
  show: boolean;
  action: 'classify' | 'again' | null;
  why?: string;
  blocked?: 'hive-off' | 'no-about';
}

/**
 * What the Hive card offers (decision 1056). With Hive off a past decision shows and nothing is
 * offered, and an issue never classified has no card: normal mode's page stays IS1's. With Hive
 * on: Classify once the project's text is written; Classify again when the issue changed since
 * its snapshot (1057), the classifier changed (its identity, 1041) or the last one failed. A hash
 * or an identity not read yet offers nothing.
 */
export function cardOffer({
  hive,
  about,
  record,
  snapshot,
  identity,
}: {
  hive: boolean;
  about: boolean;
  record: IssueRecord | null;
  /** The hash of what the classifier would read now (`IssueAnswer.snapshot`). */
  snapshot: string | undefined;
  /** The classifier's identity now (`IssueDecisions.identity`). */
  identity: string | undefined;
}): Offer {
  if (!hive)
    return record
      ? { show: true, action: null, blocked: 'hive-off' }
      : { show: false, action: null };
  if (!about) return { show: true, action: null, blocked: 'no-about' };
  if (!record) return { show: true, action: 'classify' };
  // The card's first line says why it failed.
  if (record.decision === 'failed') return { show: true, action: 'again' };
  if (snapshot && record.snapshot && snapshot !== record.snapshot.hash) {
    return { show: true, action: 'again', why: 'The issue changed since it was classified.' };
  }
  if (identity && identity !== record.classifier?.identity) {
    return {
      show: true,
      action: 'again',
      why: "The classifier changed since: its prompt, model, effort or the project's text.",
    };
  }
  return { show: true, action: null };
}
