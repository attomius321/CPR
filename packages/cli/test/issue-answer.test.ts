// HV11b (decisions 1019, 1020, 1072, 1076): what Symbiote posts on an issue at each step — its
// fixed sentences filled with its own values, the label of the step, the closing — and the
// classifier's question cleaned and cut. Nothing an agent wrote reaches a comment but that question.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IssueRecord } from '@symbiote/core';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import {
  ANSWER_LABELS,
  answerKey,
  answerOf,
  askedStep,
  cleanQuestion,
  MAX_QUESTION,
  readAnswerConfig,
  STOP_KINDS,
  type AnswerStep,
} from '../src/issue-answer.js';

const LABELS = ANSWER_LABELS;
const names = (labels: { name: string }[]) => labels.map((l) => l.name);

describe('the fixed sentences (decision 1019)', () => {
  it('taken: the branch, the working label, the others removed', () => {
    const answer = answerOf({ step: 'taken', branch: 'fix/3-forge-errors' }, LABELS, 'github');
    expect(answer.comment).toBe("Symbiote's Hive is working on this in `fix/3-forge-errors`.");
    expect(names(answer.add)).toEqual(['symbiote: working']);
    expect(answer.remove).toEqual([
      'symbiote: question',
      'symbiote: declined',
      'symbiote: stopped',
    ]);
    expect(answer.close).toBeUndefined();
  });

  it('asked: the cleaned question in its sentence, the question label', () => {
    const answer = answerOf(
      { step: 'asked', hash: 'h', question: 'Which version do you use?' },
      LABELS,
      'github',
    );
    expect(answer.comment).toBe(
      'Before Symbiote can work on this, it needs an answer: Which version do you use?',
    );
    expect(names(answer.add)).toEqual(['symbiote: question']);
  });

  it('asked, its question held by 1037: the label only (decision 1076)', () => {
    const answer = answerOf({ step: 'asked', hash: 'h', question: null }, LABELS, 'github');
    expect(answer.comment).toBeUndefined();
    expect(names(answer.add)).toEqual(['symbiote: question']);
  });

  it('refused: one sentence a refusal, the declined label, left open', () => {
    const sentences = (['not-a-change', 'out-of-scope', 'too-large', 'unsafe'] as const).map(
      (refusal) => answerOf({ step: 'refused', hash: 'h', refusal }, LABELS, 'gitlab'),
    );
    for (const answer of sentences) {
      expect(answer.comment).toMatch(/^Symbiote will not work on this: .+\.$/);
      expect(names(answer.add)).toEqual(['symbiote: declined']);
      expect(answer.close).toBeUndefined();
    }
    expect(new Set(sentences.map((a) => a.comment)).size).toBe(4);
  });

  it('request opened: the link, a pull request on GitHub and a merge request on GitLab', () => {
    const step: AnswerStep = {
      step: 'request',
      number: 12,
      url: 'https://github.com/acme/app/pull/12',
    };
    expect(answerOf(step, LABELS, 'github')).toEqual({
      comment: 'A pull request is open: https://github.com/acme/app/pull/12.',
      add: [],
      remove: [],
    });
    expect(
      answerOf(
        { ...step, url: 'https://gitlab.com/acme/app/-/merge_requests/12' },
        LABELS,
        'gitlab',
      ).comment,
    ).toBe('A merge request is open: https://gitlab.com/acme/app/-/merge_requests/12.');
  });

  it('landed through the queue: where and at which commit, every label removed, closed', () => {
    const answer = answerOf(
      { step: 'landed', branch: 'fix/3-x', via: 'queue', into: 'main', sha: 'abcdef0123456789' },
      LABELS,
      'github',
    );
    expect(answer).toEqual({
      comment: 'Landed in `main` at abcdef0.',
      add: [],
      remove: [
        'symbiote: working',
        'symbiote: question',
        'symbiote: declined',
        'symbiote: stopped',
      ],
      close: 'completed',
    });
  });

  it('landed through a request: no comment, the labels removed, closed if the forge did not', () => {
    const answer = answerOf(
      { step: 'landed', branch: 'fix/3-x', via: 'request', into: 'main', number: 12 },
      LABELS,
      'github',
    );
    expect(answer.comment).toBeUndefined();
    expect(answer.remove).toHaveLength(4);
    expect(answer.close).toBe('after-request');
  });

  it('stopped: one sentence a kind (decision 1072), the stopped label', () => {
    const sentences = STOP_KINDS.map((stop) =>
      answerOf(
        { step: 'stopped', branch: 'fix/3-x', at: '2026-11-14T10:00:00Z', stop },
        LABELS,
        'github',
      ),
    );
    for (const answer of sentences) {
      expect(answer.comment).toMatch(/^Symbiote stopped work on this: .+\.$/);
      expect(names(answer.add)).toEqual(['symbiote: stopped']);
    }
    expect(new Set(sentences.map((a) => a.comment)).size).toBe(STOP_KINDS.length);
    expect(
      answerOf({ step: 'stopped', branch: 'b', at: 'x', stop: 'request-closed' }, LABELS, 'gitlab')
        .comment,
    ).toBe('Symbiote stopped work on this: its merge request was closed without a merge.');
  });

  it('keeps backticks out of the values it quotes as code', () => {
    const answer = answerOf({ step: 'taken', branch: 'fix/`x`' }, LABELS, 'github');
    expect(answer.comment).toBe("Symbiote's Hive is working on this in `fix/x`.");
  });

  it('one key a step', () => {
    expect(answerKey({ step: 'taken', branch: 'b' })).toBe('taken:b');
    expect(answerKey({ step: 'asked', hash: 'h', question: null })).toBe('asked:h');
    expect(answerKey({ step: 'refused', hash: 'h', refusal: 'unsafe' })).toBe('refused:h');
    expect(answerKey({ step: 'request', number: 12, url: 'u' })).toBe('request:12');
    expect(answerKey({ step: 'landed', branch: 'b', via: 'queue', into: 'main', sha: 's' })).toBe(
      'landed:b',
    );
    expect(answerKey({ step: 'stopped', branch: 'b', at: 'T', stop: 'budget' })).toBe(
      'stopped:b:T',
    );
  });
});

describe('the question, cleaned and cut (decision 1019)', () => {
  it('drops mentions, links, references and Markdown, keeps the words', () => {
    const question = [
      '## Which **version** of `vite` do you use, @maintainer and @acme/core-team?',
      '> See [the docs](https://evil.example/x) and https://evil.example/y or www.evil.example.',
      '![tracker](https://evil.example/pixel.png) <img src=x onerror=alert(1)> <!-- hidden -->',
      'Also #12, !13, acme/other#14, GH-15, ~bug, %"v1", &16 and mail me at a@b.example.',
      '| a | b |',
      '- _one_ ~~two~~ *three*',
    ].join('\n');
    const cleaned = cleanQuestion(question)!;
    expect(cleaned).toContain('Which version of vite do you use');
    expect(cleaned).toContain('See the docs');
    expect(cleaned).toContain('one two three');
    expect(cleaned).not.toContain('\n');
    for (const gone of [
      '@',
      'maintainer',
      'core-team',
      'http',
      'www',
      'evil',
      'tracker',
      'onerror',
      'hidden',
      '12',
      '13',
      'acme/other',
      'GH-15',
      'bug',
      'v1',
      '16',
      'b.example',
      '|',
      '_',
      '~',
      '*',
      '#',
      '>',
    ]) {
      expect(cleaned, gone).not.toContain(gone);
    }
  });

  it('leaves no character that the forge would format or link', () => {
    const cleaned = cleanQuestion('[a](javascript:alert(1)) <b>x</b> `y` \\* | # [c]: http://z');
    expect(cleaned).not.toMatch(/[<>`*|[\]]|https?:|javascript:/);
  });

  it('drops hidden characters', () => {
    expect(cleanQuestion('Which​ one‮?')).toBe('Which one?');
  });

  it('cuts 2,000 characters at a word, at most 500 with its ellipsis', () => {
    const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    expect(long.length).toBeGreaterThan(2_000);
    const cut = cleanQuestion(long)!;
    expect(cut.length).toBeLessThanOrEqual(MAX_QUESTION);
    expect(cut.endsWith('…')).toBe(true);
    expect(long.startsWith(cut.slice(0, -1).trimEnd())).toBe(true);
    expect(cut.slice(0, -1).trimEnd().split(' ').at(-1)).toMatch(/^word\d+$/);
  });

  it('is null when nothing is left', () => {
    expect(cleanQuestion('@someone https://x.example #3')).toBeNull();
  });
});

describe('no field an agent wrote reaches a comment (decision 1019)', () => {
  const MARK = 'AGENT-WROTE-THIS';
  const record = (over: Partial<IssueRecord>): IssueRecord =>
    ({
      forge: { kind: 'github', host: 'github.com', project: 'acme/app' },
      number: 3,
      url: `https://github.com/acme/app/issues/3`,
      title: `${MARK} title`,
      state: 'open',
      snapshot: {
        hash: 'h',
        at: 'x',
        text: MARK,
        read: { members: 0, author: 0 },
        outside: 0,
        flags: [],
      },
      decision: 'ask',
      refusal: 'too-large',
      brief: `${MARK} brief`,
      answer: {
        decision: 'ask',
        reasons: [`${MARK} reason`],
        refusal: 'too-large',
        question: 'Which version?',
        kind: 'fix',
        title: `${MARK} title`,
        parts: { goal: `${MARK} goal` },
        size: 'small',
        model: 'opus',
        effort: 'high',
        flags: [],
      },
      ...over,
    }) as IssueRecord;

  it('asked and refused steps carry only the question and the refusal word', () => {
    for (const r of [record({}), record({ decision: 'refuse' })]) {
      const step = askedStep(r)!;
      for (const kind of ['github', 'gitlab'] as const) {
        const answer = answerOf(step, LABELS, kind);
        expect(JSON.stringify(answer)).not.toContain(MARK);
      }
      expect(JSON.stringify(step)).not.toContain(MARK);
    }
  });

  it("a question 1037's check holds is not posted (decision 1076)", () => {
    const step = askedStep(record({ personal: { question: ['email'] } }));
    expect(step).toEqual({ step: 'asked', hash: 'h', question: null, held: 'personal' });
  });

  it('a take is no answer of the classifier', () => {
    expect(askedStep(record({ decision: 'take' }))).toBeNull();
  });
});

describe('the settings (hive.issues.answer, hive.issues.labels)', () => {
  let dir: string | undefined;
  afterEach(() => {
    dir = undefined;
  });
  const config = (value: unknown) => {
    dir = tempDir();
    mkdirSync(join(dir, 'symbiote'), { recursive: true });
    writeFileSync(join(dir, 'symbiote', 'config.json'), JSON.stringify(value));
    return dir;
  };

  it('on by default, the default labels', () => {
    expect(readAnswerConfig(config({}))).toEqual({ answer: true, labels: ANSWER_LABELS });
  });

  it('off, and labels renamed; a name with a comma or too long keeps its default', () => {
    const read = readAnswerConfig(
      config({
        hive: {
          issues: {
            answer: false,
            labels: { working: 'hive: on it', question: 'a,b', declined: 'x'.repeat(51) },
          },
        },
      }),
    );
    expect(read.answer).toBe(false);
    expect(read.labels.working.name).toBe('hive: on it');
    expect(read.labels.question.name).toBe('symbiote: question');
    expect(read.labels.declined.name).toBe('symbiote: declined');
    expect(read.labels.stopped.name).toBe('symbiote: stopped');
  });
});
