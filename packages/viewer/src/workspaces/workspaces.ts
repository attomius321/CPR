// Workspaces started from the commits page (V18): pure helpers for the start page and the
// line the page shows after Start.
import { landingWords } from './hive-rounds.js';
import { COMMAND_TOOLS, shownCommand } from './activity/classify.js';
import type {
  AgentEfforts,
  AgentKind,
  AgentOption,
  BranchMerge,
  BranchReviewList,
  BranchReviewSummary,
  McpVia,
  WorkspaceAgentState,
  WorkspaceStart,
  WorkspaceSummary,
  WorkspaceThread,
  PermissionMode,
  StartBranch,
  TerminalAvailability,
  ThreadEntry,
  ToolActivity,
} from '@symbiote/core';

/** Each agent's name (V20a, V58). */
export const AGENT_NAMES: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  hermes: 'Hermes',
};

/** A path as one word of a POSIX shell's command line, quoted only when it needs it. */
const shellWord = (path: string) =>
  /^[\w./:-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;

/**
 * The command that continues a workspace's agent session in a terminal (Talk): `claude attach
 * <id>`, or `codex resume <thread> -C <worktree>` (V20a, decision 133) — joined to its app
 * server with `--remote` (V27a), where its turns reach the thread —, or `hermes --resume
 * <session>`, which goes back to the session's folder (V58); null without a session.
 */
export function talkCommand(agent: WorkspaceAgentState, worktree: string): string | null {
  if (!agent.id || !agent.kind) return null;
  if (agent.kind === 'claude') return `claude attach ${agent.id}`;
  if (agent.kind === 'hermes') return `hermes --resume ${agent.id}`;
  const remote = agent.remote ? ` --remote ${shellWord(agent.remote)}` : '';
  return `codex resume ${agent.id}${remote} -C ${shellWord(worktree)}`;
}

/**
 * Whether a workspace's panel opens its agent's terminal, where terminals can run: Claude Code's
 * session (V21), Codex's thread on its app server (V27b), or the Hermes that runs there or its
 * session (V58) — Hermes working before its session is stored has no ID yet. Codex through
 * Symbiote's runner (V20a) has none: its turns there would not reach the thread.
 */
export function opensTerminal(
  agent: WorkspaceAgentState,
  terminal: TerminalAvailability | undefined,
): boolean {
  if (terminal?.available !== true) return false;
  if (agent.kind === 'hermes') return agent.id !== undefined || agent.state === 'working';
  if (agent.id === undefined) return false;
  return agent.kind === 'claude' || (agent.kind === 'codex' && agent.remote !== undefined);
}

/**
 * Whether opening the terminal asks first: `claude attach` restarts a stopped session (V21), and
 * so does a Hermes started again on its stopped session (V58); joining a stopped Codex thread
 * starts nothing.
 */
export function asksBeforeOpening(agent: WorkspaceAgentState): boolean {
  return (agent.kind === 'claude' || agent.kind === 'hermes') && agent.state === 'stopped';
}

/** The line under an agent's terminal: its way to its other sessions, or to its keys. */
export function terminalHint(agent: WorkspaceAgentState): string {
  if (agent.kind === 'hermes') return "/help in its prompt lists Hermes's commands";
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

/** A Model choice (V47): a model's ID (`''` for the agent's default), its name, its words. */
export interface ModelChoice {
  value: string;
  label: string;
  description?: string;
}

/**
 * The Model choices for an agent (V47): its default first — named when Symbiote knows it: Codex's
 * configured model, the project's (`agent.model`), Symbiote's (the merger's), not Claude Code's
 * own (decision 337) — then the models it lists, by their names. None when Symbiote could not
 * read its models.
 */
export function modelChoices(
  agent: Pick<AgentOption, 'kind' | 'models' | 'defaultModel'>,
): ModelChoice[] {
  if (!agent.models) return [];
  const known = agent.defaultModel;
  const listed = known ? agent.models.find((m) => m.id === known.id) : undefined;
  const name = listed?.name ?? known?.id;
  const label = !known
    ? `${AGENT_NAMES[agent.kind]}'s default`
    : known.by === 'agent'
      ? `${AGENT_NAMES[agent.kind]}'s default (${name})`
      : known.by === 'project'
        ? `The project's (${name})`
        : `Symbiote's default (${name})`;
  return [
    { value: '', label, ...(listed?.description ? { description: listed.description } : {}) },
    ...agent.models.map((m) => ({
      value: m.id,
      label: m.name,
      ...(m.description ? { description: m.description } : {}),
    })),
  ];
}

/** The model picked, kept when the agent lists it; else its default. */
export function keptModel(
  model: string | undefined,
  agent: Pick<AgentOption, 'models'>,
): string | undefined {
  return model && agent.models?.some((m) => m.id === model) ? model : undefined;
}

/**
 * The levels an agent takes on `model` (V47): the model's own when the agent lists it (none for
 * a model that takes none), else the agent's, its default model's.
 */
function levelsOn(
  agent: Pick<AgentOption, 'efforts' | 'models'>,
  model: string | undefined,
): AgentEfforts | undefined {
  const listed = model ? agent.models?.find((m) => m.id === model) : undefined;
  return listed ? listed.efforts : agent.efforts;
}

/**
 * The Effort choices for an agent (V30b) on the model picked (V47): its own default first —
 * named with its level when the agent says it (Codex), not otherwise (Claude Code, decision
 * 210); Symbiote's when the level is Symbiote's choice (the advisor's, V75c) — then the levels it
 * lists, in its words. None when Symbiote could not read its levels, or the model takes none.
 */
export function effortChoices(
  agent: Pick<AgentOption, 'kind' | 'efforts' | 'models'>,
  model?: string,
): { value: string; label: string }[] {
  const efforts = levelsOn(agent, model);
  if (!efforts) return [];
  const own = efforts.default ? ` (${efforts.default})` : '';
  const whose = efforts.by === 'symbiote' ? 'Symbiote' : AGENT_NAMES[agent.kind];
  return [
    { value: '', label: `${whose}'s default${own}` },
    ...efforts.levels.map((level) => ({ value: level, label: level })),
  ];
}

/** The level picked, kept when the agent picked now takes it too, on its model; else its default. */
export function keptEffort(
  effort: string | undefined,
  agent: Pick<AgentOption, 'efforts' | 'models'>,
  model?: string,
): string | undefined {
  return effort && levelsOn(agent, model)?.levels.includes(effort) ? effort : undefined;
}

/** The run's choices on the start page (V30b): kept with the draft, so leaving loses none. */
export interface RunChoices {
  agent?: AgentKind;
  /** The model picked (V47); the agent's default when absent. */
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
  planFirst?: boolean;
  /** The branch to start from (V33); the default branch when absent. */
  from?: string;
}

/**
 * The run's choices a draft kept, those that still hold: an agent still installed, a model it
 * lists and a level that model takes (V47), a permission mode Symbiote offers, a branch still
 * listed. A model and a level are kept only with their agent: they are that agent's.
 */
export function readRun(
  value: unknown,
  agents: readonly AgentOption[],
  branches: readonly StartBranch[] = [],
): RunChoices {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const named = agents.find((a) => a.kind === v.agent);
  // None picked: the page's default agent, the first, is the level's.
  const agent = named ?? (v.agent === undefined ? agents[0] : undefined);
  const model = agent && typeof v.model === 'string' ? keptModel(v.model, agent) : undefined;
  const effort =
    agent && typeof v.effort === 'string' ? keptEffort(v.effort, agent, model) : undefined;
  const mode = (Object.keys(PERMISSION_LABELS) as PermissionMode[]).find(
    (m) => m === v.permissionMode,
  );
  return {
    ...(named ? { agent: named.kind } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(mode ? { permissionMode: mode } : {}),
    ...(typeof v.planFirst === 'boolean' ? { planFirst: v.planFirst } : {}),
    ...(branches.some((b) => b.name === v.from) ? { from: v.from as string } : {}),
  };
}

/**
 * How a workspace's agent was started (V30b), for its Brief tab: the agent, its model (V47) and
 * its level. Said as a start, since its session may have changed them since (decisions 211, 341).
 */
export function startedWith(
  agent: WorkspaceAgentState,
  via?: McpVia,
  nucleus = 'Nucleus',
): string | null {
  if (!agent.kind) return null;
  const model = agent.model ? ` on ${agent.model}` : '';
  const level = agent.effort ? `${agent.effort} effort` : 'its default effort';
  const through = via ? ` through ${viaName(via, nucleus)}` : '';
  return `Started${through} with ${AGENT_NAMES[agent.kind]}${model} at ${level}.`;
}

/** The families Claude Code takes as aliases of its newest model of each (`--model opus`). */
const CLAUDE_FAMILIES = /^(opus|sonnet|haiku|fable)$/;

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * A model's name from its ID (V83, decision 661), as its agent's list names it:
 * `claude-opus-5-5` "Opus 5.5", `claude-haiku-4-5-20251001` "Haiku 4.5", `gpt-5.6-terra`
 * "GPT-5.6-Terra"; a Claude family alias by the family ("Opus"); any other ID as it is.
 */
export function modelName(id: string): string {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (claude) {
    const [, family = '', major = '', minor] = claude;
    return `${capital(family)} ${minor ? `${major}.${minor}` : major}`;
  }
  if (CLAUDE_FAMILIES.test(id)) return capital(id);
  if (/^gpt-[a-z0-9.-]+$/.test(id)) {
    return id
      .split('-')
      .map((part, i) => (i === 0 ? 'GPT' : capital(part)))
      .join('-');
  }
  return id;
}

/** A model by its name, and by its ID too when the name is more than its ID's capitals. */
const modelWords = (id: string) => {
  const name = modelName(id);
  return name.toLowerCase() === id.toLowerCase() ? name : `${name} (${id})`;
};

/** Whether a model picked at the start is the one that runs: the same, or its family's alias. */
const sameModel = (started: string, running: string) =>
  started === running ||
  modelName(started) === modelName(running) ||
  (CLAUDE_FAMILIES.test(started) && modelName(running).startsWith(`${modelName(started)} `));

/**
 * What a workspace's agent runs on (V83), for its head's chip and its card: the model by its name
 * and the level in words ("Opus 5.5 · xhigh effort"), and a tip that says whose, as of when, and
 * how it started when that differs. Before its session said it (or for an agent Symbiote does not
 * read: Codex by exec, Hermes), how it started, said as that. Null with no agent.
 */
export function runsOnWords(agent: WorkspaceAgentState): { text: string; tip: string } | null {
  const kind = agent.kind;
  if (!kind) return null;
  const name = AGENT_NAMES[kind];
  /** How it started: "Sonnet at high effort", "its default model at its default effort". */
  const startedOn = (model: (id: string) => string) =>
    `${agent.model ? model(agent.model) : 'its default model'} at ${agent.effort ? `${agent.effort} effort` : 'its default effort'}`;
  const read = agent.runsOn;
  if (!read?.model && !read?.effort) {
    const text = `${agent.model ? modelName(agent.model) : 'Default model'} · ${agent.effort ? `${agent.effort} effort` : 'default effort'}`;
    const started = `${name} started on ${startedOn(modelWords)}`;
    const reads = kind === 'claude' || (kind === 'codex' && !!agent.remote);
    return { text, tip: reads ? `${started}\nWhat it runs on shows once it answers` : started };
  }
  const level = read.effort ? `${read.effort} effort` : null;
  const text = [read.model ? modelName(read.model) : 'Default model', level]
    .filter((part) => part !== null)
    .join(' · ');
  const runs = `${name} runs on ${read.model ? modelWords(read.model) : 'its default model'}${level ? ` at ${level}` : ''}`;
  const clock = read.at
    ? new Date(read.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;
  const when = !clock
    ? null
    : kind === 'codex'
      ? `As its thread says at ${clock}`
      : `As of its answer at ${clock}`;
  const changed =
    (agent.model && read.model && !sameModel(agent.model, read.model)) ||
    (agent.effort && read.effort && agent.effort !== read.effort);
  const started = changed ? `Started on ${startedOn(modelName)}` : null;
  return { text, tip: [runs, when, started].filter((line) => line !== null).join('\n') };
}

/** What a workspace or a verdict was made through (MC1): Nucleus by `nucleus`, its name now. */
export function viaName(via: McpVia, nucleus = 'Nucleus'): string {
  return via === 'nucleus' ? nucleus : 'symbiote mcp';
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

/**
 * What a workspace needs from the person (V18b), the sidenav's groups: its agent waits for an
 * answer, its work is to look at, its agent does not run, works, or it is merged (V48).
 */
export type WorkspaceGroup = 'waiting' | 'review' | 'stopped' | 'working' | 'done';

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
  /** While it waits (V48): what it asks, from its recorded ask, else its last message. */
  blocked?: string;
  /** While it works and its tools are recorded (V48f): "Running pnpm test", "Thinking". */
  doing?: string;
  /** Hive's words (HV2): Symbiote's, so no agent's mark before them. */
  hive?: true;
}

const chip = (mark: string, tone: AgentChip['tone'], title: string): AgentChip => ({
  mark,
  tone,
  title,
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What a workspace needs next: merged, it is done; while its agent works, nothing; while it waits,
 * an answer; else — once it has commits, or its agent finished — what its review says; else its
 * agent does not run.
 */
export function workspaceNext(
  workspace: WorkspaceSummary,
  review?: BranchReviewSummary,
): WorkspaceNext {
  const next = (
    group: WorkspaceGroup,
    text: string,
    c: AgentChip['mark'],
    tone: AgentChip['tone'],
  ): WorkspaceNext => ({ group, text, chip: chip(c, tone, text) });
  const stopped = (text: string, c: AgentChip['mark'], tone: AgentChip['tone']) =>
    next('stopped', text, c, tone);
  if (workspace.tip === null) return stopped('Its branch is gone', '!', 'failed');
  if (workspace.merged) return next('done', 'Merged', '✓', 'done');
  const { agent, activity, hive } = workspace;
  const waits = (text: string): WorkspaceNext => {
    const blocked = blockedOn(workspace);
    return { ...next('waiting', text, '?', 'waiting'), ...(blocked ? { blocked } : {}) };
  };
  // Hive's steps (HV2): a turn that ended is Hive's to act on, not the person's to review; the
  // writer at work or waiting on the person reads as any workspace's.
  if (hive) {
    const finished = agent.state === 'ready' || agent.state === 'done';
    if (hive.paused && agent.state !== 'working') {
      if (hive.step === 'checking')
        return stopped('Hive off: paused before the check', '·', 'idle');
      if (hive.step === 'reviewing')
        return stopped('Hive off: paused before the review', '·', 'idle');
      if (hive.step === 'writing') return stopped('Hive off: paused', '·', 'idle');
    }
    // The round is the card's fact (2/3).
    if (!hive.paused && hive.step === 'checking') {
      return { ...next('working', 'Hive: running the check', '⚙', 'working'), hive: true };
    }
    if (!hive.paused && hive.step === 'reviewing') {
      return { ...next('working', 'Hive: reviewing', '⚙', 'working'), hive: true };
    }
    if (!hive.paused && hive.step === 'writing' && finished) {
      return { ...next('working', 'Hive: reading its turn', '⚙', 'working'), hive: true };
    }
    if (hive.step === 'stuck' && agent.state !== 'working') {
      return waits(`Hive stopped: ${hive.note ?? 'it needs you'}`);
    }
  }
  switch (agent.state) {
    case 'working': {
      const doing = activity?.doing;
      // A command's leading `cd` to the worktree left out, its paths short (V73).
      const shown =
        doing && 'tool' in doing && doing.subject && COMMAND_TOOLS.has(doing.tool)
          ? { ...doing, subject: shownCommand(doing.subject, workspace.worktree.path) }
          : doing;
      const words = !shown ? undefined : 'thinking' in shown ? 'Thinking' : activityText(shown);
      return { ...next('working', 'Working', '⚙', 'working'), ...(words ? { doing: words } : {}) };
    }
    case 'needs-you':
      if (agent.interrupted) return waits('Interrupted: waiting for you');
      return waits(`Waiting: ${agent.waitingFor ?? 'for you'}`);
    case 'plan-ready':
      return waits('Plan ready: read it and answer');
    case 'failed': {
      const why = agent.error?.split('\n')[0];
      return stopped(why ? `Its agent failed: ${why}` : 'Its agent failed', '!', 'failed');
    }
    case 'not-started':
      return stopped(`Not started: ${(agent.error ?? '').split('\n')[0] ?? ''}`, '!', 'failed');
    case 'no-agent':
      return stopped('No agent: give it the prompt', '!', 'failed');
    case 'unknown':
      return stopped(`Its agent's state is unknown: ${agent.error ?? ''}`, '·', 'idle');
    default:
      break;
  }
  if (workspace.ahead === 0) {
    // Finished without commits: its report is the work to look at (V48).
    if (agent.state === 'done' || agent.state === 'ready') {
      return next('review', 'Finished without commits', '●', 'ready');
    }
    return stopped(agent.state === 'stopped' ? 'Stopped' : 'Not running', '·', 'idle');
  }
  // Commits to look at: the review says what is next.
  const toReview = (text: string) => next('review', text, '●', 'ready');
  // Landing asked in Hive mode (HV3, decision 681): no review of the person's, Land in its Review
  // tab; once pressed, the merge queue has it.
  if (hive?.step === 'landing' && !hive.off) {
    const approved = review?.verdict?.event === 'approve' && review.verdict.head === workspace.tip;
    return toReview(approved ? 'Landing: in the merge queue' : landingWords(hive));
  }
  const since = review?.refs.find((r) => r.name === workspace.branch)?.since ?? 0;
  if (since > 0) return toReview(`${plural(since, 'commit')} since your review: review again`);
  const verdict = review?.verdict?.head === workspace.tip ? review.verdict : undefined;
  if (verdict?.event === 'approve') return toReview('Approved: ask your agent to merge it');
  if (verdict?.event === 'request-changes') {
    return toReview('Changes requested: send them to the agent');
  }
  if (verdict?.event === 'comment') return toReview('Commented: send it to the agent');
  if (review) return toReview('Review in progress');
  // Landing asked by Hive, Hive off since (HV2): the person's review, as for any workspace.
  if (hive?.step === 'landing') {
    return toReview(
      hive.note ? 'No check ran: review, check and land it' : 'Checked: review and land it',
    );
  }
  return toReview('Ready for review');
}

/**
 * What a waiting agent asks (V48): its recorded ask in the thread's words, else what it said as it
 * began to wait (Codex on its app server); none when nothing was recorded, or for a plan (its first
 * line is mostly a heading: "Plan ready" says more).
 */
function blockedOn({ activity, agent, worktree }: WorkspaceSummary): string | undefined {
  if (activity?.asks) return askedFor(activity.asks, worktree.path);
  const said = activity?.report;
  if (agent.state !== 'needs-you' || agent.interrupted || !said || !activity.since)
    return undefined;
  // A report from before the wait began is an earlier turn's, not what it asks now.
  return Date.parse(said.at) >= Date.parse(activity.since) ? said.text : undefined;
}

/** Each tool's verb (V48f): Claude Code's tools by name, Codex's items by kind. */
const TOOL_WORDS: Record<string, [verb: string, alone: string]> = {
  Bash: ['Running', 'Running a command'],
  command: ['Running', 'Running a command'],
  Edit: ['Editing', 'Editing a file'],
  MultiEdit: ['Editing', 'Editing a file'],
  NotebookEdit: ['Editing', 'Editing a notebook'],
  fileChange: ['Editing', 'Editing files'],
  Write: ['Writing', 'Writing a file'],
  Read: ['Reading', 'Reading a file'],
  Grep: ['Searching for', 'Searching'],
  Glob: ['Finding files:', 'Finding files'],
  WebFetch: ['Fetching', 'Fetching a page'],
  WebSearch: ['Searching the web:', 'Searching the web'],
  webSearch: ['Searching the web:', 'Searching the web'],
  Task: ['Running a subagent:', 'Running a subagent'],
  Agent: ['Running a subagent:', 'Running a subagent'],
  TodoWrite: ['Updating its to-do list', 'Updating its to-do list'],
};

/** A tool running, as the page says it (V48f): "Running pnpm test", "Editing src/auth.ts". */
export function activityText({ tool, subject }: ToolActivity): string {
  const words = TOOL_WORDS[tool];
  if (!words) return `Using ${subject && tool === 'mcp' ? subject : tool}`;
  const [verb, alone] = words;
  return subject && verb !== alone ? `${verb} ${subject}` : alone;
}

/** A workspace's fact (V48): its card shows it as an icon and `shown` (V79), its head says `words`. */
export interface WorkspaceFact {
  kind: 'hive' | 'commits' | 'changed' | 'gone' | 'clean' | 'conflicts';
  /** Beside its icon on the card: "3", "1 conflict". */
  shown: string;
  /** In the workspace's head, and the card's tip: "3 commits", "Conflicts with main in 1 file". */
  words: string;
}

/**
 * A workspace's facts: that Hive drives it (HV2), its commits, its files not committed, a worktree
 * gone, then whether it merges into the branch it is reviewed against (V17's check, V65); a check
 * git could not make says nothing.
 */
export function workspaceFacts(
  workspace: WorkspaceSummary,
  merge: BranchMerge | null,
): WorkspaceFact[] {
  const { ahead, worktree, hive } = workspace;
  const facts: WorkspaceFact[] = [
    // Hive drives it (HV2): first, and its round.
    ...(hive
      ? [
          hive.paused
            ? { kind: 'hive' as const, shown: 'off', words: 'Hive is off: its step waits' }
            : {
                kind: 'hive' as const,
                shown: `${hive.round}/${hive.rounds}`,
                words: `Hive drives it: round ${hive.round} of ${hive.rounds}`,
              },
        ]
      : []),
    {
      kind: 'commits',
      shown: `${ahead}`,
      words: ahead > 0 ? plural(ahead, 'commit') : 'no commits yet',
    },
  ];
  if (worktree.changed) {
    facts.push({
      kind: 'changed',
      shown: `${worktree.changed}`,
      words: `${plural(worktree.changed, 'file')} not committed yet`,
    });
  }
  if (!worktree.exists) {
    facts.push({ kind: 'gone', shown: 'worktree gone', words: 'its worktree is gone' });
  }
  if (merge && 'clean' in merge) {
    facts.push({ kind: 'clean', shown: 'clean', words: `Merges cleanly into ${merge.into}` });
  } else if (merge && 'conflicts' in merge) {
    const files = merge.conflicts.length;
    facts.push({
      kind: 'conflicts',
      shown: plural(files, 'conflict'),
      words: `Conflicts with ${merge.into} in ${plural(files, 'file')}`,
    });
  }
  return facts;
}

export interface WorkspaceRow {
  workspace: WorkspaceSummary;
  next: WorkspaceNext;
}

/** The sidenav's groups (V48), each in the order the workspaces were started. */
export interface WorkspaceGroups {
  waiting: WorkspaceRow[];
  review: WorkspaceRow[];
  stopped: WorkspaceRow[];
  working: WorkspaceRow[];
  done: WorkspaceRow[];
}

/** The workspaces view's groups, each in the order the workspaces were started. */
export function workspaceGroups(
  workspaces: readonly WorkspaceSummary[],
  reviews: BranchReviewList | null,
): WorkspaceGroups {
  const groups: WorkspaceGroups = { waiting: [], review: [], stopped: [], working: [], done: [] };
  for (const workspace of workspaces) {
    const review = reviews?.reviews.find((r) => r.branch === workspace.branch);
    const next = workspaceNext(workspace, review);
    groups[next.group].push({ workspace, next });
  }
  return groups;
}

/** Whether a workspace's card offers Clean up (V55): once it is merged, the Done group's. */
export const cleanableOnCard = (row: WorkspaceRow): boolean => row.next.group === 'done';

/** Every row of the groups, the person's first (as History's badges and V23 order them). */
export const allRows = (groups: WorkspaceGroups): WorkspaceRow[] => [
  ...groups.waiting,
  ...groups.review,
  ...groups.stopped,
  ...groups.working,
  ...groups.done,
];

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
  for (const { workspace, next } of allRows(workspaceGroups(workspaces, reviews))) {
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
  const { waiting, review, stopped, working } = workspaceGroups(workspaces, reviews);
  const newest = (rows: WorkspaceRow[]) =>
    rows
      .filter(({ workspace }) => workspace.tip !== null)
      .map(({ workspace }) => ({
        branch: workspace.branch,
        at: workspace.lastAction ?? workspace.created,
      }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.branch.localeCompare(b.branch));
  return [...newest([...waiting, ...review, ...stopped]), ...newest(working)];
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
  /** Symbiote's prompt, the agent's report, the person's message, what it waits on, or a note. */
  who: 'symbiote' | 'agent' | 'you' | 'waits' | 'line';
  at: string;
  text: string;
}

/** Tools whose permission is to change a file (`file_path` in their input). */
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * What an ask is for, in words (V48): a question and its options, or the permission to run a
 * command, to edit a file (inside the worktree, by its path there) or to use a tool.
 */
export function askedFor(entry: Extract<ThreadEntry, { kind: 'asks' }>, worktree?: string): string {
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
    return `Permission to run ${input.command}`;
  }
  if (EDITS.has(entry.tool) && typeof input.file_path === 'string') {
    const path = input.file_path;
    const inside = worktree && [`${worktree}/`, `${worktree}\\`].find((p) => path.startsWith(p));
    return `Permission to edit ${inside ? path.slice(inside.length) : path}`;
  }
  return `Permission to use ${entry.tool}`;
}

/** What an agent waits on, in the thread's words: a question and its options, or a permission. */
function waitsFor(entry: Extract<ThreadEntry, { kind: 'asks' }>, worktree?: string): string {
  const asked = askedFor(entry, worktree);
  return entry.questions ? asked : `Waiting: p${asked.slice(1)}`;
}

/**
 * A thread's entries as the panel shows them: the first prompt is Symbiote's, later ones the
 * person's messages; reports are the agent's; what it waited on in words; a session started after
 * the first as a line. Ends and Claude Code's notices are left out (the state says as much).
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
        items.push({ who: prompted ? 'you' : 'symbiote', at, text: entry.text });
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
