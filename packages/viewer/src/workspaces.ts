// Workspaces started from the commits page (V18): pure helpers for the start page and the
// line the page shows after Start.
import type {
  AgentKind,
  AgentOption,
  BranchReviewList,
  BranchReviewSummary,
  WorkspaceAgentState,
  WorkspaceStart,
  WorkspaceSummary,
  WorkspaceThread,
  PermissionMode,
  TerminalAvailability,
  ThreadEntry,
} from '@cpr/core';

/** Each agent's name (V20a). */
export const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' };

/** A path as one word of a POSIX shell's command line, quoted only when it needs it. */
const shellWord = (path: string) =>
  /^[\w./:-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;

/**
 * The command that continues a workspace's agent session in a terminal (Talk): `claude attach
 * <id>`, or `codex resume <thread> -C <worktree>` (V20a, decision 133) — joined to its app
 * server with `--remote` (V27a), where its turns reach the thread; null without a session.
 */
export function talkCommand(agent: WorkspaceAgentState, worktree: string): string | null {
  if (!agent.id || !agent.kind) return null;
  if (agent.kind === 'claude') return `claude attach ${agent.id}`;
  const remote = agent.remote ? ` --remote ${shellWord(agent.remote)}` : '';
  return `codex resume ${agent.id}${remote} -C ${shellWord(worktree)}`;
}

/**
 * Whether a workspace's panel opens its agent's terminal, where terminals can run: Claude Code's
 * session (V21), or Codex's thread on its app server (V27b). Codex through CPR's runner (V20a)
 * has none: its turns there would not reach the thread.
 */
export function opensTerminal(
  agent: WorkspaceAgentState,
  terminal: TerminalAvailability | undefined,
): boolean {
  if (terminal?.available !== true || agent.id === undefined) return false;
  return agent.kind === 'claude' || (agent.kind === 'codex' && agent.remote !== undefined);
}

/**
 * Whether opening the terminal asks first: `claude attach` restarts a stopped session (V21);
 * joining a stopped Codex thread starts nothing.
 */
export function asksBeforeOpening(agent: WorkspaceAgentState): boolean {
  return agent.kind === 'claude' && agent.state === 'stopped';
}

/** The line under an agent's terminal: its way to its other sessions, or to its keys. */
export function terminalHint(agent: WorkspaceAgentState): string {
  return agent.kind === 'codex'
    ? "? in an empty prompt lists Codex's keys"
    : '← in an empty prompt lists all your agents';
}

/** The permission modes the start page offers, as it names them. */
export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: "Claude Code's default",
  acceptEdits: 'Accept edits',
  auto: 'Auto',
};

/**
 * The start page's Effort choices for an agent (V30b): its own default first — named with its
 * level when the agent says it (Codex), not otherwise (Claude Code, decision 210) — then the
 * levels it lists, in its words. None when CPR could not read its levels.
 */
export function effortChoices(agent: AgentOption): { value: string; label: string }[] {
  if (!agent.efforts) return [];
  const own = agent.efforts.default ? ` (${agent.efforts.default})` : '';
  return [
    { value: '', label: `${AGENT_NAMES[agent.kind]}'s default${own}` },
    ...agent.efforts.levels.map((level) => ({ value: level, label: level })),
  ];
}

/** The level picked, kept when the agent picked now takes it too; else its default. */
export function keptEffort(effort: string | undefined, agent: AgentOption): string | undefined {
  return effort && agent.efforts?.levels.includes(effort) ? effort : undefined;
}

/** The run's choices on the start page (V30b): kept with the draft, so leaving loses none. */
export interface RunChoices {
  agent?: AgentKind;
  effort?: string;
  permissionMode?: PermissionMode;
  planFirst?: boolean;
}

/**
 * The run's choices a draft kept, those that still hold: an agent still installed, a level it
 * lists, a permission mode CPR offers. A level is kept only with its agent: it is that agent's.
 */
export function readRun(value: unknown, agents: readonly AgentOption[]): RunChoices {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const named = agents.find((a) => a.kind === v.agent);
  // None picked: the page's default agent, the first, is the level's.
  const agent = named ?? (v.agent === undefined ? agents[0] : undefined);
  const effort = agent && typeof v.effort === 'string' ? keptEffort(v.effort, agent) : undefined;
  const mode = (Object.keys(PERMISSION_LABELS) as PermissionMode[]).find(
    (m) => m === v.permissionMode,
  );
  return {
    ...(named ? { agent: named.kind } : {}),
    ...(effort ? { effort } : {}),
    ...(mode ? { permissionMode: mode } : {}),
    ...(typeof v.planFirst === 'boolean' ? { planFirst: v.planFirst } : {}),
  };
}

/**
 * How a workspace's agent was started (V30b), for its Brief tab: the agent and its level. Said as
 * a start, since its session may have changed the level since (decision 211).
 */
export function startedWith(agent: WorkspaceAgentState): string | null {
  if (!agent.kind) return null;
  const level = agent.effort ? `${agent.effort} effort` : 'its default effort';
  return `Started with ${AGENT_NAMES[agent.kind]} at ${level}.`;
}

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

/** What a workspace needs from the person (V18b): the workspaces view's groups. */
export type WorkspaceGroup = 'needs-you' | 'working' | 'done';

/** A workspace's mark on its branch's badges and in the workspaces view. */
export interface AgentChip {
  mark: string;
  tone: 'working' | 'waiting' | 'ready' | 'failed' | 'idle' | 'done';
  title: string;
}

export interface WorkspaceNext {
  group: WorkspaceGroup;
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
 * What a workspace needs next: merged, it is done; while its agent works, nothing; else what the
 * agent waits for, or — once it has commits — what its review says.
 */
export function workspaceNext(
  workspace: WorkspaceSummary,
  review?: BranchReviewSummary,
): WorkspaceNext {
  const needs = (text: string, c: AgentChip['mark'], tone: AgentChip['tone']): WorkspaceNext => ({
    group: 'needs-you',
    text,
    chip: chip(c, tone, text),
  });
  if (workspace.tip === null) return needs('Its branch is gone', '!', 'failed');
  if (workspace.merged) return { group: 'done', text: 'Merged', chip: chip('✓', 'done', 'Merged') };
  const { agent } = workspace;
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
  if (workspace.ahead === 0) {
    const text =
      agent.state === 'stopped'
        ? 'Stopped'
        : agent.state === 'not-running'
          ? 'Not running'
          : 'Finished without commits';
    return needs(text, '·', 'idle');
  }
  // Commits to look at: the review says what is next.
  const since = review?.refs.find((r) => r.name === workspace.branch)?.since ?? 0;
  if (since > 0)
    return needs(`${plural(since, 'commit')} since your review: review again`, '●', 'ready');
  const verdict = review?.verdict?.head === workspace.tip ? review.verdict : undefined;
  if (verdict?.event === 'approve')
    return needs('Approved: ask your agent to merge it', '●', 'ready');
  if (verdict?.event === 'request-changes') {
    return needs('Changes requested: send them to the agent', '●', 'ready');
  }
  if (verdict?.event === 'comment') return needs('Commented: send it to the agent', '●', 'ready');
  return needs(review ? 'Review in progress' : 'Ready for review', '●', 'ready');
}

export interface WorkspaceRow {
  workspace: WorkspaceSummary;
  next: WorkspaceNext;
}

/** The workspaces view's groups, each in the order the workspaces were started. */
export function workspaceGroups(
  workspaces: readonly WorkspaceSummary[],
  reviews: BranchReviewList | null,
): { needsYou: WorkspaceRow[]; working: WorkspaceRow[]; done: WorkspaceRow[] } {
  const groups = {
    needsYou: [] as WorkspaceRow[],
    working: [] as WorkspaceRow[],
    done: [] as WorkspaceRow[],
  };
  for (const workspace of workspaces) {
    const review = reviews?.reviews.find((r) => r.branch === workspace.branch);
    const next = workspaceNext(workspace, review);
    const key = next.group === 'needs-you' ? 'needsYou' : next.group;
    groups[key].push({ workspace, next });
  }
  return groups;
}

/** A workspace's name: its title (V24), else its brief's first line, else its branch. */
export function workspaceName(workspace: WorkspaceSummary): string {
  const first = workspace.brief.trim().split('\n')[0]?.trim();
  return workspace.title ?? (first || workspace.branch);
}

/** A link to a workspace's row in the workspaces view. */
export const workspaceHref = (branch: string) => `/?branch=${encodeURIComponent(branch)}`;

/**
 * Each open workspace's mark by ref name — its branch, and that branch on each remote once pushed
 * (`remotes`: the remote branches and the branch each is) — titled with the workspace's name and
 * what is next, linking to the workspace. A branch that is gone has none.
 */
export function workspaceChips(
  workspaces: readonly WorkspaceSummary[],
  reviews: BranchReviewList | null,
  remotes: readonly { name: string; branch: string }[],
): Map<string, AgentChip & { href: string }> {
  const chips = new Map<string, AgentChip & { href: string }>();
  for (const { workspace, next } of Object.values(workspaceGroups(workspaces, reviews)).flat()) {
    if (workspace.tip === null) continue;
    const value = {
      ...next.chip,
      title: `Workspace: ${workspaceName(workspace)} — ${next.text}`,
      href: workspaceHref(workspace.branch),
    };
    chips.set(workspace.branch, value);
    for (const remote of remotes)
      if (remote.branch === workspace.branch) chips.set(remote.name, value);
  }
  return chips;
}

/** A workspace's branch, listed first in the branches panel, and when its agent last acted. */
export interface FirstBranch {
  branch: string;
  at: string;
}

/**
 * The branches the branches panel lists first (V23): the open workspaces that need the person,
 * then those whose agent works, each by its agent's last action (else when the workspace was made),
 * newest first. Merged workspaces and gone branches need nothing: they are left out.
 */
export function workspacesFirst(
  workspaces: readonly WorkspaceSummary[],
  reviews: BranchReviewList | null,
): FirstBranch[] {
  const { needsYou, working } = workspaceGroups(workspaces, reviews);
  const newest = (rows: WorkspaceRow[]) =>
    rows
      .filter(({ workspace }) => workspace.tip !== null)
      .map(({ workspace }) => ({
        branch: workspace.branch,
        at: workspace.lastAction ?? workspace.created,
      }))
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

/** One line of a workspace's thread as its panel shows it (V18c). */
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
 * How a message reaches the agent: sent (its turn ended, or it stopped; Codex on its app server
 * while it works, the message joining its turn, V27a), sent once its turn is stopped (it works,
 * or waits on a prompt), or not at all (no session to continue).
 */
export function replyMode(agent: WorkspaceAgentState): 'send' | 'stop-and-send' | 'none' {
  switch (agent.state) {
    case 'working':
      return agent.remote ? 'send' : 'stop-and-send';
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
export function verdictToSend(thread: WorkspaceThread | null): WorkspaceThread['verdict'] | null {
  const verdict = thread?.verdict;
  if (!verdict) return null;
  const last = thread.entries.findLast((e) => e.kind === 'prompt');
  return !last || verdict.at > last.at ? verdict : null;
}
