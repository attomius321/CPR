// The agent on the start page (V20a, V30b, V47): which one, its account, the model and the level
// its session starts on, and Claude Code's permission mode or Codex's sandbox. Since V63 each is a card of the run's, as the person's mockup draws them.
import type { ReactNode } from 'react';
import type { AgentKind, AgentOption, PermissionMode } from '@symbiote/core';
import { ClaudeMark, CodexMark } from '../ui/icons.js';
import { EffortSegments } from './EffortSegments.js';
import { StartCard } from './StartCard.js';
import { AGENT_NAMES } from './workspaces.js';
import {
  keptEffort,
  PERMISSION_LABELS,
  PERMISSION_WORDS,
  type effortChoices,
  type modelChoices,
  type RunChoices,
} from './run-choices.js';
import { tip } from '../ui/tip.js';

/** The run's choices at `level`, or at the agent's own level without one. */
function atLevel(run: RunChoices, level: string | undefined): RunChoices {
  const next = { ...run };
  delete next.effort;
  return level ? { ...next, effort: level } : next;
}

/** The run's choices on `model` (V47), or on the agent's default without one. */
function onModel(run: RunChoices, model: string | undefined): RunChoices {
  const next = { ...run };
  delete next.model;
  return model ? { ...next, model } : next;
}

/** An agent's mark (V53), before its name in the Agent card. */
function AgentMark({ kind }: { kind: AgentKind }) {
  return kind === 'codex' ? <CodexMark /> : <ClaudeMark />;
}

/**
 * The agent's cards, `agent` picked among `agents` (none: what is made without one); each change
 * is the run's choices given to `onChoose`.
 */
export function StartAgent({
  agents,
  hive = false,
  agent,
  run,
  mode,
  model,
  models,
  effort,
  efforts,
  onChoose,
  planFirst,
}: {
  agents: AgentOption[];
  /** Hive mode is on (HV2): Hive drives the workspace, with Claude Code only. */
  hive?: boolean;
  agent: AgentOption | null;
  run: RunChoices;
  mode: PermissionMode;
  /** The model picked, while the agent lists it; its level and their choices are that model's. */
  model: string | undefined;
  models: ReturnType<typeof modelChoices>;
  effort: string | undefined;
  efforts: ReturnType<typeof effortChoices>;
  onChoose: (run: RunChoices) => void;
  /** Plan first's row, at the card's foot (V93, proof 06). */
  planFirst?: ReactNode;
}) {
  if (!agent && hive) {
    return (
      <StartCard title="Agent">
        <p className="error start-card-note">
          Hive drives Claude Code, which is not installed here (<code>claude</code> on PATH, or{' '}
          <code>SYMBIOTE_CLAUDE</code>): turn Hive off to start without it.
        </p>
      </StartCard>
    );
  }
  if (!agent) {
    return (
      <StartCard title="Agent">
        <p className="start-card-note">
          No agent found (Claude Code: <code>claude</code> on PATH, or <code>SYMBIOTE_CLAUDE</code>;
          Codex: <code>codex</code> on PATH, or <code>SYMBIOTE_CODEX</code>): the branch and its
          worktree are made, and you get the prompt to give an agent.
        </p>
      </StartCard>
    );
  }
  const described = models.find((m) => m.value === (model ?? ''))?.description;
  // The agent's card (V93, decision 883; proof 06-start): its rows, the effort as a segmented
  // control, Plan first at its foot; its account at the head's end.
  return (
    <section className="start-card start-agent">
      <div className="card-head">
        <h2>Agent</h2>
        {agent.account && (
          <span className="end start-account" {...tip(agent.account)}>
            {agent.account}
          </span>
        )}
      </div>
      <div className="start-rows">
        {agents.length > 1 ? (
          <>
            <label htmlFor="start-agent">Agent</label>
            <div className="start-select">
              <AgentMark kind={agent.kind} />
              <select
                id="start-agent"
                value={agent.kind}
                {...tip(agent.command, { code: true })}
                onChange={(event) => {
                  const kind = event.target.value as AgentKind;
                  const next = agents.find((a) => a.kind === kind);
                  // A model is one agent's: the other starts on its default (V47). A level
                  // its default model takes stays; else its default.
                  const kept = next ? keptEffort(run.effort, next) : undefined;
                  onChoose(atLevel(onModel({ ...run, agent: kind }, undefined), kept));
                }}
              >
                {agents.map((a) => (
                  <option key={a.kind} value={a.kind}>
                    {AGENT_NAMES[a.kind]}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <span className="start-row-name">Agent</span>
            <span className="start-value" {...tip(agent.command, { code: true })}>
              <AgentMark kind={agent.kind} />
              {AGENT_NAMES[agent.kind]}
            </span>
          </>
        )}
        {models.length > 0 && (
          <>
            <label htmlFor="start-model">Model</label>
            <select
              id="start-model"
              value={model ?? ''}
              {...tip(
                described ??
                  `The model its session starts on, from ${AGENT_NAMES[agent.kind]}'s own list; change it later in its terminal (/model)`,
              )}
              onChange={(event) => {
                const next = event.target.value || undefined;
                // A level the new model takes stays; else its default.
                const kept = keptEffort(run.effort, agent, next);
                onChoose(atLevel(onModel(run, next), kept));
              }}
            >
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </>
        )}
        {agent.kind === 'claude' ? (
          <>
            <label htmlFor="start-permission">Permissions</label>
            <select
              id="start-permission"
              value={mode}
              {...tip(PERMISSION_WORDS[mode])}
              onChange={(event) =>
                onChoose({ ...run, permissionMode: event.target.value as PermissionMode })
              }
            >
              {(Object.keys(PERMISSION_LABELS) as PermissionMode[]).map((m) => (
                <option key={m} value={m}>
                  {PERMISSION_LABELS[m]}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <span className="start-row-name">Sandbox</span>
            <span
              className="start-value"
              {...tip(
                "Codex's workspace-write sandbox: it writes in its worktree and may commit on its branch; nothing else in git.",
              )}
            >
              Its worktree and branch
            </span>
          </>
        )}
      </div>
      {efforts.length > 0 && (
        <div className="start-effort">
          <span className="start-effort-name" id="start-effort-label">
            Effort
          </span>
          <EffortSegments
            label="Effort"
            choices={efforts}
            value={effort ?? ''}
            onChange={(level) => onChoose(atLevel(run, level || undefined))}
          />
        </div>
      )}
      {agent.apiKey && (
        <p className="error start-card-note">
          ANTHROPIC_API_KEY is set where symbiote view runs: the agent may use that key instead of{' '}
          {agent.account ?? 'your account'}.
        </p>
      )}
      {planFirst}
    </section>
  );
}

/**
 * The agent's rows in Hive mode (V92, decision 871): in the Where and who card, Claude Code and
 * the model and level its session starts on, as selects; no permissions (Hive's, 773).
 */
export function StartAgentRows({
  agent,
  run,
  model,
  models,
  effort,
  efforts,
  onChoose,
}: {
  agent: AgentOption;
  run: RunChoices;
  model: string | undefined;
  models: ReturnType<typeof modelChoices>;
  effort: string | undefined;
  efforts: ReturnType<typeof effortChoices>;
  onChoose: (run: RunChoices) => void;
}) {
  // Rows of the Where and who card's grid (V93: its name, then its control).
  return (
    <>
      <span className="start-row-name">Agent</span>
      <span className="start-value" {...tip(agent.command, { code: true })}>
        <AgentMark kind={agent.kind} />
        {AGENT_NAMES[agent.kind]}
      </span>
      {agent.apiKey && (
        <p className="error start-row-note">
          ANTHROPIC_API_KEY is set where symbiote view runs: the agent may use that key instead of{' '}
          {agent.account ?? 'your account'}.
        </p>
      )}
      {models.length > 0 && (
        <>
          <label htmlFor="start-model">Model</label>
          <select
            id="start-model"
            value={model ?? ''}
            onChange={(event) => {
              const next = event.target.value || undefined;
              const kept = keptEffort(run.effort, agent, next);
              onChoose(atLevel(onModel(run, next), kept));
            }}
          >
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </>
      )}
      {efforts.length > 0 && (
        <>
          <label htmlFor="start-effort">Effort</label>
          <select
            id="start-effort"
            value={effort ?? ''}
            onChange={(event) => onChoose(atLevel(run, event.target.value || undefined))}
          >
            {efforts.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </>
      )}
    </>
  );
}
