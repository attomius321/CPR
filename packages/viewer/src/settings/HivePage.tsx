import { useEffect, useState, type ReactNode } from 'react';
import type {
  AgentLevels,
  HiveLandingSetting,
  HiveLandsBy,
  HivePacingSetting,
  HiveState,
} from '@symbiote/core';
import { useShell } from '../shell/shell-context.js';
import { HIVE_STAGES } from '../ui/StageTrack.js';
import { effortChoices, keptEffort, keptModel, modelChoices } from '../workspaces/workspaces.js';
import { setHive, useHive } from '../shell/hive.js';
import { getJson, postJson } from '../ui/http.js';
import { HiveQuestion } from './HiveQuestion.js';
import {
  AlertIcon,
  CheckIcon,
  DocumentsIcon,
  HexagonIcon,
  MergeIcon,
  ShieldIcon,
} from '../ui/icons.js';
import { StatusLabel } from '../ui/StatusLabel.js';
import { TurnOffHive } from './HiveOff.js';
import { SettingsCard } from './SettingsCard.js';
import { pauseWords } from '../workspaces/hive-rounds.js';
import { budgetOf, LANDS_BY, pauseAtWords, pauseChoices } from './hive-switch.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** When Hive was turned on, as Settings' head says it: "2 Nov, 09:02". */
export function sinceWords(iso: string): string {
  const at = new Date(iso);
  return `${at.getDate()} ${MONTHS[at.getMonth()]}, ${two(at.getHours())}:${two(at.getMinutes())}`;
}

/** A row of the page (V92, decision 870): its name, one line of help, its control. */
function Row({
  name,
  help,
  id,
  tone,
  children,
}: {
  name: string;
  help: ReactNode;
  id: string;
  tone?: 'fail';
  children?: ReactNode;
}) {
  return (
    <div className="hive-setting" role="group" aria-labelledby={id}>
      <div className="hive-setting-words">
        <span className="hive-setting-name" id={id}>
          {name}
        </span>
        <span className={`hive-setting-help${tone ? ' is-fail' : ''}`}>{help}</span>
      </div>
      {children && <div className="hive-setting-control">{children}</div>}
    </div>
  );
}

/** A group of rows: its name, what it is about, its rows in one bordered box. */
function Group({ name, about, children }: { name: string; about: string; children: ReactNode }) {
  const id = `hive-group-${name.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section className="hive-group-set" role="group" aria-labelledby={id}>
      <h3 id={id}>
        {name} <span>{about}</span>
      </h3>
      <div className="hive-settings">{children}</div>
    </section>
  );
}

/** What a page's save said: one line for the page. */
type Said = { text: string; error?: boolean } | null;

/**
 * Hive mode (V82, decision 613; V92, decision 870): Hive's switch and its settings as grouped
 * rows — Landing, Limits, Running reviewer — in both modes. Off, what Hive does and Turn on Hive
 * mode in Hive's crimson, which asks first; on, since when, the access it gives, and Turn off Hive
 * (a secondary with red words), which asks while Hive's work is in flight (771). Kept for this
 * repository, out of git (decision 621).
 */
export function HivePage({
  onBack,
  onChecks,
}: {
  onBack: () => void;
  /** Opens Settings' Checks page, where the check is set (fix/settings-page). */
  onChecks: () => void;
}) {
  const on = useHive();
  const repo = useShell()?.repo;
  const [asking, setAsking] = useState<'on' | null>(null);
  const [state, setState] = useState<HiveState | null>(null);
  const [since, setSince] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<Said>(null);

  // Since when it is on, and the check Hive would run: read again as it turns on or off.
  useEffect(() => {
    let live = true;
    getJson<HiveState>('/api/hive/state')
      .then((read) => {
        if (!live) return;
        setState(read);
        setSince(read.since ?? null);
      })
      .catch(() => live && setState({ on, normal: [], flight: [] }));
    return () => {
      live = false;
    };
  }, [on]);

  /**
   * Turning on asks first (HV4), always, with what Hive checks before it starts (V92, 872); read
   * while the question is open. Turning off is `TurnOffHive`'s, the Overview's too (V91).
   */
  const ask = async () => {
    setError(null);
    setState(null);
    setAsking('on');
    const read = await getJson<HiveState>('/api/hive/state').catch((): HiveState => ({
      on: false,
      normal: [],
      flight: [],
    }));
    setState(read);
  };

  const turn = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // The question folds into its Mind and Hive's look opens from it (V92, decision 874); it
      // closes once the arrival no longer draws it.
      await setHive(next, { then: () => setAsking(null) });
    } catch (failed) {
      setError(
        `Hive mode could not be turned ${next ? 'on' : 'off'}: ${(failed as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      label="Hive mode"
      className="hive-page"
      title={
        <>
          Hive mode{' '}
          <StatusLabel tone={on ? 'ok' : 'idle'} className="hive-state">
            {on ? 'On' : 'Off'}
          </StatusLabel>{' '}
          <span className="hive-for">
            for {repo ?? 'this repository'}
            {on && since ? ` since ${sinceWords(since)}` : ''}
          </span>
        </>
      }
      actions={
        on ? (
          <TurnOffHive label="Turn off Hive" icon onError={setError} />
        ) : (
          <button type="button" className="button hive" disabled={busy} onClick={() => void ask()}>
            <HexagonIcon />
            Turn on Hive mode
          </button>
        )
      }
      onBack={onBack}
    >
      {on ? (
        <div className="hive-callout" role="note">
          <ShieldIcon />
          <p>
            <strong>Hive runs agents with full access to this machine.</strong> It never
            force-pushes or deletes work. Off stops every agent, check and review; on again goes on
            where they stopped.
          </p>
        </div>
      ) : (
        <div className="hive-callout" role="note">
          <p>
            <strong>Hive drives every workspace you start, from its brief to landed.</strong> Your
            agents write, Symbiote runs the check, a reviewer proves defects with failing tests, and
            Hive merges and pushes. No step waits for you. Set it up below, then turn it on.
          </p>
          <span className="hive-callout-track" aria-hidden="true">
            {HIVE_STAGES.map((stage) => (
              <svg key={stage} viewBox="0 0 12 13">
                <polygon points="6,0.5 11.5,3.5 11.5,9.5 6,12.5 0.5,9.5 0.5,3.5" />
              </svg>
            ))}
          </span>
        </div>
      )}
      {error && (
        <p className="settings-notice error" role="alert">
          {error}
        </p>
      )}
      <Group name="Landing" about="where finished work goes">
        <HiveLanding
          check={state?.check}
          checkRead={state !== null}
          onSaid={setSaid}
          onChecks={onChecks}
        />
        <Row
          id="hive-rounds"
          name="Rounds"
          help="Check and review rounds before Hive stops a workspace and records why."
        >
          <span className="hive-value">3 per workspace</span>
        </Row>
      </Group>
      <Group name="Limits" about="what Hive may spend">
        <HivePacing onSaid={setSaid} />
      </Group>
      <Group name="Running reviewer" about="proves defects with failing tests">
        <ReviewerLevels onSaid={setSaid} />
      </Group>
      {said && (
        <p className={`settings-notice${said.error ? ' error' : ''}`} role="status">
          {said.text}
        </p>
      )}
      <p className="hive-foot">
        <DocumentsIcon />
        <span>
          Kept in <code>symbiote/config.json</code> as <code>hive.lands</code>,{' '}
          <code>hive.usage.pauseAt</code>, <code>hive.budget</code> and <code>hive.reviewer.*</code>
          . On or off: <code>symbiote/hive.json</code>, never committed.
        </span>
      </p>
      {asking === 'on' && (
        <HiveQuestion
          busy={busy}
          state={state}
          onTurnOn={() => void turn(true)}
          onCancel={() => setAsking(null)}
        />
      )}
    </SettingsCard>
  );
}

/**
 * Landing's rows (HV8, decision 788; V92): how Hive lands — the merge queue or a pull or merge
 * request the person merges on the forge (`hive.lands`) —, the check it runs, the forge `origin`
 * names and whether a token is found (793).
 */
function HiveLanding({
  check,
  checkRead,
  onSaid,
  onChecks,
}: {
  check: HiveState['check'];
  checkRead: boolean;
  onSaid: (said: Said) => void;
  onChecks: () => void;
}) {
  const [setting, setSetting] = useState<HiveLandingSetting | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    getJson<HiveLandingSetting>('/api/hive/landing')
      .then((read) => live && setSetting(read))
      .catch((failed: unknown) => live && onSaid({ text: (failed as Error).message, error: true }));
    return () => {
      live = false;
    };
  }, [onSaid]);
  const pick = async (by: HiveLandsBy) => {
    setBusy(true);
    try {
      setSetting(await postJson<HiveLandingSetting>('/api/hive/landing', { by }));
      onSaid({
        text: `Saved. Hive lands ${by === 'request' ? 'through a request' : 'through the merge queue'}.`,
      });
    } catch (failed) {
      onSaid({ text: `Lands through could not be set: ${(failed as Error).message}`, error: true });
    } finally {
      setBusy(false);
    }
  };
  const forge = setting?.forge;
  const forgeName = forge ? (forge.kind === 'github' ? 'GitHub' : 'GitLab') : null;
  return (
    <>
      <Row
        id="hive-lands-by"
        name="Lands through"
        help={
          setting?.by === 'request'
            ? 'A pull or merge request into the branch the workspace started from; your merge lands it.'
            : 'Into the branch the workspace started from; both branches are pushed.'
        }
      >
        <span className="scopes" role="group" aria-label="Lands through">
          {LANDS_BY.map((choice) => (
            <button
              key={choice.by}
              type="button"
              className={setting?.by === choice.by ? 'scope active' : 'scope'}
              aria-pressed={setting?.by === choice.by}
              disabled={busy || !setting}
              onClick={() => void pick(choice.by)}
            >
              <MergeIcon />
              {choice.label}
            </button>
          ))}
        </span>
      </Row>
      <Row
        id="hive-check"
        name="The check"
        tone={checkRead && !check ? 'fail' : undefined}
        help={
          !checkRead ? (
            'Reading…'
          ) : check ? (
            <>
              What Hive runs on every commit, from <code>{checkSource(check.source)}</code>.
            </>
          ) : (
            'None is set or found: set it on the Checks page. Hive turns on only with one.'
          )
        }
      >
        {check && (
          <span className="hive-commands">
            {check.commands.map((command) => (
              <code key={command}>{command}</code>
            ))}
          </span>
        )}
        {/* Set on its own page, the merger's and Hive's alike (fix/settings-page). */}
        <a
          className="button secondary hive-check-change"
          href="?prompt=checks"
          onClick={(event) => {
            event.preventDefault();
            onChecks();
          }}
        >
          {check ? 'Change' : 'Set the check'}
        </a>
      </Row>
      {setting && (setting.by === 'request' || forge) && (
        <Row
          id="hive-requests"
          name="Pull and merge requests"
          help={
            forge ? (
              <>
                origin is <code>{forge.project}</code> on {forgeName}
              </>
            ) : (
              'origin names no GitHub or GitLab project'
            )
          }
        >
          {setting.why ? (
            <span className="hive-value is-warning">
              <AlertIcon />
              {setting.why.replace(/\.$/, '')}
            </span>
          ) : (
            <span className="hive-value is-ok">
              <CheckIcon />A token is found
            </span>
          )}
        </Row>
      )}
    </>
  );
}

/** Where the check comes from, short: `merge.checks`, else the file it was found in. */
const checkSource = (source: string) =>
  source.includes('(merge.checks)') ? 'merge.checks' : source;

/**
 * Limits' rows (HV5, decisions 797–801): the usage threshold every start waits under, Hive's
 * pause now, and a budget per workspace; `hive.usage.pauseAt` and `hive.budget`.
 */
function HivePacing({ onSaid }: { onSaid: (said: Said) => void }) {
  const [setting, setSetting] = useState<HivePacingSetting | null>(null);
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    getJson<HivePacingSetting>('/api/hive/pacing')
      .then((read) => {
        if (!live) return;
        setSetting(read);
        setBudget(read.budget === null ? '' : read.budget.toFixed(2));
      })
      .catch((failed: unknown) => live && onSaid({ text: (failed as Error).message, error: true }));
    return () => {
      live = false;
    };
  }, [onSaid]);
  const save = async (
    change: { pauseAt?: number | false; budget?: number | null },
    said: string,
  ) => {
    setBusy(true);
    try {
      const answer = await postJson<HivePacingSetting>('/api/hive/pacing', change);
      setSetting(answer);
      setBudget(answer.budget === null ? '' : answer.budget.toFixed(2));
      onSaid({ text: `Saved. ${said}` });
    } catch (failed) {
      onSaid({ text: `Hive's limits could not be set: ${(failed as Error).message}`, error: true });
    } finally {
      setBusy(false);
    }
  };
  const typed = budgetOf(budget);
  const changed = 'value' in typed && setting !== null && typed.value !== setting.budget;
  return (
    <>
      <Row
        id="hive-pause-at"
        name="Pause by usage"
        help={
          setting?.pause
            ? `Hive is paused now: ${pauseWords(setting.pause, Date.now()).replace(/^Paused: /, '')}.`
            : setting && (!setting.read || setting.pauseAt === false)
              ? pauseAtWords(setting)
              : 'No agent starts while a window of your Claude plan is at it or over, until it resets.'
        }
      >
        <select
          aria-labelledby="hive-pause-at"
          value={setting ? String(setting.pauseAt === false ? 'off' : setting.pauseAt) : ''}
          disabled={busy || !setting}
          onChange={(event) => {
            const value = event.target.value;
            const pauseAt = value === 'off' ? false : Number(value);
            void save(
              { pauseAt },
              pauseAt === false
                ? 'Hive no longer pauses by usage.'
                : `Hive pauses at ${pauseAt} %.`,
            );
          }}
        >
          {setting &&
            pauseChoices(setting.pauseAt).map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
        </select>
      </Row>
      <Row
        id="hive-budget-name"
        name="Budget per workspace"
        tone={'problem' in typed ? 'fail' : undefined}
        help={
          'problem' in typed
            ? typed.problem
            : 'A workspace that reaches it stops; raise it and send a message to go on.'
        }
      >
        <form
          className="hive-budget"
          onSubmit={(event) => {
            event.preventDefault();
            if (!('value' in typed)) return;
            void save(
              { budget: typed.value },
              typed.value === null ? 'No budget.' : `The budget is $${typed.value.toFixed(2)}.`,
            );
          }}
        >
          <span className="hive-budget-sign" aria-hidden="true">
            $
          </span>
          <input
            id="hive-budget"
            aria-labelledby="hive-budget-name"
            inputMode="decimal"
            placeholder="None"
            value={budget}
            disabled={busy || !setting}
            aria-invalid={'problem' in typed}
            onChange={(event) => setBudget(event.target.value)}
          />
          {changed && (
            <button type="submit" className="button secondary" disabled={busy}>
              Save
            </button>
          )}
        </form>
      </Row>
    </>
  );
}

/**
 * The running reviewer's model and effort (HV3, decision 680; V92: here, not on its Reviewer
 * page): two selects of Claude Code's own models and levels, saved when picked
 * (`hive.reviewer.model`, `hive.reviewer.effort`).
 */
function ReviewerLevels({ onSaid }: { onSaid: (said: Said) => void }) {
  const [read, setRead] = useState<AgentLevels | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    getJson<AgentLevels>('/api/hive/reviewer/efforts')
      .then((answer) => live && setRead(answer))
      .catch((failed: unknown) => live && onSaid({ text: (failed as Error).message, error: true }));
    return () => {
      live = false;
    };
  }, [onSaid]);
  const agent = read?.agents[0];
  // Short, as the row's two selects: "Opus 5.5 (default)", "High".
  const short = (choices: { value: string; label: string }[]) =>
    choices.map((c, i) => {
      const named = i === 0 ? /\(([^)]+)\)$/.exec(c.label)?.[1] : undefined;
      const label = i === 0 ? (named ? `${named} (default)` : 'Default') : c.label;
      return { ...c, label: label.charAt(0).toUpperCase() + label.slice(1) };
    });
  const models = agent ? short(modelChoices(agent)) : [];
  const efforts = agent ? short(effortChoices(agent)) : [];
  const model = agent ? (keptModel(read?.model, agent) ?? '') : '';
  const effort = agent && read ? (keptEffort(read.effort, agent) ?? '') : '';
  const save = async (what: 'model' | 'effort', value: string, label: string) => {
    setBusy(true);
    try {
      setRead(await postJson<AgentLevels>(`/api/hive/reviewer/${what}`, { [what]: value || null }));
      onSaid({
        text:
          what === 'model'
            ? `Saved. The next running review is asked on ${label}.`
            : `Saved. The next running review is asked at ${label}.`,
      });
    } catch (failed) {
      onSaid({ text: (failed as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      id="hive-reviewer"
      name="Model and effort"
      tone={read && !agent ? 'fail' : undefined}
      help={
        read && !agent
          ? 'The running reviewer needs Claude Code: it is not installed here.'
          : 'A clean Claude Code, in its sandbox, in a throwaway copy of the commit.'
      }
    >
      {models.length > 0 && (
        <select
          aria-label="Model"
          value={model}
          disabled={busy}
          onChange={(event) =>
            void save(
              'model',
              event.target.value,
              models.find((c) => c.value === event.target.value)?.label ?? event.target.value,
            )
          }
        >
          {models.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      {efforts.length > 0 && (
        <select
          aria-label="Effort"
          value={effort}
          disabled={busy}
          onChange={(event) =>
            void save(
              'effort',
              event.target.value,
              efforts.find((c) => c.value === event.target.value)?.label ?? event.target.value,
            )
          }
        >
          {efforts.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      )}
    </Row>
  );
}
