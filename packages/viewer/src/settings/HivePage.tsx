import { useState } from 'react';
import type { HiveState } from '@symbiote/core';
import { setHive, useHive } from '../shell/hive.js';
import { getJson } from '../ui/http.js';
import { HiveJoining } from '../ui/HiveArt.js';
import { DangerIcon } from '../ui/icons.js';
import { SettingsCard } from './SettingsCard.js';
import { nameOf, offWords, onRefusal } from './hive-switch.js';

/**
 * Hive mode (V82, decision 613): Hive's switch, a danger to press. What Hive does (HV2–HV4), in the
 * error's tint, and a danger button that asks first, refused while a workspace is in normal mode
 * (HV4, decision 772); off asks too while Hive's work is in flight, saying what it stops (771).
 * Kept for this repository, out of git (decision 621).
 */
export function HivePage({ onBack }: { onBack: () => void }) {
  const on = useHive();
  const [asking, setAsking] = useState<'on' | 'off' | null>(null);
  const [state, setState] = useState<HiveState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Asks first (HV4): on, always, saying which workspaces in normal mode keep it off; off, only
   * while Hive's work is in flight, saying what happens to each. Unread, on asks as before and
   * off turns off at once.
   */
  const ask = async (next: boolean) => {
    setError(null);
    setState(null);
    // On: the question at once, what keeps Hive off read while it is open.
    if (next) setAsking('on');
    const read = await getJson<HiveState>('/api/hive/state').catch((): HiveState => ({
      on: !next,
      normal: [],
      flight: [],
    }));
    setState(read);
    if (next) return;
    if (read.flight.length > 0) return setAsking('off');
    return turn(false);
  };

  const turn = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // The question's Hive Mind grows from its middle as the shutter closes (decision 673).
      const art = document.querySelector('.hive-joining')?.getBoundingClientRect();
      await setHive(next, {
        ...(art
          ? {
              from: {
                x: art.x + art.width / 2,
                y: art.y + art.height / 2,
                scale: art.width / 520,
              },
            }
          : {}),
        then: () => setAsking(null),
      });
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
      title={
        <>
          Hive mode{' '}
          <span className={on ? 'settings-state hive-on' : 'settings-state'}>
            {on ? 'On' : 'Off'}
          </span>
        </>
      }
      onBack={onBack}
    >
      <div className="hive-warning" role="note">
        <DangerIcon />
        <p>
          <strong>
            Hive runs agents, the project&apos;s check and lands work without asking you.
          </strong>
          Every workspace you start while Hive is on is Hive&apos;s, from its brief to landed: its
          Claude Code agent works the brief; after each turn Symbiote runs the check in its
          worktree, and once it passes a reviewer with a clean context runs the change in a
          throwaway copy and proves defects with failing tests. Symbiote sends the agent what fails,
          for up to 3 rounds, and answers its plans and questions in your place. Then Hive approves
          the commit, merges it into the branch the workspace started from through the merge queue,
          which checks the merge again, and pushes both branches. A conflict goes back to the agent.
          Turning Hive off stops Hive&apos;s agents, checks and reviews; turning it on again
          continues where they stopped. Hive never force-pushes or deletes work.
        </p>
      </div>
      <p className="settings-row-note">
        Start a project in normal mode, and turn Hive on once this repository has a check and tests
        you trust. Hive cannot turn on while a workspace started in normal mode is open.
      </p>
      <div className="hive-control">
        {on ? (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void ask(false)}
          >
            Turn off Hive mode
          </button>
        ) : (
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() => void ask(true)}
          >
            Turn on Hive mode
          </button>
        )}
        <p className="settings-row-note">
          For this repository: every window of its symbiote view. Kept with its reviews, never
          committed.
        </p>
      </div>
      {error && (
        <p className="settings-notice error" role="alert">
          {error}
        </p>
      )}
      {asking === 'on' && (
        <HiveQuestion
          busy={busy}
          normal={state?.normal ?? null}
          onTurnOn={() => void turn(true)}
          onCancel={() => setAsking(null)}
        />
      )}
      {asking === 'off' && state && (
        <HiveOffQuestion
          busy={busy}
          flight={state.flight}
          onTurnOff={() => void turn(false)}
          onCancel={() => setAsking(null)}
        />
      )}
    </SettingsCard>
  );
}

/**
 * Turning Hive mode on asks first (decision 615), in Hive's own look whatever the theme and the
 * mode: a circuit routes into the Hive Mind over the question and lives while it is open
 * (decision 665).
 * Cancel is focused; Escape and a click beside the dialog cancel.
 */
function HiveQuestion({
  busy,
  normal,
  onTurnOn,
  onCancel,
}: {
  busy: boolean;
  /** Workspaces in normal mode: Hive does not turn on while any is open (772); null, reading. */
  normal: HiveState['normal'] | null;
  onTurnOn: () => void;
  onCancel: () => void;
}) {
  const refused = normal ? onRefusal({ normal }) : null;
  return (
    <div
      className="dialog-backdrop hive"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="dialog hive-ink"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hive-question"
        aria-describedby="hive-detail"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
      >
        <HiveJoining />
        <h2 id="hive-question">
          <DangerIcon />
          Turn on Hive mode?
        </h2>
        <p id="hive-detail">
          Hive will start your workspaces&apos; agents again, run the project&apos;s check, and land
          and push each workspace it drives without asking you first. Turn it on once this
          repository has a check and tests you trust. Every workspace you start while it is on is
          Hive&apos;s. Nucleus becomes Alpha Ceph and is told what Hive does: its conversation
          starts again, unless it is answering or waiting on you.
        </p>
        {refused && (
          <div className="hive-refused" role="status">
            <p>{refused}</p>
            <ul>
              {(normal ?? []).map((w) => (
                <li key={w.branch}>
                  {nameOf(w)}
                  {w.title && <code>{w.branch}</code>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="dialog-buttons">
          <button
            type="button"
            className="button danger"
            disabled={busy || normal === null || refused !== null}
            onClick={onTurnOn}
          >
            Turn on Hive mode
          </button>
          <button type="button" className="button secondary" autoFocus onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Turning Hive off while its work is in flight asks first (HV4, decision 771): each workspace and
 * what happens to it, then and when Hive is on again. Cancel is focused; Escape and a click
 * beside the dialog cancel.
 */
function HiveOffQuestion({
  busy,
  flight,
  onTurnOff,
  onCancel,
}: {
  busy: boolean;
  flight: HiveState['flight'];
  onTurnOff: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="dialog hive-off-question"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hive-off-question"
        aria-describedby="hive-off-detail"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
      >
        <h2 id="hive-off-question">Turn off Hive mode?</h2>
        <p id="hive-off-detail">
          Hive is at work on {flight.length === 1 ? 'a workspace' : `${flight.length} workspaces`}.
          Turning it off:
        </p>
        <ul className="hive-off-list">
          {flight.map((w) => (
            <li key={w.branch}>
              <strong>{nameOf(w)}</strong>: {offWords(w.step)}.
            </li>
          ))}
        </ul>
        <p>Alpha Ceph becomes Nucleus again. Nothing that was done is undone.</p>
        <div className="dialog-buttons">
          <button type="button" className="button danger" disabled={busy} onClick={onTurnOff}>
            Turn off Hive mode
          </button>
          <button type="button" className="button secondary" autoFocus onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
