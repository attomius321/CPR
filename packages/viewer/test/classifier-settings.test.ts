// HV9c: Settings' Issues group in words: the project's text's count (decision 1060) and the
// standing against 1040's bar (1059), for any repository.
import type { ClassifierSettings, ClassifierStanding } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { aboutCount, standingWords } from '../src/settings/classifier-words.js';

const STANDING: ClassifierStanding = {
  identity: 'i'.repeat(64),
  since: '2026-11-14T10:00:00.000Z',
  classified: { take: 2, held: 1, ask: 1, refuse: 3, failed: 0 },
  judged: { right: 0, wrong: 0 },
  bar: { takes: 20, right: 0.95 },
  hostile: null,
  meets: false,
};
const SETTINGS: ClassifierSettings = {
  about: 'A web shop.',
  maxAbout: 4_000,
  levels: { agents: [], file: 'symbiote/config.json' },
  standing: STANDING,
};

describe("the project's text (decision 1060)", () => {
  it('counts its characters against the most, and says when it is too long', () => {
    expect(aboutCount('A shop.', 4_000)).toEqual({ words: '7 of 4,000 characters', over: false });
    expect(aboutCount('x'.repeat(4_001), 4_000)).toEqual({
      words: '4,001 of 4,000 characters: 1 too many',
      over: true,
    });
    expect(aboutCount('  A  ', 4_000).words).toBe('1 of 4,000 characters');
  });
});

describe('the standing (decision 1059)', () => {
  it('says how many takes were judged of the 20 the bar needs, and what was classified', () => {
    expect(standingWords(SETTINGS)).toEqual({
      value: '0 of 20 judged',
      met: false,
      facts: [
        '6 classified under this classifier: 2 taken (1 held), 1 asked, 3 refused.',
        'No take judged yet: a take is judged once the work started from it lands or stops.',
        'The hostile test issues have not run with this project’s text.',
      ],
    });
  });

  it('says the share right once takes are judged, and when the bar is met', () => {
    const judged = { ...STANDING, judged: { right: 19, wrong: 1 } };
    expect(standingWords({ ...SETTINGS, standing: judged }).facts[1]).toBe(
      '20 takes judged: 19 right, 1 wrong (95 %).',
    );
    const met = {
      ...judged,
      hostile: { taken: 0, of: 26, at: '2026-11-20T10:00:00.000Z' },
      meets: true,
    };
    expect(standingWords({ ...SETTINGS, standing: met })).toMatchObject({
      value: 'Met',
      met: true,
    });
    expect(standingWords({ ...SETTINGS, standing: met }).facts[2]).toBe(
      'None of 26 hostile test issues taken.',
    );
  });

  it('says why there is none: no text of the project, or what is missing', () => {
    expect(standingWords({ ...SETTINGS, about: null, standing: null, why: 'x' })).toEqual({
      value: 'Not counted',
      met: false,
      facts: [
        'Counted once the project’s text is saved: each text and classifier has its own count.',
      ],
    });
    expect(
      standingWords({
        ...SETTINGS,
        standing: null,
        why: 'Claude Code is not found: the classifier runs on it',
      }),
    ).toEqual({
      value: 'Not counted',
      met: false,
      facts: ['Claude Code is not found: the classifier runs on it.'],
    });
    const none = { ...STANDING, classified: { take: 0, held: 0, ask: 0, refuse: 0, failed: 0 } };
    expect(standingWords({ ...SETTINGS, standing: none }).facts[0]).toBe(
      'None classified under this classifier yet.',
    );
  });
});
