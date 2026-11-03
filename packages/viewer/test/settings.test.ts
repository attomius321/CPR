import type { PromptSetting, PromptSettings } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  draftProblem,
  filterNav,
  foldOpen,
  gitNote,
  insertAt,
  isEdited,
  markOf,
  promptGroups,
  promptOfUrl,
  settingsNav,
  sizeOf,
  type NavSection,
} from '../src/settings/settings.js';
import {
  checkGitNote,
  checksEdited,
  checksProblem,
  cleanCommands,
} from '../src/settings/checks.js';

const prompt = (fields: Partial<PromptSetting>): PromptSetting => ({
  key: 'start.fix',
  group: 'Workspaces',
  title: 'Fix',
  about: 'What a Fix workspace’s agent is told.',
  text: 'Fix {branch}.\n\n{brief}',
  default: 'Fix {branch}.\n\n{brief}',
  changed: false,
  placeholders: [
    { name: 'branch', about: "the workspace's branch" },
    { name: 'brief', about: "the person's brief", required: true },
  ],
  max: 8_000,
  ...fields,
});

describe('promptGroups', () => {
  const entries = (prompts: PromptSetting[]) =>
    promptGroups(prompts).map(({ group, entries: of }) => [
      group,
      of.map((e) => [e.key, e.name, e.prompts.map((p) => p.key), e.agent]),
    ]);

  it('keeps the groups and their prompts in the order the server gives them', () => {
    const prompts = [
      prompt({ key: 'start.feature', title: 'Feature' }),
      prompt({ key: 'start.fix' }),
      prompt({ key: 'reviews', group: 'Reviews', title: 'symbiote/AGENTS.md' }),
      prompt({ key: 'plan.first', title: 'Plan first' }),
    ];
    expect(entries(prompts)).toEqual([
      [
        'Workspaces',
        [
          ['start.feature', 'Feature', ['start.feature'], undefined],
          ['start.fix', 'Fix', ['start.fix'], undefined],
          ['plan.first', 'Plan first', ['plan.first'], undefined],
        ],
      ],
      ['Reviews', [['reviews', 'symbiote/AGENTS.md', ['reviews'], undefined]]],
    ]);
  });

  it('lists each prebuilt agent once, by its name, under Prebuilt agents: one page for its settings', () => {
    const prompts = [
      prompt({ key: 'start.fix' }),
      prompt({ key: 'reviews', group: 'Reviews', title: 'symbiote/AGENTS.md' }),
      prompt({ key: 'merger', group: 'Merger', title: 'Instructions' }),
      prompt({ key: 'nucleus', group: 'Nucleus', title: 'Instructions' }),
      prompt({ key: 'scribe', group: 'Scribe', title: 'Instructions' }),
    ];
    expect(entries(prompts)).toEqual([
      ['Workspaces', [['start.fix', 'Fix', ['start.fix'], undefined]]],
      ['Reviews', [['reviews', 'symbiote/AGENTS.md', ['reviews'], undefined]]],
      [
        'Prebuilt agents',
        [
          ['merger', 'Merger', ['merger'], 'Merger'],
          ['nucleus', 'Nucleus', ['nucleus'], 'Nucleus'],
          ['scribe', 'Scribe', ['scribe'], 'Scribe'],
        ],
      ],
    ]);
  });
});

describe("promptGroups and Hive's prompts (HV2)", () => {
  const prompts = [
    prompt({ key: 'start.fix' }),
    prompt({ key: 'scribe', group: 'Scribe', title: 'Instructions' }),
    prompt({ key: 'hive.start', group: 'Hive', title: 'Start' }),
    prompt({ key: 'hive.check', group: 'Hive', title: 'Check failed' }),
  ];
  const names = (hive: boolean) => promptGroups(prompts, { hive }).map((g) => g.group);

  it('lists the Hive group only in Hive mode, each prompt an entry', () => {
    expect(names(false)).toEqual(['Workspaces', 'Prebuilt agents']);
    expect(promptGroups(prompts).map((g) => g.group)).toEqual(['Workspaces', 'Prebuilt agents']);
    // First in Hive mode, as proof 04 lists it (V93).
    expect(names(true)).toEqual(['Hive', 'Workspaces', 'Prebuilt agents']);
    expect(promptGroups(prompts, { hive: true })[0]?.entries.map((e) => e.name)).toEqual([
      'Start',
      'Check failed',
    ]);
  });

  it("gives the running reviewer an agent's page in the Hive group, only in Hive mode (HV3)", () => {
    const withReviewer = [
      ...prompts,
      prompt({ key: 'hive.review', group: 'Hive', title: 'Defects proven' }),
      prompt({ key: 'hive.reviewer', group: 'Hive', title: 'Reviewer' }),
    ];
    const hive = promptGroups(withReviewer, { hive: true })[0];
    expect(hive?.group).toBe('Hive');
    // Its reviewer first, then Hive's prompts (V93, proof 04).
    expect(hive?.entries.map((e) => [e.name, e.agent ?? null])).toEqual([
      ['Reviewer', 'Reviewer'],
      ['Start', null],
      ['Check failed', null],
      ['Defects proven', null],
    ]);
    expect(promptGroups(withReviewer).flatMap((g) => g.entries.map((e) => e.name))).not.toContain(
      'Reviewer',
    );
  });
});

describe('settingsNav (fix/settings-page)', () => {
  // The server's order, as `/api/settings/prompts` gives it.
  const prompts = [
    prompt({ key: 'start.feature', title: 'Feature' }),
    prompt({ key: 'start.fix' }),
    prompt({ key: 'plan.first', title: 'Plan first' }),
    prompt({ key: 'verdict.approve', group: 'Reviews', title: 'Approved' }),
    prompt({ key: 'reviews', group: 'Reviews', title: 'symbiote/AGENTS.md' }),
    prompt({ key: 'merger', group: 'Merger', title: 'Instructions' }),
    prompt({ key: 'merge.failed', group: 'Merger', title: 'Check failed' }),
    prompt({ key: 'nucleus', group: 'Nucleus', title: 'Instructions' }),
    prompt({ key: 'scribe', group: 'Scribe', title: 'Instructions' }),
    prompt({ key: 'advisor', title: 'Suggest settings' }),
    prompt({ key: 'hive.start', group: 'Hive', title: 'Start' }),
    prompt({ key: 'hive.check', group: 'Hive', title: 'Check failed' }),
    prompt({ key: 'hive.reviewer', group: 'Hive', title: 'Reviewer' }),
    prompt({ key: 'hive.nucleus', group: 'Hive', title: 'Alpha Ceph' }),
  ];
  const shape = (sections: NavSection[]) =>
    sections.map(({ name, entries, folds }) => [
      name,
      entries.map((e) => `${e.key} ${e.name}`),
      folds.map((f) => [f.group, f.entries.map((e) => e.key)]),
    ]);

  it('lists what is set by what it is: the repository first, its check in both modes, agents, then the prompts by group', () => {
    expect(shape(settingsNav(prompts, { hive: false }))).toEqual([
      ['This repository', ['checks Checks', 'hive-mode Hive mode'], []],
      [
        'Agents',
        ['nucleus Nucleus', 'merger Merger', 'scribe Scribe', 'advisor Suggest settings'],
        [],
      ],
      [
        'Prompts',
        [],
        [
          ['Workspaces', ['start.feature', 'start.fix', 'plan.first']],
          ['Reviews', ['verdict.approve', 'reviews']],
        ],
      ],
      ['This machine', ['skill-library Skill library'], []],
      ['This browser', ['appearance Appearance'], []],
    ]);
  });

  it("in Hive mode: the same places, Alpha Ceph and the running reviewer among the agents, Hive's prompts the first group", () => {
    expect(shape(settingsNav(prompts, { hive: true }))).toEqual([
      ['This repository', ['checks Checks', 'hive-mode Hive mode'], []],
      [
        'Agents',
        [
          'nucleus Alpha Ceph',
          'merger Merger',
          'scribe Scribe',
          'hive.reviewer Reviewer',
          'advisor Suggest settings',
        ],
        [],
      ],
      [
        'Prompts',
        [],
        [
          ['Hive', ['hive.start', 'hive.check', 'hive.nucleus']],
          ['Workspaces', ['start.feature', 'start.fix', 'plan.first']],
          ['Reviews', ['verdict.approve', 'reviews']],
        ],
      ],
      ['This machine', ['skill-library Skill library'], []],
      ['This browser', ['appearance Appearance'], []],
    ]);
    // An agent's page holds all its prompts.
    const agents = settingsNav(prompts, { hive: true })[1]?.entries ?? [];
    expect(agents.find((e) => e.key === 'merger')?.prompts.map((p) => p.key)).toEqual([
      'merger',
      'merge.failed',
    ]);
  });

  it('keeps the settings that are not prompts when the prompts cannot be read', () => {
    expect(shape(settingsNav(null, { hive: true }))).toEqual([
      ['This repository', ['checks Checks', 'hive-mode Hive mode'], []],
      ['This machine', ['skill-library Skill library'], []],
      ['This browser', ['appearance Appearance'], []],
    ]);
  });

  it("filters by a name, a group, an agent's prompt or a setting's config key; nothing else listed", () => {
    const all = settingsNav(prompts, { hive: true });
    expect(filterNav(all, '')).toEqual(all);
    expect(shape(filterNav(all, 'THEME'))).toEqual([
      ['This browser', ['appearance Appearance'], []],
    ]);
    expect(shape(filterNav(all, 'merge.checks'))).toEqual([
      ['This repository', ['checks Checks'], []],
    ]);
    // "check": the Checks page, the merger's Check failed prompt, Hive's.
    expect(shape(filterNav(all, 'check'))).toEqual([
      ['This repository', ['checks Checks'], []],
      ['Agents', ['merger Merger'], []],
      ['Prompts', [], [['Hive', ['hive.check']]]],
    ]);
    // A group's name lists the whole group.
    expect(shape(filterNav(all, 'reviews'))).toEqual([
      ['Prompts', [], [['Reviews', ['verdict.approve', 'reviews']]]],
    ]);
    expect(filterNav(all, 'nothing like it')).toEqual([]);
  });

  it('opens a fold that holds the entry open, else as it was left; every fold while filtering', () => {
    const folds = settingsNav(prompts, { hive: false })[2]?.folds ?? [];
    const [workspaces, reviews] = folds;
    if (!workspaces || !reviews) throw new Error('no folds');
    expect(foldOpen(workspaces, { open: 'start.fix', kept: {}, query: '' })).toBe(true);
    expect(foldOpen(reviews, { open: 'start.fix', kept: {}, query: '' })).toBe(false);
    expect(foldOpen(reviews, { open: 'start.fix', kept: { Reviews: true }, query: '' })).toBe(true);
    // Folded by the person: the entry open in it stays reachable by its mark, the fold shut.
    expect(
      foldOpen(workspaces, { open: 'start.fix', kept: { Workspaces: false }, query: '' }),
    ).toBe(false);
    expect(foldOpen(reviews, { open: 'checks', kept: { Reviews: false }, query: 'app' })).toBe(
      true,
    );
  });
});

describe('the check as typed (fix/settings-page)', () => {
  it('saves the commands trimmed, the empty rows dropped', () => {
    expect(cleanCommands(['  pnpm install ', '', '\t', 'pnpm check'])).toEqual([
      'pnpm install',
      'pnpm check',
    ]);
  });

  it('says why the server would refuse it, as it checks', () => {
    expect(checksProblem(['pnpm check'])).toBeNull();
    expect(checksProblem(['', ' '])).toMatch(/at least one command/i);
    expect(checksProblem(['pnpm install\npnpm check'])).toMatch(/one line/i);
    expect(checksProblem(Array.from({ length: 21 }, (_, i) => `step ${i}`))).toMatch(/20/);
    expect(checksProblem(['x'.repeat(1001)])).toMatch(/1,000/);
  });

  it('is edited when the commands differ from those saved, blank rows and spaces aside', () => {
    expect(checksEdited(undefined, undefined)).toBe(false);
    expect(checksEdited(['pnpm check'], [' pnpm check ', ''])).toBe(false);
    expect(checksEdited(['pnpm check'], ['pnpm test'])).toBe(true);
    expect(checksEdited(undefined, [''])).toBe(false);
    expect(checksEdited(undefined, ['make'])).toBe(true);
    expect(checksEdited(['a', 'b'], ['b', 'a'])).toBe(true);
  });
});

describe('markOf', () => {
  it('says not saved before not used before changed, for any of the entry’s prompts', () => {
    const fix = prompt({});
    const changed = prompt({ key: 'start.chore', changed: true });
    const unused = prompt({ key: 'start.spike', warning: 'Not used: no {brief}.' });
    expect(markOf([fix], [])).toBeNull();
    expect(markOf([fix, changed], [])).toBe('changed');
    expect(markOf([changed, unused], [])).toBe('warning');
    expect(markOf([changed, unused], ['start.chore'])).toBe('unsaved');
  });
});

describe('draftProblem', () => {
  it('names a missing required placeholder, and a text over the limit', () => {
    const fix = prompt({});
    expect(draftProblem(fix, 'Fix {branch}: {brief}')).toBeNull();
    expect(draftProblem(fix, 'Fix {branch}.')).toBe(
      "{brief} is missing: the agent would not be given the person's brief.",
    );
    expect(draftProblem(prompt({ max: 10 }), '{brief} and more')).toBe(
      'Longer than 10 characters (16).',
    );
  });
});

describe('isEdited', () => {
  it('is a draft that differs from the text in use, line ends and a blank end aside', () => {
    const fix = prompt({});
    expect(isEdited(fix, undefined)).toBe(false);
    expect(isEdited(fix, 'Fix {branch}.\r\n\r\n{brief}\n\n')).toBe(false);
    expect(isEdited(fix, 'Fix {branch} now.\n\n{brief}')).toBe(true);
  });
});

describe('sizeOf', () => {
  it('counts characters and about how many tokens, of the limit', () => {
    expect(sizeOf(prompt({}), 'x'.repeat(1_234))).toBe(
      '1,234 of 8,000 characters, about 309 tokens',
    );
  });
});

describe('gitNote', () => {
  it("says whether the file is shared, for each of git's states", () => {
    const of = (git: PromptSettings['git']) =>
      gitNote({ file: 'symbiote/config.json', version: 'v', git, prompts: [] });
    expect(of('none')).toBe("No prompt changed: every agent is told Symbiote's text.");
    expect(of('new')).toBe(
      'Saved in symbiote/config.json, not committed: commit it to share the prompts with everyone ' +
        'who uses this repository.',
    );
    expect(of('changed')).toBe(
      'symbiote/config.json has changes not committed: commit them to share them.',
    );
    expect(of('committed')).toBe('Shared: symbiote/config.json is committed as it is.');
    expect(of('ignored')).toBe(
      'symbiote/config.json is ignored by git here: the prompts stay on this machine.',
    );
  });
});

describe('insertAt', () => {
  it('puts a placeholder where the cursor is, or over the selection, and moves the cursor', () => {
    expect(insertAt('Fix .', 4, 4, '{branch}')).toEqual({ text: 'Fix {branch}.', cursor: 12 });
    expect(insertAt('Fix it.', 4, 6, '{branch}')).toEqual({ text: 'Fix {branch}.', cursor: 12 });
  });
});

describe('promptOfUrl', () => {
  it('is ?prompt=<key> when that prompt exists, else the first', () => {
    const keys = ['start.feature', 'start.fix'] as const;
    expect(promptOfUrl('?prompt=start.fix', keys)).toBe('start.fix');
    expect(promptOfUrl('?prompt=start.bug', keys)).toBe('start.feature');
    expect(promptOfUrl('', keys)).toBe('start.feature');
    expect(promptOfUrl('', [])).toBeNull();
  });
});

describe('checkGitNote (fix/settings-page)', () => {
  it("says where a save goes and whether it is shared, for each of git's states", () => {
    const file = 'symbiote/config.json';
    expect(checkGitNote({ file, git: 'none' })).toBe(
      'A save writes symbiote/config.json: commit it to share the check.',
    );
    expect(checkGitNote({ file, git: 'committed' })).toBe(
      'Shared: symbiote/config.json is committed as it is.',
    );
    expect(checkGitNote({ file, git: 'ignored' })).toMatch(/stays on this machine/);
  });
});
