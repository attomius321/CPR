import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  WorkspaceReplied,
  WorkspaceShell,
  WorkspaceShells,
  WorkspaceStart,
  TerminalAvailability,
} from '@symbiote/core';
import {
  AgentTerminal,
  AttachImages,
  lastTerminalSize,
  toTerminal,
  type OpenedTerminal,
} from './AgentTerminal.js';
import { reviewMarks, type ReviewMark } from '../history/branchReviews.js';
import { ActivityTab } from './ActivityTab.js';
import { BriefTab } from './BriefTab.js';
import { ChangesPanel } from './ChangesPanel.js';
import { useChangesPanel } from './useChangesPanel.js';
import { ReplyForm } from './ReplyForm.js';
import { WorkspaceTabs, type AgentView, type View } from './WorkspaceTabs.js';
import { ChangesIcon } from '../ui/icons.js';
import { MoreActions, type MenuAction } from '../ui/MoreActions.js';
import { InTitleBar } from '../shell/TitleBar.js';
import { MergeControl } from './MergeControl.js';
import { ThreadTab, useThread } from './ThreadTab.js';
import { KindTag, StateDot, StateFor, WorkspaceBranch, WorkspaceState } from './WorkspaceFacts.js';
import { RESPOND_EVENT, respondTo } from './respond.js';
import { WorkspaceStrip } from './WorkspaceStrip.js';
import { postJson, serverWords } from '../ui/http.js';
import { Resizer } from '../ui/Resizer.js';
import {
  allRows,
  workspaceGroups,
  workspaceHref,
  workspaceName,
  briefTip,
  replyMode,
  asksBeforeOpening,
  opensTerminal,
  startedNotice,
  startedWith,
  talkCommand,
  verdictToSend,
  type WorkspaceRow,
} from './workspaces.js';
import { HISTORY_PAGE } from '../shell/pages.js';
import { useShell, type Notice } from '../shell/shell-context.js';
import { verdictLine } from './terminal.js';
import { closeQuestion, shellAfter, shellOfUrl, withShell } from './shells.js';
import { readWorkspacesAgain, reloadWorkspaces, useWorkspaces } from './useWorkspaces.js';
import { tip } from '../ui/tip.js';

/** `?send=verdict`: from the Review tab, the box filled with the review's verdict (V18c). */
const sendOfUrl = (): string | null => new URLSearchParams(window.location.search).get('send');

/**
 * `&thread`, `&terminal`, `&activity`, `&brief` or `&shell=<n>`: the tab picked (V21; the brief
 * since V29a, a shell since V45, the activity since V48); without one, the terminal where one can
 * run, else the thread.
 */
const viewOfUrl = (): View | null => {
  const params = new URLSearchParams(window.location.search);
  return params.has('thread')
    ? 'thread'
    : params.has('terminal')
      ? 'terminal'
      : params.has('activity')
        ? 'activity'
        : params.has('brief')
          ? 'brief'
          : shellOfUrl(window.location.search) !== null
            ? 'shell'
            : null;
};

/** A workspace's shells (V45): its terminals' IDs, so read with the page's header. */
async function readShells(branch: string): Promise<WorkspaceShell[]> {
  const response = await fetch(`/api/workspaces/shells?branch=${encodeURIComponent(branch)}`, {
    headers: { 'x-symbiote': '1' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(serverWords(text));
  return (JSON.parse(text) as WorkspaceShells).shells;
}

/**
 * A workspace in the shell's main area (V29a; the Workspaces page's panel before it): its state
 * and actions, then its terminal, its thread or its brief. The address names it (`/?branch=`).
 */
export function WorkspaceView({ branch }: { branch: string }) {
  const shell = useShell();
  const { list, reviews } = useWorkspaces();
  // The Review tab's "Send to the agent" opens the workspace with `&send=verdict`, once.
  const [send] = useState(sendOfUrl);
  const groups = useMemo(() => workspaceGroups(list?.workspaces ?? [], reviews), [list, reviews]);
  const marks = useMemo(() => reviewMarks(reviews).marks, [reviews]);
  const row = allRows(groups).find((r) => r.workspace.branch === branch);
  const notify = useCallback((notice: Notice | null) => shell?.notify(notice), [shell]);
  const onGone = useCallback(() => shell?.navigate({ page: 'history' }), [shell]);
  if (!list) return <p className="hint main-hint">Listing workspaces…</p>;
  if (!row) {
    return (
      <div className="main-empty">
        <p>No workspace {branch}.</p>
        <p className="hint">
          It was cleaned up, or started elsewhere. The sidenav lists the workspaces there are;{' '}
          <a href={`${HISTORY_PAGE}?branch=${encodeURIComponent(branch)}`}>History</a> shows its
          branch, if it is still there.
        </p>
      </div>
    );
  }
  return (
    <WorkspacePanel
      key={branch}
      row={row}
      mark={marks.get(branch)}
      waiting={groups.waiting.map((r) => r.workspace.branch).filter((b) => b !== branch)}
      version={list}
      terminal={list.terminal}
      fillVerdict={send === 'verdict'}
      onNotice={notify}
      onGone={onGone}
    />
  );
}

/**
 * The picked workspace (V18c; in the shell's main area since V29a): its state and actions, then
 * its terminal, its thread with one box whose message continues the agent's session, or its
 * brief. Nothing is sent without Send (decision 82); sending to an agent that works, or waits on
 * a prompt, ends its turn, so that is asked first.
 */
function WorkspacePanel({
  row,
  mark,
  waiting,
  version,
  terminal,
  fillVerdict,
  onNotice,
  onGone,
}: {
  row: WorkspaceRow;
  mark: ReviewMark | undefined;
  /** The other workspaces whose agent waits for the person (V48), in the sidenav's order. */
  waiting: string[];
  /** The list as last read: the thread is read again with it. */
  version: unknown;
  /** Whether its agent's session can be shown in a terminal (V21). */
  terminal: TerminalAvailability | undefined;
  /** Fill the box with the review's verdict once it is read (`?send=verdict`). */
  fillVerdict: boolean;
  onNotice: (notice: Notice | null) => void;
  /** It was cleaned up: the main area shows something else. */
  onGone: () => void;
}) {
  const shell = useShell();
  const { workspace } = row;
  const { branch, agent } = workspace;
  const [thread, reloadThread] = useThread(branch, version);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Its stop asked, until the server answers (V48): the button says so.
  const [stopping, setStopping] = useState(false);
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState<'send' | 'clean' | null>(null);
  const filled = useRef(false);
  const mode = replyMode(agent);
  const verdict = verdictToSend(thread);
  // V21: the agent's own session in a terminal, where one can run: the panel opens on it, and the
  // thread is its history, read only (one way to answer the agent: the box stops its session).
  // Claude Code's, and Codex's on its app server (V27b): through Symbiote's runner, Codex's turns
  // in a terminal would not reach its thread (decision 133).
  const terminals = opensTerminal(agent, terminal);
  const talk = talkCommand(agent, workspace.worktree.path);
  // V45: shells in its worktree, in tabs after the agent's, whatever its agent; kept by the server
  // until closed, so read when the panel opens (a reload, another window).
  const shellsCan = terminal?.available === true && workspace.worktree.exists;
  const [shells, setShells] = useState<WorkspaceShell[] | null>(null);
  const [shellShown, setShellShown] = useState(() => shellOfUrl(window.location.search));
  const [closing, setClosing] = useState<{ shell: WorkspaceShell; question: string } | null>(null);
  const [chosen, setChosen] = useState(viewOfUrl);
  const fallback: AgentView = terminals ? 'terminal' : 'thread';
  // The shell picked; once it went (closed, exited), its neighbour, the one before first; none
  // left, or `symbiote view` started again: the agent's tab.
  const shellNumber =
    shellShown === null || shells === null || shells.some((shell) => shell.number === shellShown)
      ? shellShown
      : shellAfter(shells, shellShown);
  const shellGone = chosen === 'shell' && (!shellsCan || (shells !== null && shellNumber === null));
  const view: View =
    chosen === 'terminal' && !terminals ? 'thread' : shellGone ? fallback : (chosen ?? fallback);
  const showTerminal = terminals && view === 'terminal';
  const shownShell =
    view === 'shell' ? shells?.find((shell) => shell.number === shellNumber) : undefined;
  const [opened, setOpened] = useState<OpenedTerminal | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Attaching to a stopped session continues it (with no turn): asked when a terminal is to
  // open, not once it is open (a stop from the head leaves its last lines in view).
  const [asking, setAsking] = useState(() => asksBeforeOpening(agent));
  // The branch's changes at the right (V29d), shown or hidden, as wide as they were dragged.
  const { changesShown, toggleChanges, changesWidth, resizeChanges, resizing, setResizing } =
    useChangesPanel();
  useEffect(() => {
    if (!shellsCan) return;
    let gone = false;
    readShells(branch).then(
      (read) => !gone && setShells(read),
      (e: unknown) => {
        if (gone) return;
        setShells([]);
        setSaid((e as Error).message);
      },
    );
    return () => {
      gone = true;
    };
  }, [branch, shellsCan]);
  const show = (next: AgentView) => {
    setChosen(next);
    setEnded(null);
    setAsking(asksBeforeOpening(agent));
    const href = workspaceHref(branch);
    window.history.replaceState(null, '', next === 'terminal' ? href : `${href}&${next}`);
  };
  /**
   * Takes the person's answer (V48): its terminal shown and focused where one runs, else the
   * thread and its box. A terminal not open yet focuses itself as it opens.
   */
  const respond = () => {
    if (terminals) {
      if (view !== 'terminal') show('terminal');
      opened?.focus();
      return;
    }
    if (view !== 'thread') show('thread');
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('.workspace .reply textarea')?.focus(),
    );
  };
  const respondNow = useRef(respond);
  respondNow.current = respond;
  useEffect(() => {
    const onRespond = (event: Event) => {
      if ((event as CustomEvent<string>).detail === branch) respondNow.current();
    };
    window.addEventListener(RESPOND_EVENT, onRespond);
    return () => window.removeEventListener(RESPOND_EVENT, onRespond);
  }, [branch]);
  const showShell = (number: number) => {
    setChosen('shell');
    setShellShown(number);
    window.history.replaceState(null, '', `${workspaceHref(branch)}&shell=${number}`);
  };
  /** Opens a shell at the size the last terminal was drawn at; it is fitted once shown. */
  const openShell = () =>
    postJson<WorkspaceShell>('/api/workspaces/shell', { branch, ...lastTerminalSize() }).then(
      (opened) => {
        setShells((now) => withShell(now ?? [], opened));
        showShell(opened.number);
      },
      (e: unknown) => setSaid((e as Error).message),
    );
  /** A shell closed or exited: its tab goes. Twice is once: a close is followed by its exit. */
  const forgetShell = (id: string) =>
    setShells((now) => now?.filter((shell) => shell.id !== id) ?? now);
  // The picked tab in sight when the strip scrolls (many shells, a narrow window): when it is
  // picked, and when the strip narrows.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const reveal = () =>
      element
        .querySelector('[role="tab"][aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(element);
    return () => observer.disconnect();
  }, [view, shellNumber, shells?.length]);
  // What is drawn for a shell that went is its neighbour's tab: the address says so too.
  useEffect(() => {
    if (chosen !== 'shell' || shells === null || shellNumber === shellShown) return;
    if (shellNumber === null) show(fallback);
    else showShell(shellNumber);
  });
  /** Closes a shell; with a program running in it, asked first (decision 298). */
  const closeShell = async (shell: WorkspaceShell, asked = false) => {
    if (!asked) {
      const read = await readShells(branch).catch(() => null);
      const now = read?.find((other) => other.id === shell.id) ?? shell;
      const question = closeQuestion(now);
      if (question) {
        setClosing({ shell: now, question });
        return;
      }
    }
    setClosing(null);
    // Already gone (it exited meanwhile): closed all the same.
    await toTerminal(shell.id, 'close', {}).catch(() => {});
    forgetShell(shell.id);
  };
  /** Types the verdict's line into the open terminal, without Enter (decision 114). */
  const typeVerdict = (into: OpenedTerminal, text: string) =>
    toTerminal(into.id, 'in', { data: verdictLine(text) }).then(
      () => into.focus(),
      (e: unknown) => setSaid((e as Error).message),
    );

  // From the Review tab (`?send=verdict`): the verdict in the box, or typed into the terminal.
  useEffect(() => {
    if (!fillVerdict || filled.current || !verdict) return;
    if (terminals) {
      if (!showTerminal || !opened) return;
      filled.current = true;
      void typeVerdict(opened, verdict.text);
      return;
    }
    filled.current = true;
    setText(verdict.text);
  }, [fillVerdict, verdict, terminals, showTerminal, opened]);

  const live = agent.state === 'working' || agent.state === 'needs-you';
  const restartable =
    agent.kind !== undefined &&
    ['not-started', 'failed', 'stopped', 'not-running'].includes(agent.state);

  /** Runs an action, says how it went in the panel; the list (and thread) are read again. */
  const act = (task: () => Promise<string | null>) => {
    setBusy(true);
    task()
      .then((words) => setSaid(words))
      .catch((e: unknown) => setSaid(`${(e as Error).message}`))
      .finally(() => {
        setBusy(false);
        void reloadWorkspaces();
        reloadThread();
      });
  };
  const copy = (words: string, what: string) =>
    navigator.clipboard.writeText(words).then(
      () => `Copied ${what}`,
      () => `Could not copy ${what}`,
    );

  const send = (stop: boolean) => {
    if (text.trim() === '' || busy) return;
    if (mode === 'stop-and-send' && !stop) {
      setConfirming('send');
      return;
    }
    setConfirming(null);
    act(() =>
      postJson<WorkspaceReplied>('/api/workspaces/reply', {
        branch,
        text,
        ...(stop ? { stop: true } : {}),
      }).then(
        (replied) => {
          setText('');
          return replied.copy ? `Sent, but Claude Code started a copy: ${replied.copy}` : 'Sent';
        },
        (e: unknown) => {
          // Its turn started meanwhile: ask before stopping it.
          if (/sending stops its turn/.test((e as Error).message)) setConfirming('send');
          throw e;
        },
      ),
    );
  };

  const clean = (unmerged: boolean) => {
    setConfirming(null);
    act(() =>
      postJson('/api/workspaces/clean', { branch, ...(unmerged ? { unmerged: true } : {}) }).then(
        () => {
          onNotice({ text: `Cleaned up ${branch}: its worktree is removed.` });
          onGone();
          return null;
        },
      ),
    );
  };

  const more: MenuAction[] = [
    ...(workspace.worktree.exists
      ? [
          {
            label: 'Open in VS Code',
            disabled: busy,
            onSelect: () =>
              act(() =>
                postJson('/api/workspaces/open', { branch }).then(() => 'Opened in VS Code'),
              ),
          },
        ]
      : []),
    ...(talk && !terminals
      ? [
          {
            label: 'Talk',
            title: `Talk to the agent in a terminal: ${talk}${
              agent.kind === 'codex' && !agent.remote
                ? ' (its turns there are not recorded in this thread)'
                : terminal && !terminal.available
                  ? ` (no terminal here: ${terminal.reason})`
                  : ''
            }`,
            onSelect: () => act(() => copy(talk, `${talk}: paste it in a terminal`)),
          },
        ]
      : []),
    {
      label: 'Copy the prompt',
      disabled: busy,
      onSelect: () =>
        act(async () => {
          const response = await fetch(
            `/api/workspaces/prompt?branch=${encodeURIComponent(branch)}`,
          );
          if (!response.ok) throw new Error(await response.text());
          const { prompt } = (await response.json()) as { prompt: string };
          return copy(prompt, 'the prompt');
        }),
    },
    ...(workspace.merged || !live
      ? [
          {
            label: workspace.merged ? 'Clean up' : 'Clean up…',
            disabled: busy,
            title: workspace.merged
              ? 'Remove its sessions, its worktree and its merged branch'
              : 'Not merged: remove its worktree, keep the branch',
            onSelect: () => (workspace.merged ? clean(false) : setConfirming('clean')),
          },
        ]
      : []),
  ];

  const views: AgentView[] = [
    ...(terminals ? (['terminal'] as const) : []),
    'thread',
    'activity',
    'brief',
  ];

  return (
    <section className="workspace" aria-label={`Workspace ${branch}`}>
      <header className={`workspace-top tone-${row.next.chip.tone}`}>
        <div className="workspace-title">
          <StateDot row={row} />
          <h1 className="workspace-about" {...tip(briefTip(workspace.brief))}>
            <KindTag workspace={workspace} />
            {workspaceName(workspace)}
          </h1>
          <span className="workspace-ref">
            <WorkspaceBranch row={row} mark={mark} />
          </span>
        </div>
        <div className="workspace-actions">
          {said && (
            <span className="workspace-said" role="status">
              {said}
            </span>
          )}
          {opened && showTerminal && <AttachImages into={opened} />}
          {verdict && opened && showTerminal && (
            <button
              type="button"
              className="link"
              {...tip('Types its first line and where the review is\nEnter sends it')}
              onClick={() => void typeVerdict(opened, verdict.text)}
            >
              Send the verdict
            </button>
          )}
          {live && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                setStopping(true);
                // The head's state says Stopped: no word of its own beside the buttons (V37).
                act(() =>
                  postJson('/api/workspaces/stop', { branch })
                    .then(() => null)
                    .finally(() => setStopping(false)),
                );
              }}
            >
              {stopping ? 'Stopping…' : 'Stop the agent'}
            </button>
          )}
          {restartable && workspace.worktree.exists && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                act(() =>
                  postJson<WorkspaceStart>('/api/workspaces/start', { branch }).then((start) => {
                    onNotice(startedNotice(start));
                    return null;
                  }),
                )
              }
            >
              Start the agent
            </button>
          )}
          {workspace.ahead > 0 && !workspace.merged && <MergeControl branch={branch} />}
          <InTitleBar at="end">
            <button
              type="button"
              className="icon-button changes-toggle"
              aria-label="Changes"
              aria-pressed={changesShown}
              {...tip(`${changesShown ? 'Hide' : 'Show'} the branch's changes`, { keys: ']' })}
              onClick={toggleChanges}
            >
              <ChangesIcon />
            </button>
          </InTitleBar>
          <MoreActions actions={more} />
          {workspace.ahead > 0 && workspace.tip !== null && (
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const { url } = await postJson<{ url: string }>('/api/reviews', { ref: branch });
                  window.location.assign(url);
                  return null;
                })
              }
            >
              Review
            </button>
          )}
        </div>
        <div className="workspace-state-line">
          <WorkspaceState row={row} />
          <StateFor workspace={workspace} />
        </div>
      </header>
      <WorkspaceStrip
        row={row}
        waiting={waiting}
        onRespond={respond}
        onThread={() => show('thread')}
        onNext={(next) => respondTo(next, (route) => shell?.navigate(route))}
      />
      {closing && (
        <p className="workspace-confirm">
          {closing.question}{' '}
          <button
            type="button"
            className="button"
            onClick={() => void closeShell(closing.shell, true)}
          >
            Close it
          </button>{' '}
          <button type="button" className="button ghost" onClick={() => setClosing(null)}>
            Cancel
          </button>
        </p>
      )}
      {confirming === 'clean' && (
        <p className="workspace-confirm">
          {branch} is not merged: Clean up removes its worktree and keeps the branch and its
          commits.{' '}
          <button type="button" className="button" onClick={() => clean(true)}>
            Clean up anyway
          </button>{' '}
          <button type="button" className="button ghost" onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </p>
      )}
      <div
        className={`workspace-split${resizing ? ' resizing' : ''}`}
        style={
          changesWidth ? ({ '--changes-width': `${changesWidth}px` } as CSSProperties) : undefined
        }
      >
        <div className="workspace-main">
          <WorkspaceTabs
            stripRef={strip}
            views={views}
            view={view}
            agent={agent}
            shells={shells}
            shellsCan={shellsCan}
            shellNumber={shellNumber}
            onShow={show}
            onShowShell={showShell}
            onCloseShell={(shell) => void closeShell(shell)}
            onOpenShell={() => void openShell()}
          />
          <div className="workspace-body">
            {view === 'activity' && (
              <div className="workspace-activity">
                <ActivityTab workspace={workspace} thread={thread} version={version} />
              </div>
            )}
            {view === 'brief' && (
              <BriefTab
                text={workspace.brief}
                started={startedWith(workspace.agent, workspace.via)}
                documents={workspace.documents}
              />
            )}
            {showTerminal && (
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
                        // A stop ends the terminal before the list says so: the state is read anew.
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
              </div>
            )}
            {shownShell && (
              <div className="workspace-terminal">
                <AgentTerminal
                  key={shownShell.id}
                  id={shownShell.id}
                  onEnded={() => forgetShell(shownShell.id)}
                />
              </div>
            )}
            {view === 'thread' && (
              <div className="workspace-thread">
                <ThreadTab thread={thread} worktree={workspace.worktree.path} />
                {terminals && (
                  <p className="hint thread-readonly">
                    To answer,{' '}
                    <button type="button" className="link" onClick={() => show('terminal')}>
                      open its terminal
                    </button>
                    .
                  </p>
                )}
              </div>
            )}
          </div>
          <ReplyForm
            hidden={terminals || view !== 'thread'}
            text={text}
            mode={mode}
            verdict={verdict}
            confirming={confirming === 'send'}
            busy={busy}
            waitingFor={agent.waitingFor}
            onText={setText}
            onSend={send}
            onCancel={() => setConfirming(null)}
          />
        </div>
        {changesShown && (
          <Resizer
            label="Resize changes panel"
            side="after"
            variable="--changes-width"
            min={200}
            room={480}
            onResize={resizeChanges}
            onDrag={setResizing}
          />
        )}
        {changesShown && <ChangesPanel branch={branch} version={version} onSaid={setSaid} />}
      </div>
    </section>
  );
}
