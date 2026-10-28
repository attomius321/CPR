// What the agent is doing now, for the Activity tab's live strip (V73, decision 516): from its
// state and its newest call not ended this turn — never a progress guessed. Elapsed from that
// call's recorded start; none for Codex's untimed items.
import type { WorkspaceSummary } from '@symbiote/core';
import { activityText, askedFor } from '../workspaces.js';
import { COMMAND_TOOLS, shownCommand } from './classify.js';
import type { ActivityEvent, ToolCall } from './events.js';
import { questionsOf, waitingAsk, type ActivityGroup, type GroupKind } from './groups.js';

export interface LiveActivity {
  /** `working`: a call runs; `thinking`: none does; `waiting`: on the person. */
  state: 'working' | 'thinking' | 'waiting';
  /** The phase the running call is in: "Testing". */
  phase?: string;
  /** That phase's kind (V74): the strip takes its colour. */
  kind?: GroupKind;
  /** The agent's words for it, else what it is: "Run the full check", "Reading src/a.ts". */
  text: string;
  /** A command, written short. */
  command?: string;
  /** Since when, when it was recorded. */
  since?: string;
}

const lineAt = (call: ToolCall) => Date.parse((call.start ?? call.end)?.at ?? '') || 0;
const firstLine = (text: string) =>
  (text.split('\n').find((line) => line.trim() !== '') ?? '').trim();

/** What the agent of `workspace` is doing now, from its events and their groups; null when it is not at work or waiting. */
export function liveActivity(
  workspace: WorkspaceSummary,
  events: readonly ActivityEvent[],
  groups: readonly ActivityGroup[],
): LiveActivity | null {
  const { agent } = workspace;
  const prompt = events.findLast((e) => e.kind === 'prompt');
  if (agent.state === 'needs-you') {
    if (agent.interrupted) return { state: 'waiting', text: 'Interrupted: waiting for you' };
    const asks = waitingAsk(events);
    if (asks) {
      const text = asks.entry.questions
        ? `Asks: ${questionsOf(asks.entry)}`
        : askedFor(asks.entry, workspace.worktree.path);
      return { state: 'waiting', text, since: asks.entry.at };
    }
    return { state: 'waiting', text: `Waiting: ${agent.waitingFor ?? 'for you'}` };
  }
  if (agent.state === 'plan-ready') {
    return { state: 'waiting', text: 'Plan ready: read it and answer' };
  }
  if (agent.state !== 'working') return null;

  const turn = prompt?.at ? Date.parse(prompt.at) : -Infinity;
  const calls = events
    .filter((e): e is Extract<ActivityEvent, { kind: 'call' }> => e.kind === 'call')
    .map((e) => e.call)
    .filter((call) => lineAt(call) >= turn);
  const open = calls.filter((call) => !call.end).at(-1);
  if (open && open.tool !== 'reasoning') {
    const phase = groups.find((g) => g.events.some((e) => e.kind === 'call' && e.call === open));
    const command = COMMAND_TOOLS.has(open.tool)
      ? firstLine(shownCommand(open.input ?? open.subject ?? '', workspace.worktree.path))
      : undefined;
    const text =
      open.about ??
      (command
        ? `Running ${command}`
        : activityText({ tool: open.tool, ...(open.subject ? { subject: open.subject } : {}) }));
    return {
      state: 'working',
      ...(phase && !phase.milestone ? { phase: phase.title, kind: phase.kind } : {}),
      text,
      ...(command ? { command } : {}),
      ...(open.startedAt ? { since: open.startedAt } : {}),
    };
  }
  const ended = calls
    .flatMap((call) => (call.endedAt ? [call.endedAt] : []))
    .sort()
    .at(-1);
  const since = ended ?? prompt?.at;
  return { state: 'thinking', text: 'Thinking', ...(since ? { since } : {}) };
}
