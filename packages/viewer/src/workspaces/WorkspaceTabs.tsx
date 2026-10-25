// A workspace's tabs (V21, V29a, V45): the agent's (its terminal, its thread, its activity since
// V48, its brief), then its shells, each with a close button, and a new shell's button.
import type { RefObject } from 'react';
import type { WorkspaceAgentState, WorkspaceShell } from '@symbiote/core';
import { InTitleBar } from '../shell/TitleBar.js';
import { CloseIcon, PlusIcon } from '../ui/icons.js';
import { MAX_SHELLS, shellName } from './shells.js';
import { terminalHint } from './workspaces.js';

export type View = 'terminal' | 'thread' | 'activity' | 'brief' | 'shell';
/** The agent's own tabs: a shell's is picked by its number. */
export type AgentView = Exclude<View, 'shell'>;

const TAB_NAMES: Record<AgentView, string> = {
  terminal: 'Terminal',
  thread: 'Thread',
  activity: 'Activity',
  brief: 'Brief',
};

/** The strip of a workspace's tabs, in the title bar: `view` picked, a shell's by its number. */
export function WorkspaceTabs({
  stripRef,
  views,
  view,
  agent,
  shells,
  shellsCan,
  shellNumber,
  onShow,
  onShowShell,
  onCloseShell,
  onOpenShell,
}: {
  /** The strip: the panel keeps the picked tab in sight as it scrolls. */
  stripRef: RefObject<HTMLDivElement | null>;
  views: AgentView[];
  view: View;
  agent: WorkspaceAgentState;
  /** Its shells, by number; null until read. */
  shells: WorkspaceShell[] | null;
  /** Whether shells can open here (terminals, and the worktree). */
  shellsCan: boolean;
  shellNumber: number | null;
  onShow: (view: AgentView) => void;
  onShowShell: (number: number) => void;
  onCloseShell: (shell: WorkspaceShell) => void;
  onOpenShell: () => void;
}) {
  return (
    <InTitleBar>
      <div
        ref={stripRef}
        className="workspace-views"
        role="tablist"
        aria-label="Talk to the agent"
        onWheel={(event) => {
          // Many shells scroll the strip sideways: the wheel too, not only a trackpad.
          if (event.deltaX === 0) event.currentTarget.scrollLeft += event.deltaY;
        }}
      >
        {views.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={view === name}
            className={view === name ? 'selected' : ''}
            {...(name === 'terminal' ? { title: terminalHint(agent) } : {})}
            onClick={() => onShow(name)}
          >
            {TAB_NAMES[name]}
          </button>
        ))}
        {shellsCan && (
          <>
            <span className="views-divider" aria-hidden="true" />
            {(shells ?? []).map((shell) => {
              const name = shellName(shell.number);
              const selected = view === 'shell' && shellNumber === shell.number;
              return (
                <span key={shell.id} className="shell-tab">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={selected ? 'selected' : ''}
                    title="A shell in the worktree"
                    onClick={() => onShowShell(shell.number)}
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    className="icon-button shell-close"
                    aria-label={`Close ${name}`}
                    title={`Close ${name}`}
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
                title={
                  (shells?.length ?? 0) >= MAX_SHELLS
                    ? `${MAX_SHELLS} shells are open: close one first`
                    : 'A new shell in the worktree: it runs until you close it or Symbiote quits'
                }
                disabled={shells === null || shells.length >= MAX_SHELLS}
                onClick={onOpenShell}
              >
                <PlusIcon />
              </button>
            </span>
          </>
        )}
      </div>
    </InTitleBar>
  );
}
