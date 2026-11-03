// Turning Hive on asks first (decision 615; V92, decisions 872, 873; proofs 09-turn-on and
// 09-turn-on-refused): in Hive's ink whatever the theme, the circuit art kept as it is (decision
// 665), then what Hive will do as its four steps and what it checks before it starts. Turn on Hive
// is off while a check fails; refused, the workspaces in normal mode are named. Cancel is focused;
// Escape and a click beside the dialog cancel. The arrival is `shell/hive-arrival.ts`'s.
import { useEffect, useState, type ReactNode } from 'react';
import type { HivePacingSetting, HiveState } from '@symbiote/core';
import { useShell } from '../shell/shell-context.js';
import { HiveJoining } from '../ui/HiveArt.js';
import { getJson } from '../ui/http.js';
import {
  AlertIcon,
  CheckIcon,
  ChecksIcon,
  CloseIcon,
  HexagonIcon,
  MergeIcon,
  PencilIcon,
  ReviewIcon,
} from '../ui/icons.js';
import { hiveReadiness, type ReadyItem } from './hive-switch.js';

/** Hive's four steps, as the question says them. */
const STEPS: { name: string; icon: () => ReactNode; words: string }[] = [
  { name: 'Write', icon: PencilIcon, words: 'Agents work in auto mode; Hive answers them' },
  { name: 'Check', icon: ChecksIcon, words: 'The check runs on every commit' },
  { name: 'Review', icon: ReviewIcon, words: 'Opus proves defects with failing tests' },
  { name: 'Land', icon: MergeIcon, words: 'Merges into main and pushes, unasked' },
];

/** A hexagon a point up, on a 24 × 26 box: a step's node. */
const HEX = '12,1 23,7 23,19 12,25 1,19 1,7';

const MARKS: Record<ReadyItem['mark'], () => ReactNode> = {
  ok: CheckIcon,
  fail: CloseIcon,
  warn: AlertIcon,
};

/** The question, open while Settings asks it; `state` null while it is read. */
export function HiveQuestion({
  busy,
  state,
  onTurnOn,
  onCancel,
}: {
  busy: boolean;
  state: HiveState | null;
  onTurnOn: () => void;
  onCancel: () => void;
}) {
  const repo = useShell()?.repo;
  const [pacing, setPacing] = useState<HivePacingSetting | null>(null);
  useEffect(() => {
    let live = true;
    getJson<HivePacingSetting>('/api/hive/pacing')
      .then((read) => live && setPacing(read))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const { items, ready } = hiveReadiness({ state, pacing, rounds: 3 });
  return (
    <div
      className="dialog-backdrop hive hq-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="dialog hive-ink hq"
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
        <div className="hq-body">
          <div className="hq-title">
            <h2 id="hive-question">Turn on Hive mode</h2>
            <span>for {repo ?? 'this repository'}</span>
          </div>
          <p id="hive-detail" className="hq-lede">
            Hive drives every workspace you start, from its brief to landed. No step waits for you.
          </p>
          <ol className="hq-steps" aria-label="What Hive will do">
            {STEPS.map(({ name, icon: Icon, words }, i) => (
              <li key={name} className="hq-step">
                <span className="hq-node" aria-hidden="true">
                  <svg className="hq-hex" viewBox="0 0 24 26">
                    <polygon points={HEX} />
                  </svg>
                  <Icon />
                </span>
                {i < STEPS.length - 1 && (
                  <span className="hq-wire" aria-hidden="true">
                    <i />
                  </span>
                )}
                <b>{name}</b>
                <span>{words}</span>
              </li>
            ))}
          </ol>
          <h3 className="hq-label" id="hq-ready">
            Before it starts
          </h3>
          <ul className="hq-ready" aria-labelledby="hq-ready">
            {items.map((item) => {
              const Mark = MARKS[item.mark];
              return (
                <li key={item.key} className={`hq-r is-${item.mark}`}>
                  <span
                    className="hq-mark"
                    aria-label={
                      item.mark === 'fail' ? 'fails' : item.mark === 'warn' ? 'warning' : 'passes'
                    }
                  >
                    <Mark />
                  </span>
                  <span className="hq-r-text">{item.text}</span>
                  {item.detail && <span className="hq-r-detail">{item.detail}</span>}
                  {item.names && (
                    <span className="hq-names">
                      {item.names.map((name) => (
                        <span key={name} className="chip">
                          {name}
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="hq-note">Nucleus becomes Alpha Ceph, and its conversation starts again.</p>
        </div>
        <div className="hq-foot">
          <span>Turn it off any time; nothing done is undone.</span>
          <button type="button" className="button secondary" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="button hive hq-turn-on"
            disabled={busy || !ready}
            onClick={onTurnOn}
          >
            <HexagonIcon />
            Turn on Hive
          </button>
        </div>
      </div>
    </div>
  );
}
