// The checkout's skills (V41): folders with a `SKILL.md` that tell an agent how the project does
// something; and the skill library (SK1), one folder of skills outside the checkout. Types only;
// the CLI reads and writes them and serves `/api/skills`.
import type { FileGitState } from './git/branches.js';
import type { AgentKind } from './workspaces.js';

/**
 * Where a skill is kept: the checkout's folders, Claude Code's and Codex's (decision 271); or the
 * skill library (SK1), its skills named `library/<name>/SKILL.md` (decision 429).
 */
export type SkillFolder = '.claude/skills' | '.agents/skills' | 'library';

/** A skill as the Skills page shows it. */
export interface Skill {
  folder: SkillFolder;
  /** Its folder's name, which the agents take as its name unless its `name` says otherwise. */
  name: string;
  /**
   * `<folder>/<name>/SKILL.md`, repo-relative (the library's: `library/<name>/SKILL.md`): how a
   * change names it.
   */
  path: string;
  /** `SKILL.md`'s text; absent when it is too large to edit here (`tooLarge`). */
  text?: string;
  tooLarge?: true;
  /** A hash of the text: a change made since it was read is refused. */
  version: string;
  /** The other files in its folder, relative to it, `/`-separated; `moreFiles` past the limit. */
  files: string[];
  moreFiles?: true;
  /** Its state in its repository's git; `none` in a library that is a plain folder. */
  git: FileGitState;
  /**
   * The agents that read it: its folder's, and Codex too through `.agents/skills`'s link; none for
   * the library's, which no agent reads from there.
   */
  agents: AgentKind[];
}

/**
 * Who commits the library's changes (SK1, decision 428): the person (`none`), Symbiote when asked
 * (`commit`), or Symbiote, then a push (`push`).
 */
export type LibraryCommits = 'none' | 'commit' | 'push';

/** A change in the library's folder, against its repository's last commit. */
export interface LibraryChange {
  /** Relative to the library's folder, `/`-separated. */
  path: string;
  state: 'changed' | 'new' | 'deleted';
}

/** The library's git repository, when its folder is in one. */
export interface LibraryGit {
  /** The repository's root, absolute. */
  root: string;
  /** The library's folder in it, repo-relative; empty at its root. */
  path: string;
  /** The branch checked out; absent on none (detached). */
  branch?: string;
  /** Its upstream (`origin/main`); absent without one. */
  upstream?: string;
  /** Where a push goes: the upstream's remote, else `origin`, else the first; absent with none. */
  remote?: string;
  /** Commits ahead of and behind the upstream, as git last knew it (Symbiote does not fetch). */
  ahead: number;
  behind: number;
  /** The changes in the library's folder, not committed. */
  changes: LibraryChange[];
}

/**
 * The skill library (SK1, decision 426): one folder of skills (`<folder>/<name>/SKILL.md`) outside
 * the checkout, a plain folder or one in a git repository, set on this machine in Settings.
 */
export interface LibraryState {
  /** The folder, absolute. */
  folder: string;
  /** Whether it is a folder there. */
  exists: boolean;
  commits: LibraryCommits;
  git?: LibraryGit;
  /** The folder is the checkout's own: its skills are listed once, as the checkout's. */
  checkout?: '.claude/skills' | '.agents/skills';
}

/** What is at a folder the library may be set to (`GET /api/skills/library?folder=`). */
export interface LibraryProbe {
  /** The folder, absolute, as Symbiote reads it (`~` the home). */
  folder: string;
  /** Nothing; a file; an empty folder; a folder with files. */
  kind: 'missing' | 'file' | 'empty' | 'folder';
  /** Its skills (sub-folders with a `SKILL.md`). */
  skills: number;
  /** The git repository it is in. */
  git?: { root: string; branch?: string; remote?: string };
  /** A `skills/` folder in it holding skills: what a clone's library becomes. */
  skillsFolder?: number;
  /** Why it cannot be the library (not absolute, a file). */
  problem?: string;
}

/** `GET /api/skills`, and what a change answers. */
export interface SkillsState {
  /** The checkout `symbiote view` runs in. */
  checkout: string;
  /** Claude Code's folder first, then Codex's own, then the library's; each by name. */
  skills: Skill[];
  /** The skill library (SK1); absent when none is set. */
  library?: LibraryState;
  /**
   * Codex and `.agents/skills` (decision 272): `linked`, a link to `.claude/skills`; `folder`, a
   * folder of its own; `none`. `canLink`: Link for Codex can make the link here, else `reason`.
   */
  codex: {
    installed: boolean;
    link: 'linked' | 'folder' | 'none';
    canLink: boolean;
    reason?: string;
    /** The link's git state, once it is there. */
    git?: FileGitState;
  };
}

/** `POST /api/skills`: a change to the checkout's skills, or to the library (SK1). */
export type SkillChange =
  | { action: 'save'; path: string; text: string; version: string }
  /**
   * A new skill in `.claude/skills/<name>/`, or the library's (`where`), its frontmatter written
   * from these.
   */
  | { action: 'new'; name: string; description: string; where?: 'library' }
  | { action: 'delete'; path: string; version: string }
  /** `.agents/skills` made a link to `../.claude/skills`. */
  | { action: 'link' }
  /**
   * The library set (SK1): `folder`, made when `create`; or `url` cloned into `folder`, the library
   * then its `skills/` when it has one. Its `commits` setting.
   */
  | { action: 'library'; folder: string; url?: string; create?: boolean; commits: LibraryCommits }
  /** No library: nothing on disk is deleted. */
  | { action: 'forget' }
  /** The library's changes committed (then pushed, with `push`), with the person's message. */
  | { action: 'commit'; message: string }
  /** The library's branch pushed; its upstream pulled, fast-forward only. */
  | { action: 'push' }
  | { action: 'pull' };
