// Features started from the commits page (V18): pure helpers for the start dialog and the
// line the page shows after Start.
import type {
  AgentKind,
  BranchReviewList,
  BranchReviewSummary,
  FeatureAgentState,
  FeatureStart,
  FeatureSummary,
  FeatureThread,
  PermissionMode,
  ThreadEntry,
} from '@cpr/core';

/** Each agent's name (V20a). */
export const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' };

/** A path as one word of a POSIX shell's command line, quoted only when it needs it. */
const shellWord = (path: string) =>
  /^[\w./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;

/**
 * The command that continues a feature's agent session in a terminal (Talk): `claude attach
 * <id>`, or `codex resume <thread> -C <worktree>` (V20a, decision 133); null without a session.
 */
export function talkCommand(agent: FeatureAgentState, worktree: string): string | null {
  if (!agent.id || !agent.kind) return null;
  return agent.kind === 'codex'
    ? `codex resume ${agent.id} -C ${shellWord(worktree)}`
    : `claude attach ${agent.id}`;
}

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
  const name = AGENT_NAMES[agent.kind ?? 'claude'];
  if (agent.state === 'not-started') {
    return {
      text: `Made ${feature.branch} in ${where}, but ${name} did not start.`,
      ...(agent.error ? { warning: agent.error } : {}),
      copy: prompt,
    };
  }
  return { text: `Started ${feature.branch}: ${name} is working in ${where}.` };
}

/** What a feature needs from the person (V18b): the features view's groups. */
export type FeatureGroup = 'needs-you' | 'working' | 'done';

/** A feature's mark on its branch's badges and in the features view. */
export interface AgentChip {
  mark: string;
  tone: 'working' | 'waiting' | 'ready' | 'failed' | 'idle' | 'done';
  title: string;
}

export interface FeatureNext {
  group: FeatureGroup;
  /** What is next, in a few words: "Plan ready: read it and answer". */
  text: string;
  chip: AgentChip;
}

const chip = (mark: string, tone: AgentChip['tone'], title: string): AgentChip => ({
  mark,
  tone,
  title,
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What a feature needs next: merged, it is done; while its agent works, nothing; else what the
 * agent waits for, or — once it has commits — what its review says.
 */
export function featureNext(feature: FeatureSummary, review?: BranchReviewSummary): FeatureNext {
  const needs = (text: string, c: AgentChip['mark'], tone: AgentChip['tone']): FeatureNext => ({
    group: 'needs-you',
    text,
    chip: chip(c, tone, text),
  });
  if (feature.tip === null) return needs('Its branch is gone', '!', 'failed');
  if (feature.merged) return { group: 'done', text: 'Merged', chip: chip('✓', 'done', 'Merged') };
  const { agent } = feature;
  switch (agent.state) {
    case 'working':
      return { group: 'working', text: 'Working', chip: chip('⚙', 'working', 'Working') };
    case 'needs-you':
      if (agent.interrupted) return needs('Interrupted: waiting for you', '?', 'waiting');
      return needs(`Waiting: ${agent.waitingFor ?? 'for you'}`, '?', 'waiting');
    case 'plan-ready':
      return needs('Plan ready: read it and answer', '?', 'waiting');
    case 'failed': {
      const why = agent.error?.split('\n')[0];
      return needs(why ? `Its agent failed: ${why}` : 'Its agent failed', '!', 'failed');
    }
    case 'not-started':
      return needs(`Not started: ${(agent.error ?? '').split('\n')[0] ?? ''}`, '!', 'failed');
    case 'no-agent':
      return needs('No agent: give it the prompt', '!', 'failed');
    case 'unknown':
      return needs(`Its agent's state is unknown: ${agent.error ?? ''}`, '·', 'idle');
    default:
      break;
  }
  if (feature.ahead === 0) {
    const text =
      agent.state === 'stopped'
        ? 'Stopped'
        : agent.state === 'not-running'
          ? 'Not running'
          : 'Finished without commits';
    return needs(text, '·', 'idle');
  }
  // Commits to look at: the review says what is next.
  const since = review?.refs.find((r) => r.name === feature.branch)?.since ?? 0;
  if (since > 0)
    return needs(`${plural(since, 'commit')} since your review: review again`, '●', 'ready');
  const verdict = review?.verdict?.head === feature.tip ? review.verdict : undefined;
  if (verdict?.event === 'approve')
    return needs('Approved: ask your agent to merge it', '●', 'ready');
  if (verdict?.event === 'request-changes') {
    return needs('Changes requested: send them to the agent', '●', 'ready');
  }
  if (verdict?.event === 'comment') return needs('Commented: send it to the agent', '●', 'ready');
  return needs(review ? 'Review in progress' : 'Ready for review', '●', 'ready');
}

export interface FeatureRow {
  feature: FeatureSummary;
  next: FeatureNext;
}

/** The features view's groups, each in the order the features were started. */
export function featureGroups(
  features: readonly FeatureSummary[],
  reviews: BranchReviewList | null,
): { needsYou: FeatureRow[]; working: FeatureRow[]; done: FeatureRow[] } {
  const groups = {
    needsYou: [] as FeatureRow[],
    working: [] as FeatureRow[],
    done: [] as FeatureRow[],
  };
  for (const feature of features) {
    const review = reviews?.reviews.find((r) => r.branch === feature.branch);
    const next = featureNext(feature, review);
    const key = next.group === 'needs-you' ? 'needsYou' : next.group;
    groups[key].push({ feature, next });
  }
  return groups;
}

/** A workspace's name: its title (V24), else its brief's first line, else its branch. */
export function featureName(feature: FeatureSummary): string {
  const first = feature.brief.trim().split('\n')[0]?.trim();
  return feature.title ?? (first || feature.branch);
}

/** A link to a feature's row in the features view. */
export const featureHref = (branch: string) => `/workspaces?branch=${encodeURIComponent(branch)}`;

/**
 * Each open feature's mark by ref name — its branch, and that branch on each remote once pushed
 * (`remotes`: the remote branches and the branch each is) — titled with the workspace's name and
 * what is next, linking to the feature. A branch that is gone has none.
 */
export function featureChips(
  features: readonly FeatureSummary[],
  reviews: BranchReviewList | null,
  remotes: readonly { name: string; branch: string }[],
): Map<string, AgentChip & { href: string }> {
  const chips = new Map<string, AgentChip & { href: string }>();
  for (const { feature, next } of Object.values(featureGroups(features, reviews)).flat()) {
    if (feature.tip === null) continue;
    const value = {
      ...next.chip,
      title: `Workspace: ${featureName(feature)} — ${next.text}`,
      href: featureHref(feature.branch),
    };
    chips.set(feature.branch, value);
    for (const remote of remotes)
      if (remote.branch === feature.branch) chips.set(remote.name, value);
  }
  return chips;
}

/** A feature's branch, listed first in the branches panel, and when its agent last acted. */
export interface FirstBranch {
  branch: string;
  at: string;
}

/**
 * The branches the branches panel lists first (V23): the open features that need the person,
 * then those whose agent works, each by its agent's last action (else when the feature was made),
 * newest first. Merged features and gone branches need nothing: they are left out.
 */
export function featuresFirst(
  features: readonly FeatureSummary[],
  reviews: BranchReviewList | null,
): FirstBranch[] {
  const { needsYou, working } = featureGroups(features, reviews);
  const newest = (rows: FeatureRow[]) =>
    rows
      .filter(({ feature }) => feature.tip !== null)
      .map(({ feature }) => ({ branch: feature.branch, at: feature.lastAction ?? feature.created }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.branch.localeCompare(b.branch));
  return [...newest(needsYou), ...newest(working)];
}

/** How long ago, in a few characters: `now`, `4m`, `2h`, `3d`. */
export function shortAge(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** One line of a feature's thread as its panel shows it (V18c). */
export interface ThreadItem {
  /** CPR's prompt, the agent's report, the person's message, what it waits on, or a note. */
  who: 'cpr' | 'agent' | 'you' | 'waits' | 'line';
  at: string;
  text: string;
}

/** Tools whose permission is to change a file (`file_path` in their input). */
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** What an agent waits on, in words: a question and its options, or a permission. */
function waitsFor(entry: Extract<ThreadEntry, { kind: 'asks' }>, worktree?: string): string {
  if (entry.questions) {
    const asked = entry.questions.map((q) =>
      q.options.length > 0 ? `${q.question} — ${q.options.join(' · ')}` : q.question,
    );
    return `Asks: ${asked.join('; ')}`;
  }
  let input: { command?: unknown; file_path?: unknown } = {};
  try {
    input = (JSON.parse(entry.input ?? '') as typeof input | null) ?? {};
  } catch {
    // Cut at 4 KB, or not JSON: only the tool is shown.
  }
  if (entry.tool === 'Bash' && typeof input.command === 'string') {
    return `Waiting: permission to run ${input.command}`;
  }
  if (EDITS.has(entry.tool) && typeof input.file_path === 'string') {
    const path = input.file_path;
    const inside = worktree && [`${worktree}/`, `${worktree}\\`].find((p) => path.startsWith(p));
    return `Waiting: permission to edit ${inside ? path.slice(inside.length) : path}`;
  }
  return `Waiting: permission to use ${entry.tool}`;
}

/**
 * A thread's entries as the panel shows them: the first prompt is CPR's, later ones the person's
 * messages; reports are the agent's; what it waited on in words; a session started after the
 * first as a line. Ends and Claude Code's notices are left out (the state says as much).
 */
export function threadItems(entries: readonly ThreadEntry[], worktree?: string): ThreadItem[] {
  const items: ThreadItem[] = [];
  let started = false;
  let prompted = false;
  for (const entry of entries) {
    const { at } = entry;
    switch (entry.kind) {
      case 'start':
        if (started) {
          const text =
            entry.source === 'resume'
              ? 'Continued'
              : entry.source === 'fork'
                ? 'A copy of the session started'
                : 'Started again';
          items.push({ who: 'line', at, text });
        }
        started = true;
        break;
      case 'prompt':
        items.push({ who: prompted ? 'you' : 'cpr', at, text: entry.text });
        prompted = true;
        break;
      case 'report':
        items.push({ who: 'agent', at, text: entry.text });
        break;
      case 'asks':
        items.push({ who: 'waits', at, text: waitsFor(entry, worktree) });
        break;
      default:
        break;
    }
  }
  return items;
}

/**
 * How a message reaches the agent: sent (its turn ended, or it stopped), sent once its turn is
 * stopped (it works, or waits on a prompt), or not at all (no session to continue).
 */
export function replyMode(agent: FeatureAgentState): 'send' | 'stop-and-send' | 'none' {
  switch (agent.state) {
    case 'working':
      return 'stop-and-send';
    case 'needs-you':
      return agent.waitingFor ? 'stop-and-send' : 'send';
    case 'plan-ready':
    case 'ready':
    case 'done':
    case 'stopped':
    case 'failed':
      return 'send';
    default:
      return 'none';
  }
}

/** The review's last verdict, when it is newer than the last message the agent got. */
export function verdictToSend(thread: FeatureThread | null): FeatureThread['verdict'] | null {
  const verdict = thread?.verdict;
  if (!verdict) return null;
  const last = thread.entries.findLast((e) => e.kind === 'prompt');
  return !last || verdict.at > last.at ? verdict : null;
}
