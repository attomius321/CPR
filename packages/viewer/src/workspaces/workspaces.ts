// Workspaces' names (V18): each agent's name, how an agent's session opens in a terminal, a
// workspace's name, its brief's tip and its address.
import type {
  AgentKind,
  WorkspaceAgentState,
  WorkspaceSummary,
  TerminalAvailability,
} from '@symbiote/core';

/** Each agent's name (V20a). */
export const AGENT_NAMES: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

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
 * session (V21) or Codex's thread on its app server (V27b). Codex through
 * Symbiote's runner (V20a) has none: its turns there would not reach the thread.
 */
export function opensTerminal(
  agent: WorkspaceAgentState,
  terminal: TerminalAvailability | undefined,
): boolean {
  if (terminal?.available !== true) return false;
  if (agent.id === undefined) return false;
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

/**
 * A workspace's name: its title (V24), else its brief's first line, else its branch; a finished
 * one's too (V77).
 */
export function workspaceName(
  workspace: Pick<WorkspaceSummary, 'title' | 'brief' | 'branch'>,
): string {
  const first = workspace.brief.trim().split('\n')[0]?.trim();
  return workspace.title ?? (first || workspace.branch);
}

/** How much of a brief's words its tooltip says, after its first line. */
const BRIEF_TIP = 240;

/**
 * A brief as its tooltip says it (V54): its first line as the head, then its words as one
 * paragraph, cut at `BRIEF_TIP` characters; without Markdown's marks (headings, emphasis, code).
 */
export function briefTip(brief: string): string {
  const lines = brief
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const plain = (line: string) => line.replace(/^#{1,6}\s+/, '').replace(/\*\*|__|`/g, '');
  const [first = '', ...rest] = lines;
  // Section headings ("## Goal") say nothing inside one paragraph.
  const words = rest
    .filter((line) => !/^#{1,6}\s/.test(line))
    .map(plain)
    .join(' ');
  const said = words.length > BRIEF_TIP ? `${words.slice(0, BRIEF_TIP).trimEnd()}…` : words;
  return said ? `${plain(first)}\n${said}` : plain(first);
}

/** A link to a workspace's row in the workspaces view. */
export const workspaceHref = (branch: string) => `/?branch=${encodeURIComponent(branch)}`;

/** How long ago, in a few characters: `now`, `4m`, `2h`, `3d`. */
export function shortAge(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
