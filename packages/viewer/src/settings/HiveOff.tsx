// Turning Hive off (HV4, decision 771): asked first while Hive's work is in flight, saying what
// happens to each workspace; at once otherwise. One way for Settings' Hive page and the Overview's
// head (V91).
import { useState } from 'react';
import type { HiveState } from '@symbiote/core';
import { setHive } from '../shell/hive.js';
import { getJson } from '../ui/http.js';
import { PowerIcon } from '../ui/icons.js';
import { nameOf, offWords } from './hive-switch.js';

/**
 * Turn off Hive: a secondary with red words (V88). While Hive's work is in flight it asks first;
 * `onError` hears why it could not, and the page says it.
 */
export function TurnOffHive({
  label,
  icon = false,
  onError,
}: {
  label: string;
  /** Its power icon before the words (the Overview's head). */
  icon?: boolean;
  onError: (error: string | null) => void;
}) {
  const [flight, setFlight] = useState<HiveState['flight'] | null>(null);
  const [busy, setBusy] = useState(false);

  const turnOff = async () => {
    setBusy(true);
    onError(null);
    try {
      await setHive(false, { then: () => setFlight(null) });
    } catch (failed) {
      onError(`Hive mode could not be turned off: ${(failed as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  /** Unread, it turns off at once, as before. */
  const ask = async () => {
    onError(null);
    const read = await getJson<HiveState>('/api/hive/state').catch((): HiveState => ({
      on: true,
      normal: [],
      flight: [],
    }));
    if (read.flight.length > 0) setFlight(read.flight);
    else await turnOff();
  };

  return (
    <>
      <button type="button" className="button danger" disabled={busy} onClick={() => void ask()}>
        {icon && <PowerIcon />}
        {label}
      </button>
      {flight && (
        <HiveOffQuestion
          busy={busy}
          flight={flight}
          onTurnOff={() => void turnOff()}
          onCancel={() => setFlight(null)}
        />
      )}
    </>
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
              <strong>{nameOf(w)}</strong>: {offWords(w.step, w.request)}.
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
