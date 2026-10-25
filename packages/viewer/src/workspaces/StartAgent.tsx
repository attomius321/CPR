// The agent on the start page (V20a, V30b, V47): which one, its account, the model and the level
// its session starts on, and Claude Code's permission mode or Codex's sandbox.
import type { AgentKind, AgentOption, PermissionMode } from '@symbiote/core';
import { Help } from '../ui/Help.js';
import { EffortStepper } from './EffortStepper.js';
import {
  AGENT_NAMES,
  keptEffort,
  PERMISSION_LABELS,
  type effortChoices,
  type modelChoices,
  type RunChoices,
} from './workspaces.js';
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

/**
 * The agent's fields, `agent` picked among `agents` (none: what is made without one); each change
 * is the run's choices given to `onChoose`.
 */
export function StartAgent({
  agents,
  agent,
  run,
  mode,
  model,
  models,
  effort,
  efforts,
  onChoose,
}: {
  agents: AgentOption[];
  agent: AgentOption | null;
  run: RunChoices;
  mode: PermissionMode;
  /** The model picked, while the agent lists it; its level and their choices are that model's. */
  model: string | undefined;
  models: ReturnType<typeof modelChoices>;
  effort: string | undefined;
  efforts: ReturnType<typeof effortChoices>;
  onChoose: (run: RunChoices) => void;
}) {
  const described = models.find((m) => m.value === (model ?? ''))?.description;
  return agent ? (
    <>
      {agents.length > 1 ? (
        <div className="workspace-field">
          <label htmlFor="start-agent">Agent</label>
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
          {agent.account && <p className="dialog-note start-account">{agent.account}</p>}
        </div>
      ) : (
        <div className="workspace-field">
          Agent
          <span className="start-value" {...tip(agent.command, { code: true })}>
            {AGENT_NAMES[agent.kind]}
          </span>
          {agent.account && <p className="dialog-note start-account">{agent.account}</p>}
        </div>
      )}
      {models.length > 0 && (
        <div className="workspace-field">
          <span className="field-label">
            <label htmlFor="start-model">Model</label>
            <Help label="About the model">
              The model its session starts on, from {AGENT_NAMES[agent.kind]}&apos;s own list;
              change it later in its terminal (<code>/model</code>).
            </Help>
          </span>
          <select
            id="start-model"
            value={model ?? ''}
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
          {described && <p className="dialog-note start-model-note">{described}</p>}
        </div>
      )}
      {efforts.length > 0 && (
        <div className="workspace-field start-effort">
          <span className="field-label">
            Effort
            <Help label="About the effort">
              The level its session starts at; change it later in its terminal.
            </Help>
          </span>
          <EffortStepper
            label="Effort"
            choices={efforts}
            value={effort ?? ''}
            onChange={(level) => onChoose(atLevel(run, level || undefined))}
          />
        </div>
      )}
      {agent.kind === 'claude' ? (
        <div className="workspace-field">
          <label htmlFor="start-permission">Permission</label>
          <select
            id="start-permission"
            value={mode}
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
        </div>
      ) : (
        <div className="workspace-field">
          <span className="field-label">
            Sandbox
            <Help label="About Codex's sandbox">
              Codex&apos;s workspace-write sandbox: it writes in its worktree and may commit on its
              branch; nothing else in git. Codex then marks this repository trusted in your Codex
              configuration, as it does for any writable sandbox.
            </Help>
          </span>
          <span className="start-value">Its worktree and branch</span>
        </div>
      )}
    </>
  ) : (
    <p className="dialog-note">
      No agent found (Claude Code: <code>claude</code> on PATH, or <code>SYMBIOTE_CLAUDE</code>;
      Codex: <code>codex</code> on PATH, or <code>SYMBIOTE_CODEX</code>): the branch and its
      worktree are made, and you get the prompt to give an agent.
    </p>
  );
}
