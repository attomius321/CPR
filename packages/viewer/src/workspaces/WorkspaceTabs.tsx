// A workspace's tabs (V21, V29a, V45; named sessions since V89, decision 827): the agent's terminal
// by its agent's name with a dot for its state, its views (thread, activity since V48, brief; a
// Hive workspace's Run, HV3, V92), then its shells, each with the program in its foreground and a
// close button, and a new shell's button; at the strip's end, attaching images, Split and Focus.
import type { ReactNode, RefObject } from 'react';
import type { WorkspaceAgentState, WorkspaceShell } from '@symbiote/core';
import { CloseIcon, ExpandIcon, PlusIcon, SplitIcon, TerminalIcon } from '../ui/icons.js';
import { MAX_SHELLS, shellName } from './shells.js';
import { terminalHint } from './workspaces.js';
import { agentDot } from './workspace-steps.js';
import { tip } from '../ui/tip.js';

export type View = 'terminal' | 'thread' | 'activity' | 'brief' | 'run' | 'shell';
/** The agent's own tabs: a shell's is picked by its number. */
export type AgentView = Exclude<View, 'shell'>;

const TAB_NAMES: Record<Exclude<AgentView, 'terminal'>, string> = {
  thread: 'Thread',
  activity: 'Activity',
  brief: 'Brief',
  run: 'Run',
};

/** The strip of a workspace's tabs: `view` picked, a shell's by its number. */
export function WorkspaceTabs({
  stripRef,
  views,
  view,
  agent,
  agentName,
  shells,
  shellsCan,
  shellNumber,
  split,
  focus,
  attach,
  onShow,
  onShowShell,
  onCloseShell,
  onOpenShell,
  onSplit,
  onFocus,
}: {
  /** The strip: the panel keeps the picked tab in sight as it scrolls. */
  stripRef: RefObject<HTMLDivElement | null>;
  views: AgentView[];
  view: View;
  agent: WorkspaceAgentState;
  /** The agent's tab: its agent's name, and what runs it (Hive's writer). */
  agentName: { name: string; what?: string };
  /** Its shells, by number; null until read. */
  shells: WorkspaceShell[] | null;
  /** Whether shells can open here (terminals, and the worktree). */
  shellsCan: boolean;
  shellNumber: number | null;
  /** Split's shell: the agent's tab and its are both picked. Null when Split is off; undefined
   * where Split cannot be (no agent's terminal, or no shells). */
  split: number | null | undefined;
  focus: boolean;
  /** Attaching images to the open terminal's message, when one is open. */
  attach: ReactNode;
  onShow: (view: AgentView) => void;
  onShowShell: (number: number) => void;
  onCloseShell: (shell: WorkspaceShell) => void;
  onOpenShell: () => void;
  onSplit: () => void;
  onFocus: () => void;
}) {
  const dot = agentDot(agent);
  const splitting = typeof split === 'number';
  return (
    <div className="card-head workspace-views">
      <div
        ref={stripRef}
        className="workspace-tabs"
        role="tablist"
        aria-label="Talk to the agent"
        onWheel={(event) => {
          // Many shells scroll the strip sideways: the wheel too, not only a trackpad.
          if (event.deltaX === 0) event.currentTarget.scrollLeft += event.deltaY;
        }}
      >
        {views.map((name) => {
          const selected = view === name || (name === 'terminal' && splitting);
          return name === 'terminal' ? (
            <button
              key={name}
              type="button"
              role="tab"
              aria-label={agentName.name}
              aria-selected={selected}
              className={`stab stab-agent${selected ? ' selected' : ''}`}
              {...tip(terminalHint(agent))}
              onClick={() => onShow(name)}
            >
              <TerminalIcon />
              {agentName.name}
              {agentName.what && <span className="stab-what">{agentName.what}</span>}
              {dot && <span className="stab-dot" data-state={dot} aria-hidden="true" />}
            </button>
          ) : (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`stab${selected ? ' selected' : ''}`}
              onClick={() => onShow(name)}
            >
              {TAB_NAMES[name]}
            </button>
          );
        })}
        {shellsCan && (
          <>
            <span className="views-divider" aria-hidden="true" />
            {(shells ?? []).map((shell) => {
              const name = shellName(shell.number);
              const selected =
                (view === 'shell' && shellNumber === shell.number) || split === shell.number;
              return (
                <span key={shell.id} className="shell-tab">
                  <button
                    type="button"
                    role="tab"
                    aria-label={name}
                    aria-selected={selected}
                    className={`stab${selected ? ' selected' : ''}`}
                    {...tip(
                      shell.running
                        ? `A shell in the worktree\n${shell.running} runs in it`
                        : 'A shell in the worktree',
                    )}
                    onClick={() => onShowShell(shell.number)}
                  >
                    {name}
                    {shell.running && <span className="stab-what">{shell.running}</span>}
                    {shell.running && (
                      <span className="stab-dot" data-state="ok" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="icon-button shell-close"
                    aria-label={`Close ${name}`}
                    {...tip(`Close ${name}`)}
                    onClick={() => onCloseShell(shell)}
                  >
                    <CloseIcon />
                  </button>
                </span>
              );
            })}
            <span className="shell-new-end">
              <button
                type="button"
                className="icon-button shell-new"
                aria-label="New shell"
                {...tip(
                  (shells?.length ?? 0) >= MAX_SHELLS
                    ? `${MAX_SHELLS} shells are open\nClose one first`
                    : 'A new shell in the worktree\nIt runs until you close it or Symbiote quits',
                )}
                disabled={shells === null || shells.length >= MAX_SHELLS}
                onClick={onOpenShell}
              >
                <PlusIcon />
              </button>
            </span>
          </>
        )}
      </div>
      <div className="workspace-views-end">
        {attach}
        {split !== undefined && (
          <button
            type="button"
            className="icon-button"
            aria-label="Split"
            aria-pressed={splitting}
            {...tip(
              splitting
                ? 'Back to one terminal'
                : 'The agent and a shell side by side\nA shell opens if none is',
            )}
            onClick={onSplit}
          >
            <SplitIcon />
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="Focus"
          aria-pressed={focus}
          {...tip(
            focus
              ? 'Back to the sidenav and the side card'
              : 'The terminal alone: the sidenav as its rail, no side card',
          )}
          onClick={onFocus}
        >
          <ExpandIcon />
        </button>
      </div>
    </div>
  );
}
