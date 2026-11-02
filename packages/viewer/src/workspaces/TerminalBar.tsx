// The bar under a workspace's terminal (V89, decisions 828, 829; replaces V48's strip): what waits
// in the agent's own words and the keys that answer it, or what it does, or who drives. Its only
// buttons go somewhere: the terminal, the thread, the plan, the next workspace waiting. None
// answers the agent's prompt for the person.
import type { ReactNode } from 'react';
import type { WorkspaceHive } from '@symbiote/core';
import {
  FailedIcon,
  HexagonIcon,
  IdleIcon,
  RunningIcon,
  DoneIcon,
  WaitingIcon,
} from '../ui/icons.js';
import { HiveNowLine } from './HiveNow.js';
import { Since } from './HeadSteps.js';
import type { BarKey, BarModel } from './terminal-bar.js';
import { tip } from '../ui/tip.js';

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Symbiote's own keys in its terminals (V36, V38): ⌘ on macOS, where Ctrl+V stays the agent's. */
const TERMINAL_KEYS: BarKey[] = [
  { keys: [MAC ? '⌘' : 'Ctrl', 'Click'], what: 'opens a path' },
  { keys: [MAC ? '⌘' : 'Ctrl', 'V'], what: 'pastes an image' },
];

const ICONS: Record<BarModel['tone'], () => ReactNode> = {
  you: WaitingIcon,
  run: RunningIcon,
  error: FailedIcon,
  ok: DoneIcon,
  idle: IdleIcon,
  hive: HexagonIcon,
};

function Keys({ keys }: { keys: BarKey[] }) {
  return (
    <>
      {keys.map(({ keys: chord, what }) => (
        <span key={what} className="term-bar-key">
          {chord.map((key) => (
            <kbd key={key}>{key}</kbd>
          ))}
          {what}
        </span>
      ))}
    </>
  );
}

export function TerminalBar({
  model,
  hive,
  terminalShown,
  waiting,
  onTerminal,
  onThread,
  onNext,
  onVerdict,
}: {
  model: BarModel;
  hive: WorkspaceHive | undefined;
  /** The agent's terminal (or a shell) is shown: its keys apply. */
  terminalShown: boolean;
  /** The other workspaces waiting for the person, in the sidenav's order. */
  waiting: string[];
  /** Shows the agent's terminal and focuses it; absent where there is none. */
  onTerminal?: () => void;
  onThread: () => void;
  onNext: (branch: string) => void;
  /** Types the review's verdict into the open terminal, without Enter (decision 114). */
  onVerdict?: () => void;
}) {
  const Icon = ICONS[model.tone];
  const [after] = waiting;
  const keys =
    model.keys.length > 0 ? model.keys : model.terminalKeys && terminalShown ? TERMINAL_KEYS : [];
  const yours = model.tone === 'you';
  return (
    <section className="term-bar" data-tone={model.tone} aria-label="Agent status">
      <span className="term-bar-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="term-bar-text" {...tip(model.text)}>
        {model.text}
      </span>
      {model.hiveLive && hive ? (
        <span className="term-bar-detail">
          · <HiveNowLine hive={hive} />
        </span>
      ) : (
        (model.detail || model.since) && (
          <span className="term-bar-detail">
            · {model.detail}
            {model.since && (
              <>
                {model.detail ? ' · ' : ''}
                {yours ? 'waiting ' : ''}
                <Since since={model.since} />
              </>
            )}
          </span>
        )
      )}
      <span className="term-bar-end">
        {model.note && <span className="term-bar-note">{model.note}</span>}
        {keys.length > 0 && <Keys keys={keys} />}
        {yours && !terminalShown && !model.plan && onTerminal && (
          <button type="button" className="button ghost" onClick={onTerminal}>
            Answer in its terminal
          </button>
        )}
        {onVerdict && (
          <button
            type="button"
            className="button ghost"
            {...tip('Types its first line and where the review is\nEnter sends it')}
            onClick={onVerdict}
          >
            Send the verdict
          </button>
        )}
        {model.plan && terminalShown && (
          <button type="button" className="button ghost" onClick={onThread}>
            Read the plan
          </button>
        )}
        {model.thread && (
          <button type="button" className="button ghost" onClick={onThread}>
            Read its thread
          </button>
        )}
        {yours && after && (
          <button
            type="button"
            className="button ghost term-bar-next"
            {...tip(`${after}\n${waiting.length} other${waiting.length === 1 ? '' : 's'} waiting`)}
            onClick={() => onNext(after)}
          >
            Next waiting ({waiting.length})
          </button>
        )}
      </span>
    </section>
  );
}
