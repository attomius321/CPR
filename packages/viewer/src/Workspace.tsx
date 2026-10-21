import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type {
  BranchMerge,
  WorkspaceReplied,
  WorkspaceStart,
  WorkspaceSummary,
  WorkspaceThread,
  TerminalAvailability,
} from '@symbiote/core';
import { AgentTerminal, toTerminal, type OpenedTerminal } from './AgentTerminal.js';
import { reviewMarks, type ReviewMark } from './branchReviews.js';
import { ChangesPanel } from './ChangesPanel.js';
import { ChangesIcon } from './icons.js';
import { MoreActions, type MenuAction } from './MoreActions.js';
import { InTitleBar } from './TitleBar.js';
import { keyIsTaken } from './keys.js';
import { markdownNodes, useMarkdown } from './markdown.js';
import { MergeControl } from './MergeControl.js';
import { postJson } from './http.js';
import { Resizer } from './Resizer.js';
import {
  workspaceGroups,
  workspaceHref,
  workspaceName,
  replyMode,
  asksBeforeOpening,
  opensTerminal,
  terminalHint,
  startedNotice,
  startedWith,
  talkCommand,
  threadItems,
  verdictToSend,
  type WorkspaceRow,
} from './workspaces.js';
import { HISTORY_PAGE } from './pages.js';
import { useShell, type Notice } from './shell-context.js';
import { verdictLine } from './terminal.js';
import { readWorkspacesAgain, reloadWorkspaces, useWorkspaces } from './useWorkspaces.js';
import { loadWidths, saveWidth } from './widths.js';

/** `?send=verdict`: from the Review tab, the box filled with the review's verdict (V18c). */
const sendOfUrl = (): string | null => new URLSearchParams(window.location.search).get('send');

type View = 'terminal' | 'thread' | 'brief';

/**
 * `&thread`, `&terminal` or `&brief`: the tab picked (V21; the brief since V29a); without one, the
 * terminal where one can run, else the thread.
 */
const viewOfUrl = (): View | null => {
  const params = new URLSearchParams(window.location.search);
  return params.has('thread')
    ? 'thread'
    : params.has('terminal')
      ? 'terminal'
      : params.has('brief')
        ? 'brief'
        : null;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const CHANGES_KEY = 'symbiote.viewer.changes';

/** Whether the person hid the changes panel (V29d), kept in this browser; shown by default. */
function loadChangesShown(): boolean {
  try {
    return window.localStorage.getItem(CHANGES_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

function saveChangesShown(shown: boolean): void {
  try {
    window.localStorage.setItem(CHANGES_KEY, shown ? 'shown' : 'hidden');
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
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
  const row = [...groups.needsYou, ...groups.working, ...groups.done].find(
    (r) => r.workspace.branch === branch,
  );
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
      version={list}
      terminal={list.terminal}
      fillVerdict={send === 'verdict'}
      onNotice={notify}
      onGone={onGone}
    />
  );
}

/** Whether a workspace with commits merges into the default branch (V17's check), read once. */
function useMergeCheck(workspace: WorkspaceSummary): BranchMerge | null {
  const [merge, setMerge] = useState<BranchMerge | null>(null);
  const wanted = workspace.ahead > 0 && !workspace.merged && workspace.tip !== null;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    fetch(`/api/workspaces/merge?branch=${encodeURIComponent(workspace.branch)}`)
      .then((response) => (response.ok ? (response.json() as Promise<BranchMerge>) : null))
      .then((check) => live && setMerge(check))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [wanted, workspace.branch, workspace.tip]);
  return wanted ? merge : null;
}

function mergeText(merge: BranchMerge | null): string | null {
  if (!merge) return null;
  if ('clean' in merge) return `Merges cleanly into ${merge.into}`;
  if ('conflicts' in merge) {
    return `Conflicts with ${merge.into} in ${plural(merge.conflicts.length, 'file')}`;
  }
  return null;
}

/** What is next for a workspace, then its facts: commits, files not committed, the merge check. */
export function WorkspaceState({ row: { workspace, next } }: { row: WorkspaceRow }) {
  const merge = useMergeCheck(workspace);
  const facts = [
    workspace.ahead > 0 ? plural(workspace.ahead, 'commit') : 'no commits yet',
    workspace.worktree.changed
      ? `${plural(workspace.worktree.changed, 'file')} not committed yet`
      : null,
    workspace.worktree.exists ? null : 'its worktree is gone',
    mergeText(merge),
  ].filter((fact): fact is string => fact !== null);
  const text = [next.text, ...facts].join(' · ');
  return (
    <p className="workspace-state" title={text}>
      <strong>{next.text}</strong>
      {facts.map((fact) => (
        <span key={fact}> · {fact}</span>
      ))}
    </p>
  );
}

/** A workspace's kind before its name (V24c): none for a Feature, the common case. */
export function KindTag({ workspace }: { workspace: WorkspaceSummary }) {
  if (!workspace.kind || workspace.kind === 'feature') return null;
  return <span className="kind-tag">{workspace.kind}</span>;
}

/** A workspace's state as a dot (V29b): the colour of its mark on its branch's badges. */
export function StateDot({ row: { next } }: { row: WorkspaceRow }) {
  return <span className={`state-dot tone-${next.chip.tone}`} aria-hidden="true" />;
}

/** A workspace's branch (a link to its commits) and its review's mark. */
export function WorkspaceBranch({
  row: { workspace },
  mark,
}: {
  row: WorkspaceRow;
  mark?: ReviewMark | undefined;
}) {
  const { branch } = workspace;
  return (
    <>
      {workspace.tip === null ? (
        <span className="ref ref-branch">{branch}</span>
      ) : (
        <a
          className="ref ref-branch"
          href={`${HISTORY_PAGE}?branch=${encodeURIComponent(branch)}`}
          title={`${branch}: its commits`}
          onClick={(event) => event.stopPropagation()}
        >
          {branch}
        </a>
      )}
      {mark && (
        <span className={`ref-review ref-review-${mark.tone}`} title={mark.title}>
          {mark.mark}
        </span>
      )}
    </>
  );
}

/**
 * A workspace's thread (V18c), read when it is picked and with every read of the list (on focus,
 * every 5 s while an agent works or waits).
 */
function useThread(branch: string, version: unknown): [WorkspaceThread | null, () => void] {
  const [thread, setThread] = useState<WorkspaceThread | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(`/api/workspaces/thread?branch=${encodeURIComponent(branch)}`)
      .then((response) => (response.ok ? (response.json() as Promise<WorkspaceThread>) : null))
      .then((read) => live && setThread(read))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [branch, version, asked]);
  return [thread, useCallback(() => setAsked((n) => n + 1), [])];
}

const timeOf = (at: string) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * What the agent was told and reported, newest last; what it waits on as a line. It opens at its
 * end and follows new entries; a read with nothing new leaves it where the person scrolled. The
 * agent's reports are drawn as Markdown (plain text until the lexer is loaded); the person's
 * messages and Symbiote's prompt as written.
 */
function Thread({ thread, worktree }: { thread: WorkspaceThread | null; worktree: string }) {
  const list = useRef<HTMLOListElement>(null);
  const items = thread ? threadItems(thread.entries, worktree) : [];
  const lexer = useMarkdown();
  useLayoutEffect(() => {
    const box = list.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [items.length, lexer]);
  if (!thread) return <p className="hint">Reading its messages…</p>;
  return (
    <>
      {!thread.recorded && (
        <p className="hint">
          Symbiote keeps an agent's messages from V18c on: Talk shows this one's.
        </p>
      )}
      {thread.recorded && items.length === 0 && (
        <p className="hint">Nothing yet: the agent's reports and your messages show here.</p>
      )}
      {items.length > 0 && (
        <ol ref={list} className="thread">
          {items.map((item, i) => {
            const key = `${i}:${item.at}`;
            if (item.who === 'line' || item.who === 'waits') {
              return (
                <li key={key} className={`thread-${item.who}`} title={timeOf(item.at)}>
                  {item.text}
                </li>
              );
            }
            if (item.who === 'symbiote') {
              return (
                <li key={key} className="thread-item thread-symbiote">
                  <details>
                    <summary>
                      Symbiote's prompt · <time dateTime={item.at}>{timeOf(item.at)}</time>
                    </summary>
                    <div className="thread-text">{item.text}</div>
                  </details>
                </li>
              );
            }
            return (
              <li key={key} className={`thread-item thread-${item.who}`}>
                <div className="thread-who">
                  {item.who === 'agent' ? 'Agent' : 'You'} ·{' '}
                  <time dateTime={item.at}>{timeOf(item.at)}</time>
                </div>
                {item.who === 'agent' && lexer ? (
                  <div className="thread-text markdown">{markdownNodes(lexer(item.text))}</div>
                ) : (
                  <div className="thread-text">{item.text}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/**
 * What the agent was told — since V24 the kind and title as `#`, each part under `##` — drawn as
 * Markdown, as its reports are; as written until the lexer is loaded. Above it, how the agent was
 * started (V30b).
 */
function Brief({ text, started }: { text: string; started: string | null }) {
  const lexer = useMarkdown();
  return (
    <div className="workspace-brief">
      {started && <p className="workspace-started">{started}</p>}
      {lexer ? (
        <div className="markdown">{markdownNodes(lexer(text))}</div>
      ) : (
        <div className="workspace-brief-text">{text}</div>
      )}
    </div>
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
  version,
  terminal,
  fillVerdict,
  onNotice,
  onGone,
}: {
  row: WorkspaceRow;
  mark: ReviewMark | undefined;
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
  const { workspace } = row;
  const { branch, agent } = workspace;
  const [thread, reloadThread] = useThread(branch, version);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const [chosen, setChosen] = useState(viewOfUrl);
  const view: View =
    chosen === 'terminal' && !terminals
      ? 'thread'
      : (chosen ?? (terminals ? 'terminal' : 'thread'));
  const showTerminal = terminals && view === 'terminal';
  const [opened, setOpened] = useState<OpenedTerminal | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Attaching to a stopped session continues it (with no turn): asked when a terminal is to
  // open, not once it is open (a stop from the head leaves its last lines in view).
  const [asking, setAsking] = useState(() => asksBeforeOpening(agent));
  // The branch's changes at the right (V29d): `]` or the head's button shows or hides them.
  const [changesShown, setChangesShown] = useState(loadChangesShown);
  // As wide as the person dragged them (V34), kept in this browser.
  const [changesWidth, setChangesWidth] = useState(() => loadWidths().changes);
  const [resizing, setResizing] = useState(false);
  const resizeChanges = useCallback((width: number | null) => {
    setChangesWidth(width ?? undefined);
    saveWidth('changes', width);
  }, []);
  const toggleChanges = useCallback(
    () =>
      setChangesShown((shown) => {
        saveChangesShown(!shown);
        return !shown;
      }),
    [],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ']' || keyIsTaken(event)) return;
      event.preventDefault();
      toggleChanges();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleChanges]);
  const show = (next: View) => {
    setChosen(next);
    setEnded(null);
    setAsking(asksBeforeOpening(agent));
    const href = workspaceHref(branch);
    window.history.replaceState(null, '', next === 'terminal' ? href : `${href}&${next}`);
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

  const views: View[] = [...(terminals ? (['terminal'] as const) : []), 'thread', 'brief'];
  const tabName: Record<View, string> = { terminal: 'Terminal', thread: 'Thread', brief: 'Brief' };

  return (
    <section className="workspace" aria-label={`Workspace ${branch}`}>
      <header className={`workspace-top tone-${row.next.chip.tone}`}>
        <div className="workspace-title">
          <StateDot row={row} />
          <h1 className="workspace-about" title={workspace.brief}>
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
          {verdict && opened && showTerminal && (
            <button
              type="button"
              className="link"
              title="Types its first line and where the review is; Enter sends it"
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
              onClick={() =>
                act(() => postJson('/api/workspaces/stop', { branch }).then(() => 'Stopped'))
              }
            >
              Stop the agent
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
              title={`${changesShown ? 'Hide' : 'Show'} the branch's changes (])`}
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
        <WorkspaceState row={row} />
      </header>
      {confirming === 'clean' && (
        <p className="workspace-confirm">
          {branch} is not merged: Clean up removes its worktree and keeps the branch and its
          commits.{' '}
          <button type="button" className="button" onClick={() => clean(true)}>
            Clean up anyway
          </button>{' '}
          <button type="button" className="link" onClick={() => setConfirming(null)}>
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
          <InTitleBar>
            <div className="workspace-views" role="tablist" aria-label="Talk to the agent">
              {views.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={view === name}
                  className={view === name ? 'selected' : ''}
                  {...(name === 'terminal' ? { title: terminalHint(agent) } : {})}
                  onClick={() => show(name)}
                >
                  {tabName[name]}
                </button>
              ))}
            </div>
          </InTitleBar>
          <div className="workspace-body">
            {view === 'brief' && (
              <Brief text={workspace.brief} started={startedWith(workspace.agent)} />
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
            {view === 'thread' && (
              <div className="workspace-thread">
                <Thread thread={thread} worktree={workspace.worktree.path} />
                {terminals && (
                  <p className="hint thread-readonly">
                    The agent's messages and reports. To answer it,{' '}
                    <button type="button" className="link" onClick={() => show('terminal')}>
                      open its terminal
                    </button>
                    .
                  </p>
                )}
              </div>
            )}
          </div>
          <form
            hidden={terminals || view !== 'thread'}
            className="reply"
            onSubmit={(event) => {
              event.preventDefault();
              send(false);
            }}
          >
            <textarea
              aria-label="Reply to the agent"
              placeholder="Reply to the agent…"
              value={text}
              rows={3}
              disabled={mode === 'none'}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  send(false);
                }
              }}
            />
            <div className="reply-actions">
              {verdict && (
                <button
                  type="button"
                  className="link"
                  title={`Your ${verdict.event === 'approve' ? 'approval' : 'review'} at ${verdict.head.slice(0, 7)}, in words for the agent`}
                  onClick={() => setText(verdict.text)}
                >
                  Send the verdict
                </button>
              )}
              {mode === 'none' && (
                <span className="hint">No session to continue: start the agent again.</span>
              )}
              {confirming === 'send' ? (
                <span className="workspace-confirm">
                  Sending stops the agent's turn
                  {agent.waitingFor ? ` and what it waits on (${agent.waitingFor})` : ''}.{' '}
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => send(true)}
                  >
                    Stop it and send
                  </button>{' '}
                  <button type="button" className="link" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="submit"
                  className="button"
                  disabled={busy || mode === 'none' || text.trim() === ''}
                  title="Ctrl+Enter"
                >
                  {mode === 'stop-and-send' ? 'Stop and send' : 'Send'}
                </button>
              )}
            </div>
          </form>
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
