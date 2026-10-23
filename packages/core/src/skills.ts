// The checkout's skills (V41): folders with a `SKILL.md` that tell an agent how the project does
// something. Types only; the CLI reads and writes them and serves `/api/skills`.
import type { FileGitState } from './git/branches.js';
import type { AgentKind } from './workspaces.js';

/** Where a checkout keeps skills: Claude Code's folder, and Codex's (decision 271). */
export type SkillFolder = '.claude/skills' | '.agents/skills';

/** A skill as the Skills page shows it. */
export interface Skill {
  folder: SkillFolder;
  /** Its folder's name, which the agents take as its name unless its `name` says otherwise. */
  name: string;
  /** `<folder>/<name>/SKILL.md`, repo-relative: how a change names it. */
  path: string;
  /** `SKILL.md`'s text; absent when it is too large to edit here (`tooLarge`). */
  text?: string;
  tooLarge?: true;
  /** A hash of the text: a change made since it was read is refused. */
  version: string;
  /** The other files in its folder, relative to it, `/`-separated; `moreFiles` past the limit. */
  files: string[];
  moreFiles?: true;
  git: FileGitState;
  /** The agents that read it: its folder's, and Codex too through `.agents/skills`'s link. */
  agents: AgentKind[];
}

/** `GET /api/skills`, and what a change answers. */
export interface SkillsState {
  /** The checkout `symbiote view` runs in. */
  checkout: string;
  /** Claude Code's folder first, then Codex's own; each by name. */
  skills: Skill[];
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

/** `POST /api/skills`: a change to the checkout's skills. */
export type SkillChange =
  | { action: 'save'; path: string; text: string; version: string }
  /** A new skill in `.claude/skills/<name>/`, its frontmatter written from these. */
  | { action: 'new'; name: string; description: string }
  | { action: 'delete'; path: string; version: string }
  /** `.agents/skills` made a link to `../.claude/skills`. */
  | { action: 'link' };
