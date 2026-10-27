// The checkout's skills (V41): `.claude/skills/<name>/SKILL.md`, Claude Code's, and
// `.agents/skills/<name>/SKILL.md`, Codex's (decision 271), as the Skills page lists, saves, adds
// and deletes them; and `.agents/skills` made a link to `.claude/skills`, so Codex reads Claude
// Code's (decision 272). Written in place, as Settings writes `symbiote/config.json`: the person
// commits them. Nothing outside the two folders is written, but in the skill library (SK1,
// `library.ts`): its skills are listed after the checkout's, named `library/<name>/SKILL.md`
// (decision 429), and changed there in the same way.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import {
  fileGitState,
  openRepo,
  type AgentKind,
  type FileGitState,
  type GitRepo,
  type LibraryProbe,
  type LibraryState,
  type Skill,
  type SkillChange,
  type SkillFolder,
  type SkillsState,
} from '@symbiote/core';
import type { OpenFolder } from './editor.js';
import type { LibraryService } from './library.js';

export const CLAUDE_SKILLS = '.claude/skills';
export const CODEX_SKILLS = '.agents/skills';
/** How a change names the library's skills: `library/<name>/SKILL.md` (decision 429). */
export const LIBRARY = 'library';

/** The longest `SKILL.md` the page edits; a longer one is listed by name only. */
export const MAX_SKILL = 256 * 1024;
/** Most of a skill's other files listed. */
const MAX_FILES = 200;
/** The standard's limits (agentskills.io): a name, and a description. */
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
/** Folders Claude Code keeps for itself among skills (synced from claude.ai, its own). */
const RESERVED = new Set(['synced', 'anthropic-skills']);

/** A change the skills cannot take, or VS Code not opening one (502): its status and why. */
export class SkillRefused extends Error {
  override name = 'SkillRefused';
  constructor(
    message: string,
    readonly status: 400 | 409 | 502,
  ) {
    super(message);
  }
}

/** The Skills page's server (`/api/skills`). */
export interface SkillsService {
  state(): Promise<SkillsState>;
  /** Makes a change, and answers the skills as they are after it. */
  change(change: SkillChange): Promise<SkillsState>;
  /** What is at a folder the library may be set to (SK1). */
  probe(folder: string): Promise<LibraryProbe>;
  /** Opens a skill's `SKILL.md` in VS Code (V64); refused (502) with why when it does not. */
  open(request: SkillOpen): Promise<{ opened: true }>;
}

/** `POST /api/skills/open` (V64): a skill by its path, at a line (1 when none). */
export interface SkillOpen {
  path: string;
  line?: number;
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

/**
 * The checkout's skills, for the Skills page; Codex's install found by `codexInstalled`; the
 * library's after them when one is set (`library`, SK1).
 */
export function skillsService(
  repo: GitRepo,
  {
    codexInstalled,
    platform = process.platform,
    library,
    openFolder,
  }: {
    codexInstalled: () => Promise<boolean>;
    platform?: NodeJS.Platform;
    library?: LibraryService;
    /** VS Code (V64): a checkout's skill opens in the checkout's window, a library's in its own. */
    openFolder?: OpenFolder;
  },
): SkillsService {
  const root = repo.root;

  /** The skills in `dir`, named `<folder>/<name>/SKILL.md`, their git state from `gitOf`. */
  async function list(
    dir: string,
    folder: SkillFolder,
    agents: AgentKind[],
    gitOf: (name: string) => Promise<FileGitState>,
  ): Promise<Skill[]> {
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
        git: await gitOf(name),
        agents,
      });
    }
    return skills;
  }

  /** The checkout's skills in `folder`, their git state the checkout's. */
  const checkoutSkills = (folder: SkillFolder & `.${string}`, agents: AgentKind[]) =>
    list(join(root, folder), folder, agents, (name) =>
      fileGitState(repo, `${folder}/${name}/SKILL.md`),
    );

  /** The library and its skills: none when it is not there, or is the checkout's own folder. */
  async function libraryOf(): Promise<{ state: LibraryState; skills: Skill[] } | null> {
    const state = await library?.state();
    if (!state) return null;
    const own = [CLAUDE_SKILLS, CODEX_SKILLS].find(
      (folder) => existsAt(join(root, folder)) && real(join(root, folder)) === real(state.folder),
    ) as (typeof CLAUDE_SKILLS | typeof CODEX_SKILLS) | undefined;
    if (own) return { state: { ...state, checkout: own }, skills: [] };
    if (!state.exists) return { state, skills: [] };
    const held = state.git;
    const gitRepo = held ? await openRepo(held.root) : null;
    const skills = await list(state.folder, LIBRARY, [], (name) =>
      gitRepo && held
        ? fileGitState(gitRepo, `${held.path ? `${held.path}/` : ''}${name}/SKILL.md`)
        : Promise.resolve('none'),
    );
    return { state, skills };
  }

  async function state(): Promise<SkillsState> {
    const link = codexLink(root);
    const own = await libraryOf();
    const skills = [
      ...(await checkoutSkills(
        CLAUDE_SKILLS,
        link === 'linked' ? ['claude', 'codex'] : ['claude'],
      )),
      ...(link === 'folder' ? await checkoutSkills(CODEX_SKILLS, ['codex']) : []),
      ...(own?.skills ?? []),
    ];
    const windows = platform === 'win32';
    return {
      checkout: root,
      skills,
      ...(own ? { library: own.state } : {}),
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

  /** The library's folder, refused (409) without one. */
  function libraryFolder(): string {
    const folder = library?.setting()?.folder;
    if (!folder) throw new SkillRefused('No skill library is set: set one in Settings', 409);
    return folder;
  }

  /**
   * The skill a change names: `<folder>/<name>/SKILL.md` in one of the two folders, or
   * `library/<name>/SKILL.md` in the library's; its folder's real path inside the folder's (a link
   * out is the person's to change where it is).
   */
  function skillAt(path: string): { dir: string; file: string } {
    const match = /^(\.claude\/skills|\.agents\/skills|library)\/([^/\\\0]+)\/SKILL\.md$/.exec(
      path,
    );
    const folder = match?.[1];
    const name = match?.[2];
    if (!folder || !name || name === '.' || name === '..') {
      throw new SkillRefused(
        `not a skill: ${path} (a skill is .claude/skills/<name>/SKILL.md)`,
        400,
      );
    }
    const base = folder === LIBRARY ? libraryFolder() : join(root, folder);
    const shown = folder === LIBRARY ? base : folder;
    const dir = join(base, name);
    if (!within(real(dir), real(base))) {
      throw new SkillRefused(
        `${shown}/${name} is a link out of ${shown}: change it where it is`,
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
        const base = change.where === LIBRARY ? libraryFolder() : join(root, CLAUDE_SKILLS);
        const dir = join(base, change.name);
        if (existsAt(dir)) {
          const shown = change.where === LIBRARY ? base : CLAUDE_SKILLS;
          throw new SkillRefused(`${shown}/${change.name} is there already`, 409);
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
      case 'library':
        return needLibrary().set(change);
      case 'forget':
        return needLibrary().forget();
      case 'commit':
        return needLibrary().commit(change.message);
      case 'push':
        return needLibrary().push();
      case 'pull':
        return needLibrary().pull();
    }
  }

  /** The library's service; a server without one refuses its changes. */
  function needLibrary(): LibraryService {
    if (!library) throw new SkillRefused('This server keeps no skill library', 409);
    return library;
  }

  /** A skill's `SKILL.md` in VS Code: the checkout's window, or the library's folder's (V64). */
  async function open({ path, line = 1 }: SkillOpen): Promise<{ opened: true }> {
    const { file } = skillAt(path);
    if (!isFile(file)) throw new SkillRefused(`${path} is not there`, 400);
    if (!openFolder) throw new SkillRefused('VS Code opens files from symbiote view', 502);
    const inLibrary = path.startsWith(`${LIBRARY}/`);
    const opened = await openFolder(inLibrary ? libraryFolder() : root, {
      file: inLibrary ? path.slice(LIBRARY.length + 1) : path,
      line,
      column: 1,
    });
    if (!opened.opened) throw new SkillRefused(opened.message, 502);
    return { opened: true };
  }

  // One change at a time: each reads what it changes.
  let changing: Promise<unknown> = Promise.resolve();
  return {
    state,
    probe: (folder) => needLibrary().probe(folder),
    open,
    async change(change) {
      const next = changing.then(() => apply(change));
      changing = next.catch(() => undefined);
      await next;
      return state();
    },
  };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function existsAt(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** `POST /api/skills/open`'s body (V64), checked: throws with what is wrong. */
export function parseSkillOpen(body: string): SkillOpen {
  const value = JSON.parse(body) as unknown;
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if (typeof v.path !== 'string') throw new Error("path: the skill's SKILL.md");
  if (v.line !== undefined && !(Number.isInteger(v.line) && (v.line as number) >= 1)) {
    throw new Error('line: a line from 1');
  }
  return { path: v.path, ...(typeof v.line === 'number' ? { line: v.line } : {}) };
}

const COMMITS = ['none', 'commit', 'push'] as const;

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
    case 'new': {
      if (v.where !== undefined && v.where !== LIBRARY) {
        throw new Error('where: library, or none for the checkout');
      }
      return {
        action: 'new',
        name: text('name', "the skill's name"),
        description: text('description', 'what it does and when to use it'),
        ...(v.where === LIBRARY ? { where: LIBRARY } : {}),
      };
    }
    case 'delete':
      return {
        action: 'delete',
        path: text('path', "the skill's SKILL.md"),
        version: text('version', 'as it was read'),
      };
    case 'link':
      return { action: 'link' };
    case 'library': {
      const commits = COMMITS.find((c) => c === v.commits);
      if (!commits) throw new Error('commits: none, commit or push');
      if (v.url !== undefined && typeof v.url !== 'string') throw new Error('url: a git URL');
      if (v.create !== undefined && typeof v.create !== 'boolean') {
        throw new Error('create: true to make the folder');
      }
      return {
        action: 'library',
        folder: text('folder', "the library's folder"),
        ...(typeof v.url === 'string' ? { url: v.url } : {}),
        ...(v.create === true ? { create: true } : {}),
        commits,
      };
    }
    case 'forget':
    case 'push':
    case 'pull':
      return { action: v.action };
    case 'commit':
      return { action: 'commit', message: text('message', "the commit's message") };
    default:
      throw new Error('action: save, new, delete, link, library, forget, commit, push or pull');
  }
}
