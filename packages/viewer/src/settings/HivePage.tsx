import { useState } from 'react';
import { setHive, useHive } from '../shell/hive.js';
import { HiveJoining } from '../ui/HiveArt.js';
import { DangerIcon } from '../ui/icons.js';
import { SettingsCard } from './SettingsCard.js';

/**
 * Hive mode (V82, decision 613): the planned graph loop's switch, a danger to press. What Hive
 * will do, in the error's tint, and a danger button that asks first; off is the safe way and does
 * not ask. Kept for this repository, out of git (decision 621); for now it changes only the look.
 */
export function HivePage({ onBack }: { onBack: () => void }) {
  const on = useHive();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const turn = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // The question's Hive Mind grows from its middle as the blackout closes (decision 632).
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
        then: () => setAsking(false),
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
          <strong>Hive runs agents with full access to this machine.</strong>
          Hive is the graph loop: an orchestrator with full access runs a main agent, a researcher
          and a reviewer in every workspace, without asking you first. Hive is not built yet:
          turning it on now changes only Symbiote&apos;s look.
        </p>
      </div>
      <div className="hive-control">
        {on ? (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void turn(false)}
          >
            Turn off Hive mode
          </button>
        ) : (
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() => setAsking(true)}
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
      {asking && (
        <HiveQuestion
          busy={busy}
          onTurnOn={() => void turn(true)}
          onCancel={() => setAsking(false)}
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
  onTurnOn,
  onCancel,
}: {
  busy: boolean;
  onTurnOn: () => void;
  onCancel: () => void;
}) {
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
          Hive will run agents with full access to this machine, without asking you first. It is not
          built yet: for now only Symbiote&apos;s look changes.
        </p>
        <div className="dialog-buttons">
          <button type="button" className="button danger" disabled={busy} onClick={onTurnOn}>
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
