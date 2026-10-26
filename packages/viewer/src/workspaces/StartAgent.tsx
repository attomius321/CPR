// The agent on the start page (V20a, V30b, V47): which one, its account, the model and the level
// its session starts on, and Claude Code's permission mode, Codex's sandbox or where Hermes asks
// (V58). Since V63 each is a card of the run's, as the person's mockup draws them.
import type { AgentKind, AgentOption, PermissionMode } from '@symbiote/core';
import { Help } from '../ui/Help.js';
import {
  AgentIcon,
  ClaudeMark,
  CodexMark,
  EffortIcon,
  HermesMark,
  ModelIcon,
  PermissionIcon,
  SubscriptionIcon,
} from '../ui/icons.js';
import { EffortStepper } from './EffortStepper.js';
import { StartCard } from './StartCard.js';
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

/** An agent's mark (V53), before its name in the Agent card. */
function AgentMark({ kind }: { kind: AgentKind }) {
  return kind === 'codex' ? <CodexMark /> : kind === 'hermes' ? <HermesMark /> : <ClaudeMark />;
}

/**
 * The agent's cards, `agent` picked among `agents` (none: what is made without one); each change
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
  if (!agent) {
    return (
      <StartCard icon={<AgentIcon />} title="Agent">
        <p className="start-card-note">
          No agent found (Claude Code: <code>claude</code> on PATH, or <code>SYMBIOTE_CLAUDE</code>;
          Codex: <code>codex</code> on PATH, or <code>SYMBIOTE_CODEX</code>; Hermes:{' '}
          <code>hermes</code> on PATH, or <code>SYMBIOTE_HERMES</code>, where terminals run): the
          branch and its worktree are made, and you get the prompt to give an agent.
        </p>
      </StartCard>
    );
  }
  const described = models.find((m) => m.value === (model ?? ''))?.description;
  return (
    <>
      <StartCard icon={<AgentIcon />} title="Agent">
        <div className="workspace-field start-row">
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
          {agent.account && (
            <p className="start-row-note start-account">
              {/subscription/.test(agent.account) && <SubscriptionIcon />}
              {agent.account}
            </p>
          )}
        </div>
        {agent.apiKey && (
          <p className="error start-card-note">
            ANTHROPIC_API_KEY is set where symbiote view runs: the agent may use that key instead of{' '}
            {agent.account ?? 'your account'}.
          </p>
        )}
      </StartCard>
      {models.length > 0 && (
        <StartCard
          icon={<ModelIcon />}
          title={<label htmlFor="start-model">Model</label>}
          help={
            <Help label="About the model">
              The model its session starts on, from {AGENT_NAMES[agent.kind]}&apos;s own list;
              change it later in its terminal (<code>/model</code>).
            </Help>
          }
          control={
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
          }
        >
          {described && <p className="start-card-note start-model-note">{described}</p>}
        </StartCard>
      )}
      {efforts.length > 0 && (
        <StartCard
          icon={<EffortIcon />}
          title="Effort"
          className="start-effort"
          help={
            <Help label="About the effort">
              The level its session starts at; change it later in its terminal.
            </Help>
          }
        >
          <EffortStepper
            label="Effort"
            choices={efforts}
            value={effort ?? ''}
            onChange={(level) => onChoose(atLevel(run, level || undefined))}
          />
        </StartCard>
      )}
      {agent.kind === 'claude' ? (
        <StartCard
          icon={<PermissionIcon />}
          title={<label htmlFor="start-permission">Permissions</label>}
          control={
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
          }
        />
      ) : agent.kind === 'hermes' ? (
        <StartCard
          icon={<PermissionIcon />}
          title="Approvals"
          help={
            <Help label="About Hermes's approvals">
              Hermes runs in a terminal in Symbiote, in its worktree, with your Hermes configuration
              (its model, provider and tools). It asks there before a dangerous command; Symbiote
              does not answer for you, and its card says Working while it waits. It stops when
              Symbiote quits; its terminal then continues the session.
            </Help>
          }
          control={<span className="start-value">In its terminal</span>}
        />
      ) : (
        <StartCard
          icon={<PermissionIcon />}
          title="Sandbox"
          help={
            <Help label="About Codex's sandbox">
              Codex&apos;s workspace-write sandbox: it writes in its worktree and may commit on its
              branch; nothing else in git. Codex then marks this repository trusted in your Codex
              configuration, as it does for any writable sandbox.
            </Help>
          }
          control={<span className="start-value">Its worktree and branch</span>}
        />
      )}
    </>
  );
}
