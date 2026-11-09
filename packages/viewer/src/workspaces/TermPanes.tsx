// A workspace's terminal panes (V45, V89; decision 831): its agent's and a shell's, side by side in
// Split, the agent's pane first at one place in the tree.
import type { WorkspaceSummary, WorkspaceShell } from '@symbiote/core';
import type { ReactNode, Dispatch, SetStateAction } from 'react';
import { AgentTerminal, type OpenedTerminal } from './AgentTerminal.js';
import { barOf } from './terminal-bar.js';
import { agentTabName } from './workspace-steps.js';
import type { View } from './WorkspaceTabs.js';
import { ExpandIcon } from '../ui/icons.js';
import { asksBeforeOpening } from './workspaces.js';
import { shellName } from './shells.js';
import { readWorkspacesAgain } from './useWorkspaces.js';
import { tip } from '../ui/tip.js';

/** The terminals shown: the agent's, a shell's, or both in Split, each with its head in Split. */
export function TermPanes({
  showTerminal,
  shownShell,
  splitNumber,
  agentName,
  bar,
  toggleSplit,
  asking,
  setAsking,
  attempt,
  setAttempt,
  branch,
  agent,
  setOpened,
  ended,
  setEnded,
  forgetShell,
  setShellsQuiet,
  setSplit,
  setChosen,
  setShellShown,
  address,
}: {
  showTerminal: boolean;
  shownShell: WorkspaceShell | undefined;
  splitNumber: number | null;
  agentName: ReturnType<typeof agentTabName>;
  bar: ReturnType<typeof barOf>;
  toggleSplit: () => void;
  /** Opening the terminal continues a stopped session: asked first. */
  asking: boolean;
  setAsking: Dispatch<SetStateAction<boolean>>;
  /** Bumped to open the agent's terminal again. */
  attempt: number;
  setAttempt: Dispatch<SetStateAction<number>>;
  branch: string;
  agent: WorkspaceSummary['agent'];
  setOpened: Dispatch<SetStateAction<OpenedTerminal | null>>;
  ended: string | null;
  setEnded: Dispatch<SetStateAction<string | null>>;
  forgetShell: (id: string) => void;
  setShellsQuiet: Dispatch<SetStateAction<number>>;
  setSplit: Dispatch<SetStateAction<number | null>>;
  setChosen: Dispatch<SetStateAction<View | null>>;
  setShellShown: Dispatch<SetStateAction<number | null>>;
  address: (next: string | null) => void;
}) {
  const pane = (head: ReactNode, body: ReactNode, key: string) => (
    <div key={key} className="term-pane">
      {splitNumber !== null && <div className="term-pane-head">{head}</div>}
      {body}
    </div>
  );

  return (
    <>
      {(showTerminal || shownShell) && (
        <div className={`term-panes${splitNumber !== null ? ' split' : ''}`}>
          {/* The agent's pane first, at one place in the tree whether Split is on or off:
          a toggle resizes its terminal, never attaches it again (decision 831). */}
          {showTerminal &&
            pane(
              <>
                <span className="term-pane-name">{agentName.name}</span>
                <span className="term-pane-what">{bar.detail ?? bar.text}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${agentName.name} alone`}
                  {...tip('This terminal alone')}
                  onClick={toggleSplit}
                >
                  <ExpandIcon />
                </button>
              </>,
              <div className="workspace-terminal">
                {asking ? (
                  <p className="workspace-confirm">
                    Opening the terminal continues the stopped session.{' '}
                    <button type="button" className="button" onClick={() => setAsking(false)}>
                      Open the terminal
                    </button>
                  </p>
                ) : (
                  <AgentTerminal
                    key={attempt}
                    branch={branch}
                    onOpened={setOpened}
                    onEnded={setEnded}
                  />
                )}
                {ended && (
                  <p className="workspace-confirm">
                    The terminal {ended === 'exited' ? 'ended' : 'lost its session'}.{' '}
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        setEnded(null);
                        // A stop ends the terminal before the list says so: the state is
                        // read anew.
                        void readWorkspacesAgain().then(({ list }) => {
                          const now = list?.workspaces.find((f) => f.branch === branch)?.agent
                            .state;
                          setAsking(asksBeforeOpening({ ...agent, state: now ?? agent.state }));
                          setAttempt((n) => n + 1);
                        });
                      }}
                    >
                      Open again
                    </button>
                  </p>
                )}
              </div>,
              'agent',
            )}
          {shownShell &&
            pane(
              <>
                <span className="term-pane-name">{shellName(shownShell.number)}</span>
                {shownShell.running && <span className="term-pane-what">{shownShell.running}</span>}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${shellName(shownShell.number)} alone`}
                  {...tip('This terminal alone')}
                  onClick={() => {
                    setSplit(null);
                    setChosen('shell');
                    setShellShown(shownShell.number);
                    address(`shell=${shownShell.number}`);
                  }}
                >
                  <ExpandIcon />
                </button>
              </>,
              <div className="workspace-terminal">
                <AgentTerminal
                  key={shownShell.id}
                  id={shownShell.id}
                  onEnded={() => forgetShell(shownShell.id)}
                  onQuiet={() => setShellsQuiet((n) => n + 1)}
                />
              </div>,
              `shell-${shownShell.id}`,
            )}
        </div>
      )}
    </>
  );
}
