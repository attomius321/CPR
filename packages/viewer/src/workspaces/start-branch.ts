// A start's branch (V18): named after the title until edited, why a name cannot be one, and what
// the status bar says once it started.
import type { WorkspaceStart } from '@symbiote/core';
import { AGENT_NAMES } from './workspaces.js';

/** Longest name proposed after the prefix. */
const MAX_NAME = 40;

/**
 * A branch named after the brief's first line: its first five words, lowercase, accents and
 * apostrophes dropped, joined by `-`, at most 40 characters; numbered (`-2`) when taken.
 */
export function proposeBranch(brief: string, prefix: string, taken: ReadonlySet<string>): string {
  const words = (brief.trim().split('\n')[0] ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '')
    .slice(0, 5);
  let name = '';
  for (const word of words) {
    const next = name ? `${name}-${word}` : word;
    if (next.length > MAX_NAME) break;
    name = next;
  }
  const base = `${prefix}${name || words[0]?.slice(0, MAX_NAME) || 'new'}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Why `name` cannot be a new branch, by git's rules for branch names (`git check-ref-format
 * --branch`), or because it is taken; null when it can. The server checks again with git.
 */
export function branchProblem(name: string, taken: ReadonlySet<string>): string | null {
  if (name === '') return 'a branch needs a name';
  if (name.startsWith('-')) return 'a branch name cannot start with -';
  const parts = name.split('/');
  const invalid =
    name === '@' ||
    /[\s~^:?*[\\]/.test(name) ||
    [...name].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f) ||
    name.includes('..') ||
    name.includes('@{') ||
    name.endsWith('.') ||
    parts.some((p) => p === '' || p.startsWith('.') || p.endsWith('.lock'));
  if (invalid) return `not a valid branch name: ${name}`;
  return taken.has(name) ? `a branch ${name} exists` : null;
}

/** What the page says once a workspace is made, and the prompt to copy when no agent took it. */
export function startedNotice({ workspace, prompt }: WorkspaceStart): {
  text: string;
  warning?: string;
  copy?: string;
} {
  const where = workspace.worktree.path;
  const { agent } = workspace;
  if (agent.state === 'no-agent') {
    return {
      text: `Made ${workspace.branch} in ${where}. No agent was found to start: give it the prompt.`,
      copy: prompt,
    };
  }
  const name = AGENT_NAMES[agent.kind ?? 'claude'];
  if (agent.state === 'not-started') {
    return {
      text: `Made ${workspace.branch} in ${where}, but ${name} did not start.`,
      ...(agent.error ? { warning: agent.error } : {}),
      copy: prompt,
    };
  }
  return { text: `Started ${workspace.branch}: ${name} is working in ${where}.` };
}
