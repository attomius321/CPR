// Settings' switch on Nucleus's page (NU8, decision 786): its start_workspace without the person's
// Confirm. Only the person sets it, here; on and fixed while Hive mode is on (decision 783).
import { useEffect, useState } from 'react';
import { getJson, postJson } from '../ui/http.js';
import { startConfirmNote, type StartConfirmState } from './start-confirm.js';

const API = '/api/nucleus/start-confirm';

/** The switch as a row under Nucleus's Model and Effort; nothing where the server has none. */
export function StartConfirm({ name }: { name: string }) {
  const [state, setState] = useState<StartConfirmState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    getJson<StartConfirmState>(API)
      .then((read) => current && setState(read))
      // No setting here (`symbiote pr`, an older server): no row.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  if (!state) return null;

  const turn = async (on: boolean) => {
    setSaving(true);
    setError(null);
    try {
      setState(await postJson<StartConfirmState>(API, { on }));
    } catch (failed) {
      setError((failed as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-rows">
      <section className="settings-part settings-start-confirm" aria-label="Starting">
        <h3>Starting</h3>
        <label className="settings-switch">
          <input
            type="checkbox"
            role="switch"
            checked={state.withoutConfirm}
            disabled={state.hive || saving}
            onChange={(event) => void turn(event.target.checked)}
          />
          Start workspaces without a Confirm
        </label>
        <p className="settings-row-note">{startConfirmNote(state, name)}</p>
        {error && (
          <p className="settings-notice error" role="status">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
