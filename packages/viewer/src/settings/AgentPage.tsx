// A prebuilt agent's page in Settings (V51): its Model and Effort as rows, then its prompts; Suggest
// settings' page (V75c), the advisor's on each agent.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentLevels } from '@symbiote/core';
import { EffortStepper } from '../workspaces/EffortStepper.js';
import { Help } from '../ui/Help.js';
import { getJson, postJson } from '../ui/http.js';
import { AGENT_NAMES } from '../workspaces/workspaces.js';
import { effortChoices, keptEffort, keptModel, modelChoices } from '../workspaces/run-choices.js';
import { SettingsCard } from './SettingsCard.js';
import { ADVISING, ADVISOR, type AgentSettings } from './agent-settings.js';

/**
 * A prebuilt agent's page (fix/scout-merger-scribe-settings): its Model and its Effort as rows
 * (V51), then its prompts (`children`), a section each, in one card (V62).
 */
export function AgentPage({
  name,
  settings,
  onSaved,
  onBack,
  rows,
  levels,
  children,
}: {
  /** Its name: Nucleus's, Alpha Ceph while Hive mode is on (decision 682). */
  name: string;
  settings: AgentSettings;
  onSaved: () => void;
  onBack: () => void;
  /** Its own rows under the Model and Effort: Nucleus's start without a Confirm (NU8). */
  rows?: ReactNode;
  /** In place of its Model and Effort: where they are set (the reviewer's, V92). */
  levels?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsCard label={name} title={name} onBack={onBack}>
      {levels ?? <AgentRows settings={settings} onSaved={onSaved} />}
      {rows}
      {children}
    </SettingsCard>
  );
}

/**
 * Suggest settings' page (V75c, decision 556): the advisor's Model and Effort on Claude Code and
 * on Codex, a section each, since it runs on the agent picked on the Start page; then its
 * instructions (`children`).
 */
export function AdvisorPage({
  onSaved,
  onBack,
  children,
}: {
  onSaved: () => void;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <SettingsCard
      label="Workspaces: Suggest settings"
      title="Workspaces: Suggest settings"
      onBack={onBack}
    >
      {ADVISING.map((kind) => (
        <section key={kind} className="settings-advisor" aria-label={AGENT_NAMES[kind]}>
          <h3>{AGENT_NAMES[kind]}</h3>
          <AgentRows settings={ADVISOR[kind]} heading="h4" onSaved={onSaved} />
        </section>
      ))}
      {children}
    </SettingsCard>
  );
}

/**
 * An agent's Model and Effort as rows (V51). Its models and levels are read once for both: a model
 * saved answers with its own levels, and the Effort follows it.
 */
function AgentRows({
  settings,
  heading = 'h3',
  onSaved,
}: {
  settings: AgentSettings;
  /** The rows' names: headings under the card's, or under an agent's on Suggest settings'. */
  heading?: 'h3' | 'h4';
  /** After a save: the config file changed. */
  onSaved: () => void;
}) {
  const [read, setRead] = useState<AgentLevels | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    getJson<AgentLevels>(`${settings.api}/efforts`)
      .then((answer) => {
        if (current) setRead(answer);
      })
      .catch((failed: unknown) => {
        if (current) {
          setError(
            `${settings.whose} models and levels could not be read: ${(failed as Error).message}`,
          );
        }
      });
    return () => {
      current = false;
    };
  }, [settings]);
  const saved = (answer: AgentLevels) => {
    setRead(answer);
    onSaved();
  };

  // Its agent: Nucleus's and Scribe's (`agent.kind`'s, else Claude Code), the merger's, the
  // advisor's on that agent.
  const agent = read?.agents[0];
  return (
    <>
      {error && (
        <p className="settings-warning" role="alert">
          {error}
        </p>
      )}
      {read && !agent && (
        <p className="settings-warning" role="alert">
          {settings.missing ??
            `${settings.who} needs Claude Code or Codex: neither is installed here.`}
        </p>
      )}
      {(!read || agent) && (
        <div className="settings-rows">
          <AgentModel settings={settings} heading={heading} read={read} onSaved={saved} />
          <AgentEffort
            // Drawn again on another model: its levels, and the level kept on them, are that model's.
            key={read ? `on ${read.model ?? ''}` : 'reading'}
            settings={settings}
            heading={heading}
            read={read}
            onSaved={saved}
          />
        </div>
      )}
    </>
  );
}

/**
 * A prebuilt agent's effort in the project's config, on a stepper of its agent's levels, saved
 * when the handle is let go: `nucleus.effort` and `scribe.effort`, the level each of their
 * conversations starts at (fix/scout-effort-level, fix/scribe-effort-level); `merge.effort`, the
 * level each merger agent's run is asked at (V46d).
 */
function AgentEffort({
  settings,
  heading: Heading,
  read,
  onSaved,
}: {
  settings: AgentSettings;
  heading: 'h3' | 'h4';
  /** The agent's models and levels, null while they are read. */
  read: AgentLevels | null;
  onSaved: (answer: AgentLevels) => void;
}) {
  const { effort: setting } = settings;
  const agent = read?.agents[0];
  const [level, setLevel] = useState(() =>
    read && agent ? (keptEffort(read.effort, agent) ?? '') : '',
  );
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  // One save after another, in the order they were made.
  const saving = useRef<Promise<void>>(Promise.resolve());

  const name = agent ? AGENT_NAMES[agent.kind] : '';
  const choices = agent ? effortChoices(agent) : [];
  const unlisted =
    read?.effort && agent?.efforts && !agent.efforts.levels.includes(read.effort)
      ? read.effort
      : undefined;
  const commit = (next: string) => {
    saving.current = saving.current.then(async () => {
      try {
        onSaved(await postJson<AgentLevels>(`${settings.api}/effort`, { effort: next || null }));
        setNotice({ text: setting.saved(next || (choices[0]?.label ?? `${name}'s default`)) });
      } catch (failed) {
        setNotice({ text: (failed as Error).message, error: true });
      }
    });
  };

  return (
    <section className="settings-part settings-effort" aria-label="Effort">
      <Heading>
        Effort
        <Help label={`About ${settings.whose} effort`}>
          <p>
            {setting.about}
            {name ? `, from ${name}'s levels` : ''}.{' '}
            {setting.byDefault ?? "Default passes none: the agent's own setting decides."}
          </p>
          <p>
            {setting.also} Saved in {read?.file ?? 'symbiote/config.json'} (
            <code>{setting.key}</code>) when you let go.
          </p>
        </Help>
      </Heading>
      {agent && !agent.efforts && (
        <p className="settings-warning" role="alert">
          Symbiote cannot read {name}&apos;s effort levels: {setting.atDefault}.
        </p>
      )}
      {unlisted && (
        <p className="settings-warning" role="alert">
          {setting.key} is {unlisted}, which {name} does not list: {setting.atDefault}.
        </p>
      )}
      {choices.length > 0 && (
        <EffortStepper
          label="Effort"
          choices={choices}
          value={level}
          onChange={setLevel}
          onCommit={commit}
        />
      )}
      {notice && (
        <p className={`settings-notice${notice.error ? ' error' : ''}`} role="status">
          {notice.text}
        </p>
      )}
    </section>
  );
}

/**
 * A prebuilt agent's model in the project's config (V47), a select of its agent's own list, saved
 * when picked: `nucleus.model`, `scribe.model`, `merge.model`.
 */
function AgentModel({
  settings,
  heading: Heading,
  read,
  onSaved,
}: {
  settings: AgentSettings;
  heading: 'h3' | 'h4';
  /** The agent's models and levels, null while they are read. */
  read: AgentLevels | null;
  onSaved: (answer: AgentLevels) => void;
}) {
  const { model: setting } = settings;
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const agent = read?.agents[0];
  const name = agent ? AGENT_NAMES[agent.kind] : '';
  const choices = agent ? modelChoices(agent) : [];
  const value = agent ? (keptModel(read?.model, agent) ?? '') : '';
  const unlisted = read?.model && agent?.models && value === '' ? read.model : undefined;
  const picked = choices.find((c) => c.value === value);
  const pick = async (next: string) => {
    setSaving(true);
    try {
      const answer = await postJson<AgentLevels>(`${settings.api}/model`, {
        model: next || null,
      });
      onSaved(answer);
      const label = choices.find((c) => c.value === next)?.label ?? next;
      setNotice({ text: setting.saved(label) });
    } catch (failed) {
      setNotice({ text: (failed as Error).message, error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-part" aria-label="Model">
      <Heading>
        Model
        <Help label={`About ${settings.whose} model`}>
          <p>
            {setting.about}
            {name ? `, from ${name}'s own list` : ''}.{' '}
            {setting.byDefault ??
              "Default passes none of Settings': the first entry says which it is."}
          </p>
          <p>
            The Effort below follows it: its levels are this model&apos;s. Saved in{' '}
            {read?.file ?? 'symbiote/config.json'} (<code>{setting.key}</code>) when you pick one.
          </p>
        </Help>
      </Heading>
      {/* A row (V51): the select beside the name, what it says under it. */}
      {choices.length > 0 && (
        <select
          aria-label="Model"
          value={value}
          disabled={saving}
          onChange={(event) => void pick(event.target.value)}
        >
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      {picked?.description && <p className="settings-row-note">{picked.description}</p>}
      {agent && !agent.models && (
        <p className="settings-warning" role="alert">
          Symbiote cannot read {name}&apos;s models: none can be picked here.
        </p>
      )}
      {unlisted && (
        <p className="settings-warning" role="alert">
          {setting.key} is {unlisted}, which {name} does not list: {setting.unlisted}.
        </p>
      )}
      {notice && (
        <p className={`settings-notice${notice.error ? ' error' : ''}`} role="status">
          {notice.text}
        </p>
      )}
    </section>
  );
}
