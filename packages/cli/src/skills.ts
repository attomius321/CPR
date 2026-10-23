// The checkout's skills (V41): `.claude/skills/<name>/SKILL.md`, Claude Code's, and
// `.agents/skills/<name>/SKILL.md`, Codex's (decision 271), as the Skills page lists, saves, adds
// and deletes them; and `.agents/skills` made a link to `.claude/skills`, so Codex reads Claude
// Code's (decision 272). Written in place, as Settings writes `symbiote/config.json`: the person
// commits them. Nothing outside the two folders is written.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import {
  fileGitState,
  type AgentKind,
  type GitRepo,
  type Skill,
  type SkillChange,
  type SkillFolder,
  type SkillsState,
} from '@symbiote/core';

export const CLAUDE_SKILLS = '.claude/skills';
export const CODEX_SKILLS = '.agents/skills';

/** The longest `SKILL.md` the page edits; a longer one is listed by name only. */
export const MAX_SKILL = 256 * 1024;
/** Most of a skill's other files listed. */
const MAX_FILES = 200;
/** The standard's limits (agentskills.io): a name, and a description. */
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
/** Folders Claude Code keeps for itself among skills (synced from claude.ai, its own). */
const RESERVED = new Set(['synced', 'anthropic-skills']);

/** A change the skills cannot take: its status and why. */
export class SkillRefused extends Error {
  override name = 'SkillRefused';
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
  }
}

/** The Skills page's server (`/api/skills`). */
export interface SkillsService {
  state(): Promise<SkillsState>;
  /** Makes a change, and answers the skills as they are after it. */
  change(change: SkillChange): Promise<SkillsState>;
}

/** What is wrong with a skill's name, as the standard has it; null when nothing is. */
export function skillNameProblem(name: string): string | null {
  if (name === '') return 'a name cannot be empty';
  if (name.length > MAX_NAME) return `a name is at most ${MAX_NAME} characters`;
  if (!/^[a-z0-9-]+$/.test(name)) return 'a name holds only lowercase letters, digits and hyphens';
  if (name.startsWith('-') || name.endsWith('-')) return 'a name cannot start or end with a hyphen';
  if (name.includes('--')) return 'a name cannot hold two hyphens in a row';
  return null;
}

/** What is wrong with a new skill's description; null when nothing is. */
function descriptionProblem(description: string): string | null {
  if (description.trim() === '') {
    return 'a description cannot be empty: it is how an agent finds the skill';
  }
  if (description.length > MAX_DESCRIPTION) {
    return `a description is at most ${MAX_DESCRIPTION.toLocaleString('en-US')} characters`;
  }
  if (/[<>]/.test(description)) {
    return 'a description cannot hold < or >: the Claude API refuses them';
  }
  return null;
}

/**
 * `text` as a YAML value: as it is when YAML reads it back as that text, else in double quotes.
 * Plain only when it cannot start a list, a map, a quote, a comment or another type.
 */
export function yamlText(text: string): string {
  const plain =
    text !== '' &&
    text === text.trim() &&
    ![...text].some(isControl) &&
    !/^[-?:,[\]{}#&*!|>'"%@`\d+.]/.test(text) &&
    !text.includes(': ') &&
    !text.includes(' #') &&
    !text.endsWith(':') &&
    !/^(true|false|yes|no|on|off|y|n|null|~)$/i.test(text);
  if (plain) return text;
  const escaped = [...text]
    .map((c) => {
      if (c === '\\' || c === '"') return `\\${c}`;
      if (c === '\n') return '\\n';
      if (c === '\t') return '\\t';
      return isControl(c) ? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}` : c;
    })
    .join('');
  return `"${escaped}"`;
}

/** A control character: YAML takes none unescaped. */
function isControl(c: string): boolean {
  const code = c.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

const versionOf = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** A path's real path, or itself when it does not exist. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** `child` is `parent` or inside it. */
const within = (child: string, parent: string) =>
  child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);

/** A skill's other files, relative to its folder: dot-folders skipped, `MAX_FILES` at most. */
function filesOf(dir: string): { files: string[]; more: boolean } {
  const files: string[] = [];
  let more = false;
  const walk = (folder: string, prefix: string) => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) walk(join(folder, entry.name), path);
      } else if (path !== 'SKILL.md') {
        if (files.length === MAX_FILES) {
          more = true;
          return;
        }
        files.push(path);
      }
    }
  };
  walk(dir, '');
  return { files: files.sort(), more };
}

/** How `.agents/skills` stands: a link to `.claude/skills`, a folder of its own, or nothing. */
function codexLink(root: string): 'linked' | 'folder' | 'none' {
  const path = join(root, CODEX_SKILLS);
  try {
    lstatSync(path);
  } catch {
    return 'none';
  }
  return real(path) === real(join(root, CLAUDE_SKILLS)) ? 'linked' : 'folder';
}

/** The checkout's skills, for the Skills page; Codex's install found by `codexInstalled`. */
export function skillsService(
  repo: GitRepo,
  {
    codexInstalled,
    platform = process.platform,
  }: { codexInstalled: () => Promise<boolean>; platform?: NodeJS.Platform },
): SkillsService {
  const root = repo.root;

  async function list(folder: SkillFolder, agents: AgentKind[]): Promise<Skill[]> {
    const dir = join(root, folder);
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return [];
    }
    const skills: Skill[] = [];
    for (const name of names) {
      const file = join(dir, name, 'SKILL.md');
      let size: number;
      try {
        const stat = statSync(file);
        if (!stat.isFile()) continue;
        size = stat.size;
      } catch {
        continue;
      }
      const path = `${folder}/${name}/SKILL.md`;
      const text = size > MAX_SKILL ? null : readFileSync(file, 'utf8');
      const { files, more } = filesOf(join(dir, name));
      skills.push({
        folder,
        name,
        path,
        ...(text === null ? { tooLarge: true as const } : { text }),
        version: versionOf(text ?? `${size}`),
        files,
        ...(more ? { moreFiles: true as const } : {}),
        git: await fileGitState(repo, path),
        agents,
      });
    }
    return skills;
  }

  async function state(): Promise<SkillsState> {
    const link = codexLink(root);
    const skills = [
      ...(await list(CLAUDE_SKILLS, link === 'linked' ? ['claude', 'codex'] : ['claude'])),
      ...(link === 'folder' ? await list(CODEX_SKILLS, ['codex']) : []),
    ];
    const windows = platform === 'win32';
    return {
      checkout: root,
      skills,
      codex: {
        installed: await codexInstalled(),
        link,
        canLink: link === 'none' && !windows,
        ...(link === 'none' && windows
          ? { reason: 'On Windows a link needs rights git may not keep: copy the skills instead' }
          : {}),
        ...(link === 'linked' ? { git: await fileGitState(repo, CODEX_SKILLS) } : {}),
      },
    };
  }

  /**
   * The skill a change names: `<folder>/<name>/SKILL.md` in one of the two folders, its folder's
   * real path inside the folder's (a link out is the person's to change where it is).
   */
  function skillAt(path: string): { dir: string; file: string } {
    const match = /^(\.claude\/skills|\.agents\/skills)\/([^/\\\0]+)\/SKILL\.md$/.exec(path);
    const folder = match?.[1];
    const name = match?.[2];
    if (!folder || !name || name === '.' || name === '..') {
      throw new SkillRefused(
        `not a skill: ${path} (a skill is .claude/skills/<name>/SKILL.md)`,
        400,
      );
    }
    const dir = join(root, folder, name);
    if (!within(real(dir), real(join(root, folder)))) {
      throw new SkillRefused(
        `${folder}/${name} is a link out of ${folder}: change it where it is`,
        400,
      );
    }
    return { dir, file: join(dir, 'SKILL.md') };
  }

  /** The text at `file` when its version is `version`; refused (409) otherwise. */
  function current(path: string, file: string, version: string): void {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new SkillRefused(`${path} is gone since you opened it`, 409);
    }
    if (versionOf(text) !== version) {
      throw new SkillRefused(`${path} changed since you opened it: open it again`, 409);
    }
  }

  async function put(file: string, text: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const temp = join(dirname(file), `.SKILL.md.${process.pid}.tmp`);
    await writeFile(temp, text);
    await rename(temp, file);
  }

  async function apply(change: SkillChange): Promise<void> {
    switch (change.action) {
      case 'save': {
        if (change.text.length > MAX_SKILL) {
          throw new SkillRefused(`a skill is at most ${MAX_SKILL / 1024} KB here`, 400);
        }
        const { file } = skillAt(change.path);
        current(change.path, file, change.version);
        await put(file, change.text);
        return;
      }
      case 'new': {
        const problem = skillNameProblem(change.name) ?? descriptionProblem(change.description);
        if (problem) throw new SkillRefused(problem, 400);
        if (RESERVED.has(change.name)) {
          throw new SkillRefused(`${change.name} is a folder Claude Code keeps for itself`, 400);
        }
        const dir = join(root, CLAUDE_SKILLS, change.name);
        if (existsAt(dir)) {
          throw new SkillRefused(`${CLAUDE_SKILLS}/${change.name} is there already`, 409);
        }
        const description = change.description.trim();
        await put(
          join(dir, 'SKILL.md'),
          `---\nname: ${change.name}\ndescription: ${yamlText(description)}\n---\n`,
        );
        return;
      }
      case 'delete': {
        const { dir, file } = skillAt(change.path);
        current(change.path, file, change.version);
        await rm(dir, { recursive: true, force: true });
        return;
      }
      case 'link': {
        if (platform === 'win32') {
          throw new SkillRefused(
            'On Windows a link needs rights git may not keep: copy the skills instead',
            409,
          );
        }
        if (codexLink(root) !== 'none') {
          throw new SkillRefused(`${CODEX_SKILLS} is there already: Codex reads it as it is`, 409);
        }
        await mkdir(join(root, CLAUDE_SKILLS), { recursive: true });
        await mkdir(join(root, '.agents'), { recursive: true });
        await symlink('../.claude/skills', join(root, CODEX_SKILLS));
        return;
      }
    }
  }

  // One change at a time: each reads what it changes.
  let changing: Promise<unknown> = Promise.resolve();
  return {
    state,
    async change(change) {
      const next = changing.then(() => apply(change));
      changing = next.catch(() => undefined);
      await next;
      return state();
    },
  };
}

function existsAt(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** `POST /api/skills`'s body, checked: throws with what is wrong. */
export function parseSkillChange(body: string): SkillChange {
  const value = JSON.parse(body) as unknown;
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const text = (key: string, what: string): string => {
    const x = v[key];
    if (typeof x !== 'string') throw new Error(`${key}: ${what}`);
    return x;
  };
  switch (v.action) {
    case 'save':
      return {
        action: 'save',
        path: text('path', "the skill's SKILL.md"),
        text: text('text', 'its new text'),
        version: text('version', 'as it was read'),
      };
    case 'new':
      return {
        action: 'new',
        name: text('name', "the skill's name"),
        description: text('description', 'what it does and when to use it'),
      };
    case 'delete':
      return {
        action: 'delete',
        path: text('path', "the skill's SKILL.md"),
        version: text('version', 'as it was read'),
      };
    case 'link':
      return { action: 'link' };
    default:
      throw new Error('action: save, new, delete or link');
  }
}
