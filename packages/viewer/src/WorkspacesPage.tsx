import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  BranchMerge,
  WorkspaceReplied,
  WorkspaceStart,
  WorkspaceSummary,
  WorkspaceThread,
  TerminalAvailability,
} from '@cpr/core';
import { AgentTerminal, toTerminal, type OpenedTerminal } from './AgentTerminal.js';
import { reviewMarks, type ReviewMark } from './branchReviews.js';
import { relativeDate } from './commits.js';
import { markdownNodes, useMarkdown } from './markdown.js';
import { useWorkspaceStarter } from './WorkspaceStarter.js';
import { postJson } from './http.js';
import {
  workspaceGroups,
  workspaceHref,
  workspaceName,
  replyMode,
  startedNotice,
  talkCommand,
  threadItems,
  verdictToSend,
  type WorkspaceRow,
} from './workspaces.js';
import { HISTORY_PAGE, WORKSPACES_PAGE } from './pages.js';
import { verdictLine } from './terminal.js';
import { readWorkspacesAgain, reloadWorkspaces, useWorkspaces } from './useWorkspaces.js';

/** `?branch=<name>`: the workspace picked (V18b's address, V18c's selection). */
const branchOfUrl = (): string | null => new URLSearchParams(window.location.search).get('branch');
/** `?send=verdict`: from the Review tab, the box filled with the review's verdict (V18c). */
const sendOfUrl = (): string | null => new URLSearchParams(window.location.search).get('send');
/**
 * `&thread` or `&terminal`: the panel's lower part as picked (V21); without either, the terminal
 * where one can run, else the thread.
 */
const viewOfUrl = (): 'thread' | 'terminal' | null => {
  const params = new URLSearchParams(window.location.search);
  return params.has('thread') ? 'thread' : params.has('terminal') ? 'terminal' : null;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Both columns from this width; narrower, the panel takes the page. */
const WIDE = '(min-width: 1100px)';

/** What the page says after an action: a start, a copy. */
interface Notice {
  text: string;
  warning?: string;
  copy?: string;
}

const GROUPS = [
  ['needsYou', 'Needs you'],
  ['working', 'Working'],
  ['done', 'Done'],
] as const;

/** Whether the window is wide enough for the list and the panel side by side. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const media = window.matchMedia(WIDE);
    const changed = () => setWide(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  return wide;
}

/**
 * The workspaces view (V18b, V18c): the workspaces started from CPR, grouped by what each needs from
 * the person — needs you, working, done —, and beside them the picked workspace: its state and
 * actions, what its agent reported and was told, and a box to answer it. `?branch=` picks one;
 * on a wide window the first workspace is picked when none is.
 */
export function WorkspacesPage() {
  const { list, reviews } = useWorkspaces();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState(branchOfUrl);
  const [flashed, setFlashed] = useState(branchOfUrl);
  const [send] = useState(sendOfUrl);
  const wide = useWide();
  /** Picks a workspace (or none), the address following without a new history entry. */
  const pick = useCallback((branch: string | null) => {
    setPicked(branch);
    window.history.replaceState(null, '', branch ? workspaceHref(branch) : WORKSPACES_PAGE);
  }, []);
  const started = useCallback(
    (start: WorkspaceStart) => {
      setNotice(startedNotice(start));
      pick(start.workspace.branch);
      setFlashed(start.workspace.branch);
    },
    [pick],
  );
  const starter = useWorkspaceStarter(started, setError);
  const groups = useMemo(() => workspaceGroups(list?.workspaces ?? [], reviews), [list, reviews]);
  const marks = useMemo(() => reviewMarks(reviews).marks, [reviews]);
  const rows = [...groups.needsYou, ...groups.working, ...groups.done];
  const current =
    rows.find((r) => r.workspace.branch === picked) ?? (wide && !picked ? rows[0] : undefined);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || starter.isOpen) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.key === 'n') starter.open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [starter]);

  return (
    <div className="workspaces">
      <h1 className="commits-title">
        Workspaces
        <span className="commits-help">
          What each workspace's agent needs from you · pick one to answer it · a branch name goes to
          its commits · n starts one
        </span>
        <span className="commits-actions">
          <button
            type="button"
            className="start-workspace"
            title="Start a workspace: a branch, its worktree and an agent (n)"
            onClick={() => starter.open()}
          >
            Start a workspace
            <kbd aria-hidden="true">n</kbd>
          </button>
        </span>
      </h1>
      {notice && <NoticeLine notice={notice} />}
      {/* Why they are kept where they are (CPR's cache), or a folder left from before (V25). */}
      {list?.note && <p className="hint workspaces-note">{list.note}</p>}
      {error && (
        <p className="commits-error error" role="alert">
          {error}
        </p>
      )}
      {!list ? (
        <p className="hint">Listing workspaces…</p>
      ) : list.workspaces.length === 0 ? (
        <div className="hint workspaces-empty">
          <p>
            No workspaces yet. Start one: describe the work, and CPR makes its branch and worktree
            and starts an agent there.
          </p>
          <p>
            Start a workspace above (n), or pick a commit to start from in the repository&apos;s{' '}
            <a href={HISTORY_PAGE}>History</a> (h).
          </p>
        </div>
      ) : (
        <div className={`workspaces-body${current ? ' has-panel' : ''}`}>
          <div className="workspaces-list">
            {GROUPS.map(([key, title]) =>
              groups[key].length === 0 ? null : (
                <section key={key} className="workspace-group" aria-label={title}>
                  <h2>
                    {title} <span className="branches-count">{groups[key].length}</span>
                  </h2>
                  <ul className="workspace-list">
                    {groups[key].map((row) => (
                      <WorkspaceItem
                        key={row.workspace.branch}
                        row={row}
                        mark={marks.get(row.workspace.branch)}
                        picked={row === current}
                        flashed={row.workspace.branch === flashed}
                        onPick={() => pick(row.workspace.branch)}
                      />
                    ))}
                  </ul>
                </section>
              ),
            )}
          </div>
          {current && (
            <WorkspacePanel
              key={current.workspace.branch}
              row={current}
              mark={marks.get(current.workspace.branch)}
              version={list}
              terminal={list.terminal}
              fillVerdict={send === 'verdict' && current.workspace.branch === branchOfUrl()}
              onNotice={setNotice}
              onError={setError}
              onBack={() => pick(null)}
            />
          )}
        </div>
      )}
      {starter.dialog}
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <p className="checkout-notice" role="status">
      {notice.text}
      {notice.warning && <span className="warning"> · {notice.warning}</span>}
      {notice.copy !== undefined && (
        <>
          {' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              navigator.clipboard
                .writeText(notice.copy ?? '')
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied === null ? 'Copy the prompt' : copied ? 'Copied' : 'Could not copy'}
          </button>
        </>
      )}
    </p>
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
function WorkspaceState({ row: { workspace, next } }: { row: WorkspaceRow }) {
  const merge = useMergeCheck(workspace);
  const facts = [
    workspace.ahead > 0 ? plural(workspace.ahead, 'commit') : 'no commits yet',
    workspace.worktree.changed
      ? `${plural(workspace.worktree.changed, 'file')} not committed yet`
      : null,
    workspace.worktree.exists ? null : 'its worktree is gone',
    mergeText(merge),
  ].filter((fact): fact is string => fact !== null);
  return (
    <p className="workspace-state">
      <strong>{next.text}</strong>
      {facts.map((fact) => (
        <span key={fact}> · {fact}</span>
      ))}
    </p>
  );
}

/** A workspace's kind before its name (V24c): none for a Feature, the common case. */
function KindTag({ workspace }: { workspace: WorkspaceSummary }) {
  if (!workspace.kind || workspace.kind === 'feature') return null;
  return <span className="kind-tag">{workspace.kind}</span>;
}

/** A workspace's mark: what it needs, as its branch's badges show it. */
function WorkspaceChip({ row: { next } }: { row: WorkspaceRow }) {
  return (
    <span className={`workspace-mark workspace-mark-${next.chip.tone}`} aria-hidden="true">
      {next.chip.mark}
    </span>
  );
}

/** A workspace's branch (a link to its commits) and its review's mark. */
function WorkspaceBranch({ row: { workspace }, mark }: { row: WorkspaceRow; mark?: ReviewMark }) {
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

/** A workspace in the list: what it is and what it needs; a click picks it. */
function WorkspaceItem({
  row,
  mark,
  picked,
  flashed,
  onPick,
}: {
  row: WorkspaceRow;
  mark: ReviewMark | undefined;
  picked: boolean;
  flashed: boolean;
  onPick: () => void;
}) {
  const item = useRef<HTMLLIElement>(null);
  const [flash, setFlash] = useState(false);
  const { workspace } = row;

  // Shown from a link or just started: in view, flashed.
  useLayoutEffect(() => {
    if (!flashed) return;
    item.current?.scrollIntoView({ block: 'center' });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(timer);
  }, [flashed]);

  return (
    <li
      ref={item}
      className={`workspace-row${picked ? ' picked' : ''}${flash ? ' flash' : ''}`}
      data-branch={workspace.branch}
      onClick={onPick}
    >
      <div className="workspace-head">
        <WorkspaceChip row={row} />
        <button
          type="button"
          className="workspace-about"
          title={workspace.brief}
          aria-current={picked ? 'true' : undefined}
          onClick={(event) => {
            event.stopPropagation();
            onPick();
          }}
        >
          <KindTag workspace={workspace} />
          {workspaceName(workspace)}
        </button>
        <time className="commit-date" dateTime={workspace.created}>
          {relativeDate(workspace.created, Date.now())}
        </time>
      </div>
      <div className="workspace-branch">
        <WorkspaceBranch row={row} mark={mark} />
      </div>
      <WorkspaceState row={row} />
    </li>
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
 * messages and CPR's prompt as written.
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
        <p className="hint">CPR keeps an agent's messages from V18c on: Talk shows this one's.</p>
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
            if (item.who === 'cpr') {
              return (
                <li key={key} className="thread-item thread-cpr">
                  <details>
                    <summary>
                      CPR's prompt · <time dateTime={item.at}>{timeOf(item.at)}</time>
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
                  <div className="thread-text thread-markdown">
                    {markdownNodes(lexer(item.text))}
                  </div>
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
 * The picked workspace (V18c): its state and actions, its thread, and one box whose message
 * continues the agent's session. Nothing is sent without Send (decision 82); sending to an agent
 * that works, or waits on a prompt, ends its turn, so that is asked first.
 */
function WorkspacePanel({
  row,
  mark,
  version,
  terminal,
  fillVerdict,
  onNotice,
  onError,
  onBack,
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
  onError: (message: string | null) => void;
  onBack: () => void;
}) {
  const { workspace } = row;
  const { branch, agent } = workspace;
  const [thread, reloadThread] = useThread(branch, version);
  const [briefOpen, setBriefOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState<'send' | 'clean' | null>(null);
  const filled = useRef(false);
  const mode = replyMode(agent);
  const verdict = verdictToSend(thread);
  // V21: the agent's own session in a terminal, where one can run: the panel opens on it, and the
  // thread is its history, read only (one way to answer the agent: the box stops its session).
  // Claude Code's only: Codex's turns in a terminal would not reach its thread (decision 133).
  const terminals =
    terminal?.available === true && agent.id !== undefined && agent.kind === 'claude';
  const talk = talkCommand(agent, workspace.worktree.path);
  const [chosen, setChosen] = useState(viewOfUrl);
  const view = chosen ?? (terminals ? 'terminal' : 'thread');
  const showTerminal = terminals && view === 'terminal';
  const [opened, setOpened] = useState<OpenedTerminal | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Attaching to a stopped session continues it (with no turn): asked when a terminal is to
  // open, not once it is open (a stop from the head leaves its last lines in view).
  const [asking, setAsking] = useState(() => agent.state === 'stopped');
  const show = (next: 'thread' | 'terminal') => {
    setChosen(next);
    setEnded(null);
    setAsking(agent.state === 'stopped');
    const href = workspaceHref(branch);
    window.history.replaceState(null, '', next === 'thread' ? `${href}&thread` : href);
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
    onError(null);
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
          onBack();
          return null;
        },
      ),
    );
  };

  return (
    <section className="workspace-panel" aria-label={`Workspace ${branch}`}>
      <button type="button" className="link workspace-back" onClick={onBack}>
        ← Workspaces
      </button>
      <div className="workspace-head">
        <WorkspaceChip row={row} />
        <WorkspaceBranch row={row} mark={mark} />
        <span className="workspace-about" title={workspace.brief}>
          <KindTag workspace={workspace} />
          {workspaceName(workspace)}
        </span>
      </div>
      <WorkspaceState row={row} />
      <div className="workspace-actions">
        <button type="button" className="link" onClick={() => setBriefOpen((o) => !o)}>
          {briefOpen ? 'Hide the brief' : 'The brief'}
        </button>
        {workspace.ahead > 0 && workspace.tip !== null && (
          <button
            type="button"
            className="link"
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
        {talk && !terminals && (
          <button
            type="button"
            className="link"
            title={`Talk to the agent in a terminal: ${talk}${
              agent.kind === 'codex'
                ? ' (its turns there are not recorded in this thread)'
                : terminal && !terminal.available
                  ? ` (no terminal here: ${terminal.reason})`
                  : ''
            }`}
            onClick={() => act(() => copy(talk, `${talk}: paste it in a terminal`))}
          >
            Talk
          </button>
        )}
        {workspace.worktree.exists && (
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() =>
              act(() =>
                postJson('/api/workspaces/open', { branch }).then(() => 'Opened in VS Code'),
              )
            }
          >
            Open in VS Code
          </button>
        )}
        {live && (
          <button
            type="button"
            className="link"
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
            className="link"
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
        <button
          type="button"
          className="link"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const response = await fetch(
                `/api/workspaces/prompt?branch=${encodeURIComponent(branch)}`,
              );
              if (!response.ok) throw new Error(await response.text());
              const { prompt } = (await response.json()) as { prompt: string };
              return copy(prompt, 'the prompt');
            })
          }
        >
          Copy the prompt
        </button>
        {(workspace.merged || !live) && (
          <button
            type="button"
            className="link"
            disabled={busy}
            title={
              workspace.merged
                ? 'Remove its sessions, its worktree and its merged branch'
                : 'Not merged: remove its worktree, keep the branch'
            }
            onClick={() => (workspace.merged ? clean(false) : setConfirming('clean'))}
          >
            {workspace.merged ? 'Clean up' : 'Clean up…'}
          </button>
        )}
        {said && (
          <span className="workspace-said" role="status">
            {said}
          </span>
        )}
      </div>
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
      {briefOpen && <pre className="workspace-brief">{workspace.brief}</pre>}
      {terminals && (
        <div className="workspace-views" role="tablist" aria-label="Talk to the agent">
          {(['thread', 'terminal'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={view === name}
              className={view === name ? 'selected' : ''}
              onClick={() => show(name)}
            >
              {name === 'thread' ? 'Thread' : 'Terminal'}
            </button>
          ))}
        </div>
      )}
      {showTerminal ? (
        <div className="workspace-terminal">
          {asking ? (
            <p className="workspace-confirm">
              Opening the terminal continues the stopped session.{' '}
              <button type="button" className="button" onClick={() => setAsking(false)}>
                Open the terminal
              </button>
            </p>
          ) : (
            <AgentTerminal key={attempt} branch={branch} onOpened={setOpened} onEnded={setEnded} />
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
                    const now = list?.workspaces.find((f) => f.branch === branch)?.agent.state;
                    setAsking((now ?? agent.state) === 'stopped');
                    setAttempt((n) => n + 1);
                  });
                }}
              >
                Open again
              </button>
            </p>
          )}
          <div className="reply-actions">
            <span className="hint">← in an empty prompt lists all your agents</span>
            {verdict && opened && (
              <button
                type="button"
                className="link"
                title="Types its first line and where the review is; Enter sends it"
                onClick={() => void typeVerdict(opened, verdict.text)}
              >
                Send the verdict
              </button>
            )}
          </div>
        </div>
      ) : (
        <Thread thread={thread} worktree={workspace.worktree.path} />
      )}
      {terminals && !showTerminal && (
        <p className="hint thread-readonly">
          The agent's messages and reports. To answer it,{' '}
          <button type="button" className="link" onClick={() => show('terminal')}>
            open its terminal
          </button>
          .
        </p>
      )}
      <form
        hidden={terminals}
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
              <button type="button" className="button" disabled={busy} onClick={() => send(true)}>
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
    </section>
  );
}
