// Features started from the commits page (V18): pure helpers for the start dialog and the
// line the page shows after Start.
import type { FeatureStart, PermissionMode } from '@cpr/core';

/** The permission modes the dialog offers, as it names them. */
export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: "Claude Code's default",
  acceptEdits: 'Accept edits',
  auto: 'Auto',
};

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

/** What the page says once a feature is made, and the prompt to copy when no agent took it. */
export function startedNotice({ feature, prompt }: FeatureStart): {
  text: string;
  warning?: string;
  copy?: string;
} {
  const where = feature.worktree.path;
  const { agent } = feature;
  if (agent.state === 'no-agent') {
    return {
      text: `Made ${feature.branch} in ${where}. No agent was found to start: give it the prompt.`,
      copy: prompt,
    };
  }
  if (agent.state === 'not-started') {
    return {
      text: `Made ${feature.branch} in ${where}, but Claude Code did not start.`,
      ...(agent.error ? { warning: agent.error } : {}),
      copy: prompt,
    };
  }
  return { text: `Started ${feature.branch}: Claude Code is working in ${where}.` };
}
