import type { Project } from '@cpr/core';

/**
 * The project holding a repo-relative path: the one with the longest folder that holds it, as the
 * graph schema says. None when the graph lists no projects.
 */
export function projectOf(path: string, projects: readonly Project[]): Project | undefined {
  let best: Project | undefined;
  for (const project of projects) {
    const { folder } = project;
    const holds = folder === '' || path === folder || path.startsWith(`${folder}/`);
    if (holds && (!best || folder.length > best.folder.length)) best = project;
  }
  return best;
}

/** A path as seen from its project: `apps/web/src/main.ts` in `apps/web` is `src/main.ts`. */
export function pathInProject(path: string, project: Project): string {
  return project.folder === '' ? path : path.slice(project.folder.length + 1);
}
