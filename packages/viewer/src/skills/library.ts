// The skill library (SK1) as the Skills page and Settings say it: its name, where a skill of it
// is, its git in words, a commit's first message, and what is at a folder before it is set there.
// Pure: the server reads and writes the library.
import type { LibraryChange, LibraryGit, LibraryProbe, LibraryState, Skill } from '@symbiote/core';

const lastOf = (path: string) =>
  path
    .split('/')
    .filter((part) => part !== '')
    .at(-1) ?? path;

/** The library's short name: its repository's folder and the path in it, else its own folder's. */
export function libraryName(library: LibraryState): string {
  const { git } = library;
  if (!git) return lastOf(library.folder);
  return git.path === '' ? lastOf(git.root) : `${lastOf(git.root)}/${git.path}`;
}

/** Where a skill is, as the page shows it: a checkout's repo-relative, a library's in full. */
export function skillPlace(skill: Skill, library: LibraryState | undefined): string {
  if (skill.folder !== 'library' || !library) return skill.path;
  return `${library.folder}/${skill.name}/SKILL.md`;
}

/** The library's git in words, or that its folder is not there. */
export function libraryGitText(library: LibraryState): string {
  if (!library.exists) return `${library.folder} is not there: set another folder in Settings.`;
  const { git } = library;
  if (!git) return 'A plain folder: no git.';
  const where = `In the git repository ${git.root}`;
  if (!git.branch) return `${where}, on no branch.`;
  return `${where}, on ${git.branch}, ${git.upstream ? `tracking ${git.upstream}` : 'with no upstream'}.`;
}

const commits = (count: number) => `${count} commit${count === 1 ? '' : 's'}`;

/** How far the library's branch is from its upstream; empty when even. */
export function librarySync(git: LibraryGit): string {
  const parts = [
    ...(git.ahead > 0 ? [`${commits(git.ahead)} to push`] : []),
    ...(git.behind > 0 ? [`${git.ahead > 0 ? git.behind : commits(git.behind)} to pull`] : []),
  ];
  // Behind is what the last fetch saw: Symbiote does not fetch to show it.
  return parts.join(' · ') + (git.behind > 0 ? ', as git last knew' : '');
}

/** A commit's first message: the skills (a change's first folder) its changes are in. */
export function commitMessage(changes: readonly LibraryChange[]): string {
  const names = [...new Set(changes.map((change) => change.path.split('/')[0] ?? change.path))];
  names.sort();
  if (names.length === 0) return 'Skills';
  if (names.length <= 3) return `Skills: ${names.join(', ')}`;
  return `Skills: ${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

/** What Save does at a folder: set it, make it, clone into it; null when it cannot. */
export type ProbeSave = 'set' | 'create' | 'clone' | null;

/** What is at a folder, in words, and what Save would do there (`clone`: a URL is given). */
export function probeText(
  probe: LibraryProbe,
  clone: boolean,
): { text: string; save: ProbeSave; error?: true } {
  if (probe.problem) return { text: probe.problem, save: null, error: true };
  if (clone) {
    if (probe.kind === 'missing') {
      return { text: 'Nothing there yet: the repository is cloned into it.', save: 'clone' };
    }
    if (probe.kind === 'empty') {
      return { text: 'An empty folder: the repository is cloned into it.', save: 'clone' };
    }
    return { text: 'It holds files: clone into a new or empty folder.', save: null, error: true };
  }
  if (probe.kind === 'missing')
    return { text: 'Nothing there yet: Save makes the folder.', save: 'create' };
  const where = probe.git
    ? `, in the git repository ${probe.git.root}, on ${probe.git.branch ?? 'no branch'}.`
    : probe.kind === 'empty'
      ? ': no git.'
      : ': a plain folder, no git.';
  const what =
    probe.kind === 'empty'
      ? 'An empty folder'
      : probe.skills === 0
        ? 'No skills here'
        : `${probe.skills} skill${probe.skills === 1 ? '' : 's'}`;
  const nested = probe.skillsFolder
    ? ` Its skills folder holds ${probe.skillsFolder}: give ${probe.folder}/skills to use those.`
    : '';
  return { text: `${what}${where}${nested}`, save: 'set' };
}
