// HV9c: the classifier on the Issues page, its words: a row's chip (decision 1055), the Hive
// card's lines and what it offers (1056, 1057), in both modes.
import type { IssueRecord, WorkspaceSummary } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  cardOffer,
  costWords,
  decisionChip,
  decisionWords,
  failureWords,
  flagWords,
  hiveStepChip,
  holdWords,
  issueWorkspaces,
  modelWords,
  readWords,
  refusalWords,
  startOffer,
  timeWords,
  writerWords,
} from '../src/issues/classification.js';

const TAKE: IssueRecord = {
  forge: { kind: 'github', host: 'github.com', project: 'acme/app' },
  number: 12,
  url: 'https://github.com/acme/app/issues/12',
  title: 'The search ignores case',
  state: 'open',
  snapshot: {
    hash: 'a'.repeat(64),
    at: '2026-11-14T10:00:00.000Z',
    text: 'Title: The search ignores case',
    read: { members: 1, author: 0 },
    outside: 2,
    flags: [],
  },
  decision: 'take',
  answer: {
    decision: 'take',
    reasons: ['A clear bug with a reproduction.'],
    refusal: 'none',
    question: '',
    kind: 'fix',
    title: 'Make the search ignore case',
    parts: { happens: 'Searching Foo misses foo.' },
    size: 'small',
    model: 'sonnet',
    effort: 'medium',
    flags: [],
  },
  brief: 'From issue #12 …',
  classifier: {
    agent: 'claude',
    model: 'opus',
    effort: 'high',
    prompt: 'p'.repeat(64),
    card: 'c'.repeat(64),
    rules: 1,
    identity: 'i'.repeat(64),
  },
  run: { at: '2026-11-14T10:00:00.000Z', ms: 11_400, cost: 0.0312, tries: 1 },
};

describe("a row's chip (decision 1055)", () => {
  it('says each decision in a word, with its tone; a held take is the person’s turn', () => {
    expect(decisionChip({ decision: 'take' })).toMatchObject({ word: 'Taken', tone: 'ok' });
    expect(decisionChip({ decision: 'take', held: ['new-dependency'] })).toMatchObject({
      word: 'Held',
      tone: 'you',
      tip: 'Taken, and held for your click: it adds or replaces a dependency',
    });
    expect(decisionChip({ decision: 'ask' })).toMatchObject({ word: 'Asked', tone: 'info' });
    expect(decisionChip({ decision: 'refuse', refusal: 'too-large' })).toMatchObject({
      word: 'Refused',
      tone: 'idle',
      tip: 'Refused: more than one goal, or decisions the maintainers have not made',
    });
    expect(decisionChip({ decision: 'failed' })).toMatchObject({ word: 'Failed', tone: 'error' });
  });
});

describe("the Hive card's words", () => {
  it('says the decision in one line, a refusal in words, an unsafe one by its flags', () => {
    expect(decisionWords(TAKE)).toBe(
      "Taken. The brief below is what a writer would get in place of the issue's text.",
    );
    expect(decisionWords({ ...TAKE, held: ['weakens-checks', 'hidden-text'] })).toBe(
      'Taken, and held for your click: it weakens a check and holds hidden text.',
    );
    expect(decisionWords({ ...TAKE, decision: 'ask' })).toBe(
      "Asked. The issue's author must answer a question first.",
    );
    expect(decisionWords({ ...TAKE, decision: 'refuse', refusal: 'not-a-change' })).toBe(
      'Refused: not a change to the code, such as a question, a request for support or a discussion.',
    );
    // Symbiote's rule, whatever the model decided (decision 1005).
    expect(
      decisionWords({
        ...TAKE,
        decision: 'refuse',
        refusal: 'unsafe',
        refusedBy: ['secrets', 'outside-actions'],
      }),
    ).toBe(
      'Refused as unsafe by Symbiote’s rules, whatever the classifier decided: it asks for secrets and for actions outside the repository.',
    );
    expect(decisionWords({ ...TAKE, decision: 'failed', failed: 'reasons' })).toBe(
      'Failed: its answer did not fit (reasons), twice. Nothing starts from it.',
    );
  });

  it('says why a classification failed', () => {
    expect(failureWords('declined')).toBe('the classifier declined to answer');
    expect(failureWords('no answer')).toBe('no answer came');
    expect(failureWords('exit 1')).toBe('Claude Code ended with exit 1');
    expect(failureWords('required part')).toBe('its answer did not fit (required part), twice');
  });

  it('says each refusal, flag and hold in words, for any repository', () => {
    expect(refusalWords('out-of-scope')).toBe(
      "outside what the project's text says Hive may take on",
    );
    expect(refusalWords('unsafe')).toBe(
      'it asks for secrets, speaks to an agent or asks for actions outside the repository',
    );
    expect(flagWords('agent-instructions')).toEqual({
      label: 'Speaks to an agent',
      tip: 'It speaks to an AI or an agent, or tries to set the decision or the brief',
    });
    expect(flagWords('cut').label).toBe('Cut at 20,000 characters');
    expect(flagWords('hidden-text').tip).toMatch(/^Text the forge does not show/);
    expect(holdWords(['personal'])).toBe('its brief names your email or a folder of this machine');
    expect(holdWords(['new-dependency', 'weakens-checks', 'cut'])).toBe(
      'it adds or replaces a dependency, weakens a check and was cut at 20,000 characters',
    );
  });

  it("says the writer's and the classifier's model, the cost and what was read", () => {
    expect(writerWords(TAKE.answer!)).toBe('Fix, small: Sonnet at medium');
    expect(writerWords({ ...TAKE.answer!, model: 'default', effort: 'default' })).toBe(
      'Fix, small: the default model at its default effort',
    );
    expect(writerWords({ ...TAKE.answer!, model: 'claude-opus-4-6', effort: 'max' })).toBe(
      'Fix, small: claude-opus-4-6 at max',
    );
    expect(modelWords('opus', 'high')).toBe('Opus at high');
    expect(modelWords('default')).toBe('the default model');
    expect(costWords(0.0312)).toBe('$0.031');
    expect(costWords(0.4)).toBe('$0.40');
    expect(costWords(0)).toBe('$0');
    expect(timeWords(11_400)).toBe('11 s');
    expect(timeWords(200)).toBe('1 s');
    expect(readWords(TAKE.snapshot)).toBe(
      "The title, the body and 1 member's comment; 2 comments by others left out.",
    );
    expect(readWords({ ...TAKE.snapshot, read: { members: 0, author: 2 }, outside: 0 })).toBe(
      "The title, the body and 2 of its author's comments.",
    );
    expect(
      readWords({
        ...TAKE.snapshot,
        read: { members: 0, author: 0 },
        outside: 4,
        commentsNeedToken: true,
      }),
    ).toBe('The title and the body; 4 comments need a token, none read.');
  });
});

describe('what the card offers (decision 1056)', () => {
  const now = { hive: true, about: true, snapshot: 'a'.repeat(64), identity: 'i'.repeat(64) };

  it('with Hive on: Classify an issue never classified, once the project’s text is written', () => {
    expect(cardOffer({ ...now, record: null })).toEqual({ show: true, action: 'classify' });
    expect(cardOffer({ ...now, about: false, record: null })).toEqual({
      show: true,
      action: null,
      blocked: 'no-about',
    });
  });

  it('Classify again once the issue or the classifier changed, or the last one failed', () => {
    expect(cardOffer({ ...now, record: TAKE })).toEqual({ show: true, action: null });
    expect(cardOffer({ ...now, snapshot: 'b'.repeat(64), record: TAKE })).toEqual({
      show: true,
      action: 'again',
      why: 'The issue changed since it was classified.',
    });
    expect(cardOffer({ ...now, identity: 'j'.repeat(64), record: TAKE })).toEqual({
      show: true,
      action: 'again',
      why: "The classifier changed since: its prompt, model, effort or the project's text.",
    });
    expect(cardOffer({ ...now, record: { ...TAKE, decision: 'failed' } })).toEqual({
      show: true,
      action: 'again',
    });
    // Not read yet: nothing offered on a guess.
    expect(cardOffer({ ...now, snapshot: undefined, identity: undefined, record: TAKE })).toEqual({
      show: true,
      action: null,
    });
    expect(cardOffer({ ...now, about: false, snapshot: 'b'.repeat(64), record: TAKE })).toEqual({
      show: true,
      action: null,
      blocked: 'no-about',
    });
  });

  it('with Hive off: a past decision shows and nothing is offered; no card for one never classified', () => {
    expect(cardOffer({ ...now, hive: false, record: null })).toEqual({ show: false, action: null });
    expect(cardOffer({ ...now, hive: false, snapshot: 'b'.repeat(64), record: TAKE })).toEqual({
      show: true,
      action: null,
      blocked: 'hive-off',
    });
  });
});

describe('Start in Hive and the workspace of an issue (HV10b, decisions 1011, 1013, 1014)', () => {
  const ISSUE = {
    forge: 'github' as const,
    host: 'github.com',
    project: 'acme/app',
    number: 12,
    url: 'https://github.com/acme/app/issues/12',
    title: 'The search ignores case',
    hash: 'a'.repeat(64),
  };
  const workspace = (over: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
    branch: 'fix/12-the-search-ignores-case',
    base: 'b'.repeat(40),
    created: '2026-11-14T11:00:00.000Z',
    planFirst: false,
    brief: '',
    worktree: { path: '/w', exists: true },
    tip: null,
    ahead: 0,
    merged: false,
    agent: { state: 'working' },
    hive: { step: 'checking', round: 1, rounds: 3 },
    issue: ISSUE,
    ...over,
  });
  const FORGE = { kind: 'github' as const, host: 'github.com', project: 'acme/app' };

  it('finds each issue its open workspace, the newest; none landed, merged or of another forge', () => {
    const older = workspace({ created: '2026-11-13T00:00:00.000Z', branch: 'fix/12-old' });
    const found = issueWorkspaces(
      [
        older,
        workspace(),
        workspace({ branch: 'fix/13-x', issue: { ...ISSUE, number: 13 }, merged: true }),
        workspace({ branch: 'fix/14-x', issue: { ...ISSUE, number: 14, project: 'o/r' } }),
        workspace({ branch: 'feature/x', issue: undefined }),
      ],
      FORGE,
    );
    expect([...found.keys()]).toEqual([12]);
    expect(found.get(12)?.branch).toBe('fix/12-the-search-ignores-case');
    expect(issueWorkspaces([workspace()], undefined).size).toBe(0);
  });

  it("offers Start in Hive for a take on the issue's current text, with Hive on and no workspace open", () => {
    const now = TAKE.snapshot.hash;
    expect(startOffer({ hive: true, record: TAKE, snapshot: now, workspace: undefined })).toEqual({
      start: true,
    });
    expect(
      startOffer({
        hive: true,
        record: { ...TAKE, held: ['new-dependency'] },
        snapshot: now,
        workspace: undefined,
      }),
    ).toEqual({ start: true, held: 'Held for your click: it adds or replaces a dependency.' });
    for (const offer of [
      startOffer({ hive: false, record: TAKE, snapshot: now, workspace: undefined }),
      startOffer({
        hive: true,
        record: { ...TAKE, decision: 'refuse' },
        snapshot: now,
        workspace: undefined,
      }),
      startOffer({ hive: true, record: TAKE, snapshot: 'c'.repeat(64), workspace: undefined }),
      startOffer({ hive: true, record: TAKE, snapshot: undefined, workspace: undefined }),
      startOffer({ hive: true, record: null, snapshot: now, workspace: undefined }),
    ]) {
      expect(offer).toEqual({ start: false });
    }
    expect(startOffer({ hive: true, record: TAKE, snapshot: now, workspace: workspace() })).toEqual(
      {
        start: false,
        workspace: { branch: 'fix/12-the-search-ignores-case', step: 'Checking', tone: 'run' },
      },
    );
  });

  it("says Hive's step in a word and a tone", () => {
    expect(hiveStepChip(workspace({ hive: undefined }))).toBeUndefined();
    const step = (s: NonNullable<WorkspaceSummary['hive']>['step']) =>
      hiveStepChip(workspace({ hive: { step: s, round: 1, rounds: 3 } }));
    expect(step('writing')).toEqual({ step: 'Writing', tone: 'run' });
    expect(step('landing')).toEqual({ step: 'Landing', tone: 'run' });
    expect(step('stuck')).toEqual({ step: 'Stopped', tone: 'error' });
    expect(step('landed')).toEqual({ step: 'Landed', tone: 'ok' });
  });
});
