import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Skill, SkillsState } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  isSkillEdited,
  newSkillProblem,
  readSkill,
  skillChecks,
  skillGitNote,
  skillGroups,
  skillOfUrl,
  type SkillCheck,
} from '../src/skills/skills.js';

const fm = (lines: string[], body = '\n# Body\n') => `---\n${lines.join('\n')}\n---\n${body}`;

/** The text of a field `readSkill` read, or why not. */
function field(text: string, key: string): string | undefined {
  const read = readSkill(text);
  if (read.frontmatter === 'none' || read.frontmatter === 'open') return read.frontmatter;
  const value = read.frontmatter.fields.get(key);
  if (!value) return undefined;
  return value.kind === 'text' ? value.value : value.kind;
}

describe('reading a SKILL.md’s frontmatter', () => {
  it('reads plain, quoted and block text', () => {
    const text = fm([
      'name: release-notes',
      'description: Writes notes. Use when asked # a comment',
      'plainlong: Starts here',
      '  and goes on here',
      'double: "Say \\"hi\\": now\\n"',
      "single: 'It''s: fine'",
      'folded: >-',
      '  One line',
      '  and the same line.',
      '',
      '  A new one.',
      'literal: |',
      '  first',
      '  second',
      'list:',
      '  - a',
      'map:',
      '  key: value',
      'flow: [a, b]',
      'empty:',
    ]);
    expect(field(text, 'name')).toBe('release-notes');
    expect(field(text, 'description')).toBe('Writes notes. Use when asked');
    expect(field(text, 'plainlong')).toBe('Starts here and goes on here');
    expect(field(text, 'double')).toBe('Say "hi": now\n');
    expect(field(text, 'single')).toBe("It's: fine");
    expect(field(text, 'folded')).toBe('One line and the same line.\nA new one.');
    expect(field(text, 'literal')).toBe('first\nsecond\n');
    expect(field(text, 'list')).toBe('other');
    expect(field(text, 'map')).toBe('other');
    expect(field(text, 'flow')).toBe('other');
    expect(field(text, 'empty')).toBe('other');
  });

  it('says when there is no frontmatter, or it is not closed, with CRLF line ends too', () => {
    expect(field('# Just a body\n', 'name')).toBe('none');
    expect(field('---\nname: a\n# no end\n', 'name')).toBe('open');
    expect(field('---\r\nname: a\r\ndescription: B.\r\n---\r\nBody\r\n', 'description')).toBe('B.');
  });

  it('gives the body after the frontmatter, and the line it starts on', () => {
    const read = readSkill(fm(['name: a'], '\n# A\n\nText.\n'));
    expect(read.body).toBe('\n# A\n\nText.\n');
    expect(read.bodyLine).toBe(4);
  });

  it('does not read what YAML would refuse, or what it reads as something else', () => {
    expect(field(fm(['description: Use when: asked']), 'description')).toBe('invalid');
    expect(field(fm(['description: "not closed']), 'description')).toBe('invalid');
    expect(field(fm(['description: `code`']), 'description')).toBe('invalid');
    expect(field(fm(['description: &anchor text']), 'description')).toBe('unknown');
    expect(field(fm(['description: !tag text']), 'description')).toBe('unknown');
  });
});

const skill = (name: string, files: string[] = []) => ({ name, files });
const levels = (checks: SkillCheck[]) => checks.map((c) => c.level);
const words = (checks: SkillCheck[]) => checks.map((c) => c.text).join('\n');
const GOOD = fm(
  ['name: review', 'description: Reviews a change. Use when asked to review a branch.'],
  '\n# Review\n\nRead [the checklist](checklist.md).\n',
);

describe('checking a skill', () => {
  it('finds nothing to say of a skill as the standard has it', () => {
    expect(skillChecks(skill('review', ['checklist.md']), GOOD)).toEqual([]);
  });

  it('says a file without frontmatter, or with one not closed, cannot be matched to a task', () => {
    const none = skillChecks(skill('review'), '# Review\n');
    expect(levels(none)).toEqual(['error']);
    expect(words(none)).toContain('No frontmatter');
    const open = skillChecks(skill('review'), '---\nname: review\n');
    expect(levels(open)).toEqual(['error']);
    expect(words(open)).toContain('not closed');
  });

  it('says a value YAML cannot read is an error: Claude Code would load no description', () => {
    const checks = skillChecks(skill('a'), fm(['name: a', 'description: Use when: asked']));
    expect(levels(checks)).toEqual(['error']);
    expect(words(checks)).toContain('description');
    expect(words(checks)).toContain('quote');
  });

  it('warns of a name missing, unlike the folder, or one the standard or the API refuses', () => {
    expect(words(skillChecks(skill('a'), fm(['description: D.'])))).toContain('No name');
    expect(words(skillChecks(skill('a'), fm(['name: b', 'description: D.'])))).toContain(
      'its folder is a',
    );
    expect(words(skillChecks(skill('Big'), fm(['name: Big', 'description: D.'])))).toContain(
      'lowercase',
    );
    const reserved = skillChecks(
      skill('claude-tips'),
      fm(['name: claude-tips', 'description: D.']),
    );
    expect(levels(reserved)).toEqual(['warning']);
    expect(words(reserved)).toContain('claude');
  });

  it('warns of a description missing, too long for the standard or Claude Code, or with < >', () => {
    expect(words(skillChecks(skill('a'), fm(['name: a'])))).toContain('No description');
    const long = skillChecks(skill('a'), fm(['name: a', `description: ${'x'.repeat(1100)}`]));
    expect(levels(long)).toEqual(['warning']);
    expect(words(long)).toContain('1,024');
    const longer = skillChecks(skill('a'), fm(['name: a', `description: ${'x'.repeat(1600)}`]));
    expect(levels(longer)).toEqual(['warning', 'warning']);
    expect(words(longer)).toContain('1,536');
    const angled = skillChecks(skill('a'), fm(['name: a', 'description: Runs --plugin <name>.']));
    expect(levels(angled)).toEqual(['warning']);
    expect(words(angled)).toContain('<');
  });

  it('warns of an empty body, and of one over 500 lines', () => {
    expect(words(skillChecks(skill('a'), fm(['name: a', 'description: D.'], '')))).toContain(
      'No instructions',
    );
    const long = fm(['name: a', 'description: D.'], `${'line\n'.repeat(501)}`);
    expect(words(skillChecks(skill('a'), long))).toContain('500');
  });

  it('warns of a link to a file the skill does not have, not of one in code or elsewhere', () => {
    const body = [
      '',
      'See [tokens](tokens.md), [the shots](./scripts/shots.mjs#top) and [gone](gone.md).',
      'And [the plan](../../../docs/PLAN.md), [docs](https://example.com), [here](#use).',
      '```markdown',
      'See [FORMS.md](FORMS.md)',
      '```',
      'Inline `[x](x.md)` code.',
      '',
    ].join('\n');
    const checks = skillChecks(
      skill('a', ['tokens.md', 'scripts/shots.mjs']),
      fm(['name: a', 'description: D.'], body),
    );
    expect(checks).toEqual([
      { level: 'warning', text: 'Links to gone.md, which is not in the skill’s folder.' },
    ]);
  });

  it('finds no error in this repository’s own skills, and the two < > descriptions', () => {
    const root = join(__dirname, '../../../.claude/skills');
    const found: Record<string, SkillCheck['level'][]> = {};
    for (const name of readdirSync(root).sort()) {
      const files = readdirSync(join(root, name)).filter((f) => f !== 'SKILL.md');
      found[name] = levels(
        skillChecks(skill(name, files), readFileSync(join(root, name, 'SKILL.md'), 'utf8')),
      );
    }
    expect(found).toEqual({
      'framework-plugin': ['warning'],
      milestone: [],
      'regression-check': [],
      'symbiote-review': ['warning'],
      'symbiote-style': [],
      'viewer-check': [],
    });
  });
});

describe('a new skill', () => {
  const taken = (name: string) => name === 'review';
  it('says what the server would refuse', () => {
    expect(newSkillProblem('release-notes', 'Writes notes.', taken)).toBeNull();
    expect(newSkillProblem('', 'D.', taken)).toBe('a name cannot be empty');
    expect(newSkillProblem('Notes', 'D.', taken)).toBe(
      'a name holds only lowercase letters, digits and hyphens',
    );
    expect(newSkillProblem('review', 'D.', taken)).toBe('.claude/skills/review is there already');
    // In the skill library (SK1): its folder named.
    expect(newSkillProblem('review', 'D.', taken, '/home/a/skills')).toBe(
      '/home/a/skills/review is there already',
    );
    expect(newSkillProblem('synced', 'D.', taken)).toBe(
      'synced is a folder Claude Code keeps for itself',
    );
    expect(newSkillProblem('a', ' ', taken)).toBe(
      'a description cannot be empty: it is how an agent finds the skill',
    );
    expect(newSkillProblem('a', 'x'.repeat(1025), taken)).toBe(
      'a description is at most 1,024 characters',
    );
    expect(newSkillProblem('a', 'Runs <x>', taken)).toBe(
      'a description cannot hold < or >: the Claude API refuses them',
    );
  });
});

const make = (over: Partial<Skill>): Skill => ({
  folder: '.claude/skills',
  name: 'a',
  path: '.claude/skills/a/SKILL.md',
  text: 'A',
  version: 'v',
  files: [],
  git: 'committed',
  agents: ['claude'],
  ...over,
});

describe('the list and the editor', () => {
  it('groups the skills by folder, naming the agents that read each', () => {
    const state: SkillsState = {
      checkout: '/r',
      skills: [
        make({ name: 'a', agents: ['claude', 'codex'] }),
        make({ name: 'b', agents: ['claude', 'codex'] }),
      ],
      codex: { installed: true, link: 'linked', canLink: false, git: 'new' },
    };
    expect(skillGroups(state).map((g) => [g.title, g.skills.map((s) => s.name)])).toEqual([
      ['.claude/skills · Claude Code and Codex', ['a', 'b']],
    ]);
    const apart: SkillsState = {
      ...state,
      skills: [
        make({ name: 'a' }),
        make({ folder: '.agents/skills', name: 'c', agents: ['codex'] }),
      ],
      codex: { installed: true, link: 'folder', canLink: false },
    };
    expect(skillGroups(apart).map((g) => g.title)).toEqual([
      '.claude/skills · Claude Code',
      '.agents/skills · Codex',
    ]);
    // The library's skills are drawn in its own section (SK1), not as a folder of the checkout's.
    const library: SkillsState = {
      ...state,
      skills: [make({ name: 'a' }), make({ folder: 'library', name: 'd', agents: [] })],
      library: { folder: '/home/a/skills', exists: true, commits: 'none' },
    };
    expect(skillGroups(library).map((g) => g.title)).toEqual([
      '.claude/skills · Claude Code and Codex',
    ]);
  });

  it('says what a skill’s git state means', () => {
    expect(skillGitNote('new')).toBe(
      'Not committed: commit it to share it with everyone who uses this repository.',
    );
    expect(skillGitNote('changed')).toBe('Changes not committed: commit them to share them.');
    expect(skillGitNote('committed')).toBe('Shared: committed as it is.');
    expect(skillGitNote('ignored')).toBe('Ignored by git here: it stays on this machine.');
  });

  it('knows a draft that changes the text, and the skill an address opens', () => {
    expect(isSkillEdited(make({ text: 'A' }), undefined)).toBe(false);
    expect(isSkillEdited(make({ text: 'A' }), 'A')).toBe(false);
    expect(isSkillEdited(make({ text: 'A' }), 'B')).toBe(true);
    const paths = ['.claude/skills/a/SKILL.md', '.claude/skills/b/SKILL.md'];
    expect(skillOfUrl('?skill=.claude%2Fskills%2Fb%2FSKILL.md', paths)).toBe(paths[1]);
    expect(skillOfUrl('?skill=nope', paths)).toBe(paths[0]);
    expect(skillOfUrl('', [])).toBeNull();
  });
});
