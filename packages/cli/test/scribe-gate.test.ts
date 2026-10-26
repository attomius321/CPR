import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { scribeDecision, writeProblem } from '../src/scribe-gate.js';
import { hookOutput } from '../src/scout-gate.js';

let root: string;
let skills: string;
beforeEach(() => {
  root = tempDir();
  skills = join(root, '.claude', 'skills');
  mkdirSync(join(skills, 'review'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const input = (tool: string, toolInput: Record<string, unknown>) => ({
  hook_event_name: 'PreToolUse',
  tool_name: tool,
  tool_input: toolInput,
  cwd: root,
});

describe('where Scribe may write (V41, decision 275)', () => {
  it('lets a file in a skill’s folder through, new folders and subfolders too', () => {
    for (const path of [
      join(skills, 'review', 'SKILL.md'),
      join(skills, 'review', 'references', 'checklist.md'),
      join(skills, 'release-notes', 'SKILL.md'),
    ]) {
      expect(writeProblem(path, skills), path).toBeNull();
    }
  });

  it('refuses anything else: outside the skills, the folder itself, a relative path, ..', () => {
    const refused: [unknown, string][] = [
      [join(root, 'README.md'), 'is outside'],
      [join(root, '.claude', 'settings.json'), 'is outside'],
      [join(root, '.claude', 'skills-other', 'x', 'SKILL.md'), 'is outside'],
      [join(skills, 'README.md'), "is not in a skill's folder"],
      [skills, 'is outside'],
      ['.claude/skills/review/SKILL.md', 'is not an absolute path'],
      [`${skills}/review/../../settings.json`, '..'],
      [`${skills}/review/../other/SKILL.md`, '..'],
      ['', 'no file given'],
      [undefined, 'no file given'],
    ];
    for (const [path, words] of refused) {
      expect(writeProblem(path, skills), String(path)).toContain(words);
    }
  });

  it('refuses a skill’s folder that links out, by the real path', () => {
    const outside = join(root, 'elsewhere');
    mkdirSync(outside);
    symlinkSync(outside, join(skills, 'linked'));
    expect(writeProblem(join(skills, 'linked', 'SKILL.md'), skills)).toContain('is outside');
  });

  it('takes the skills through a linked folder, as .agents/skills links to them', () => {
    mkdirSync(join(root, '.agents'));
    symlinkSync('../.claude/skills', join(root, '.agents', 'skills'));
    expect(writeProblem(join(root, '.agents', 'skills', 'review', 'SKILL.md'), skills)).toBeNull();
  });
});

describe('scribeDecision (V41)', () => {
  it('leaves reads to Claude Code, and a write in a skill to its own rules (.claude asks)', () => {
    expect(
      scribeDecision(input('Read', { file_path: join(root, 'README.md') }), skills),
    ).toBeNull();
    expect(scribeDecision(input('Grep', { pattern: 'x' }), skills)).toBeNull();
    expect(scribeDecision(input('Glob', { pattern: '**/*.md' }), skills)).toBeNull();
    const file = join(skills, 'review', 'SKILL.md');
    expect(scribeDecision(input('Write', { file_path: file, content: 'x' }), skills)).toBeNull();
    expect(scribeDecision(input('Edit', { file_path: file, old_string: 'a' }), skills)).toBeNull();
  });

  it('runs git’s read commands, as Scout does, and nothing else in Bash', () => {
    expect(scribeDecision(input('Bash', { command: 'git log --oneline -5' }), skills)).toEqual({
      allow: true,
    });
    const denied = scribeDecision(input('Bash', { command: 'mkdir -p .claude/skills/x' }), skills);
    expect(denied).toMatchObject({ allow: false });
    expect((denied as { reason: string }).reason).toContain("Scribe runs only git's read commands");
  });

  it('denies a write outside a skill’s folder, and every other tool, saying the rule', () => {
    const outside = scribeDecision(
      input('Write', { file_path: join(root, 'README.md'), content: 'x' }),
      skills,
    );
    expect(outside).toEqual({
      allow: false,
      reason: `Scribe writes only skills, files in a skill's folder in ${skills}: ${join(root, 'README.md')} is outside ${skills}.`,
    });
    for (const tool of ['NotebookEdit', 'WebFetch', 'Task', 'mcp__x__y']) {
      expect(scribeDecision(input(tool, {}), skills), tool).toMatchObject({ allow: false });
    }
    expect(scribeDecision(null, skills)).toBeNull();
    expect(scribeDecision({ hook_event_name: 'Stop' }, skills)).toBeNull();
  });

  it('says whose rule let a command through', () => {
    expect(JSON.parse(hookOutput({ allow: true }, 'Scribe'))).toMatchObject({
      hookSpecificOutput: { permissionDecisionReason: "Scribe: one of git's read commands" },
    });
  });
});

describe('the skill library (SK1, decision 430)', () => {
  it('lets a write in a skill’s folder of either through, and refuses the library’s root or beside it', () => {
    const library = join(root, 'library');
    mkdirSync(library);
    const both = [skills, library];
    expect(writeProblem(join(library, 'deploy', 'SKILL.md'), both)).toBeNull();
    expect(writeProblem(join(library, 'deploy', 'scripts', 'run.sh'), both)).toBeNull();
    expect(writeProblem(join(skills, 'review', 'SKILL.md'), both)).toBeNull();
    expect(writeProblem(join(library, 'README.md'), both)).toBe(
      `${join(library, 'README.md')} is not in a skill's folder (${library}/<name>/…)`,
    );
    expect(writeProblem(join(root, 'README.md'), both)).toBe(
      `${join(root, 'README.md')} is outside ${skills} and ${library}`,
    );
  });

  it('names both folders when it denies a write', () => {
    const library = join(root, 'library');
    const file = join(root, 'README.md');
    expect(scribeDecision(input('Write', { file_path: file }), [skills, library])).toEqual({
      allow: false,
      reason: `Scribe writes only skills, files in a skill's folder in ${skills} or ${library}: ${file} is outside ${skills} and ${library}.`,
    });
    const other = scribeDecision(input('NotebookEdit', {}), [skills, library]);
    expect(other).toMatchObject({ allow: false });
    expect((other as { reason: string }).reason).toContain(`${skills} or ${library}`);
  });
});
