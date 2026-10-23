import type { PromptSetting, PromptSettings } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  draftProblem,
  gitNote,
  insertAt,
  isEdited,
  promptGroups,
  promptOfUrl,
  sizeOf,
} from '../src/settings/settings.js';

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
  it('keeps the groups and their prompts in the order the server gives them', () => {
    const prompts = [
      prompt({ key: 'start.feature', title: 'Feature' }),
      prompt({ key: 'start.fix' }),
      prompt({ key: 'reviews', group: 'Reviews', title: 'symbiote/AGENTS.md' }),
      prompt({ key: 'plan.first', title: 'Plan first' }),
      prompt({ key: 'merger', group: 'Merger', title: 'Instructions' }),
    ];
    expect(
      promptGroups(prompts).map(({ group, prompts: of }) => [group, of.map((p) => p.key)]),
    ).toEqual([
      ['Workspaces', ['start.feature', 'start.fix', 'plan.first']],
      ['Reviews', ['reviews']],
      ['Merger', ['merger']],
    ]);
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
