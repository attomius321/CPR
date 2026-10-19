import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  BranchMerge,
  FeatureReplied,
  FeatureStart,
  FeatureSummary,
  FeatureThread,
  TerminalAvailability,
} from '@cpr/core';
import { AgentTerminal, toTerminal, type OpenedTerminal } from './AgentTerminal.js';
import { reviewMarks, type ReviewMark } from './branchReviews.js';
import { relativeDate } from './commits.js';
import { markdownNodes, useMarkdown } from './markdown.js';
import { useFeatureStarter } from './FeatureStarter.js';
import { postJson } from './http.js';
import {
  featureGroups,
  featureHref,
  featureName,
  replyMode,
  startedNotice,
  talkCommand,
  threadItems,
  verdictToSend,
  type FeatureRow,
} from './features.js';
import { verdictLine } from './terminal.js';
import { readFeaturesAgain, reloadFeatures, useFeatures } from './useFeatures.js';

/** `?branch=<name>`: the feature picked (V18b's address, V18c's selection). */
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
 * The features view (V18b, V18c): the features started from CPR, grouped by what each needs from
 * the person — needs you, working, done —, and beside them the picked feature: its state and
 * actions, what its agent reported and was told, and a box to answer it. `?branch=` picks one;
 * on a wide window the first feature is picked when none is.
 */
export function FeaturesPage() {
  const { list, reviews } = useFeatures();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState(branchOfUrl);
  const [flashed, setFlashed] = useState(branchOfUrl);
  const [send] = useState(sendOfUrl);
  const wide = useWide();
  /** Picks a feature (or none), the address following without a new history entry. */
  const pick = useCallback((branch: string | null) => {
    setPicked(branch);
    window.history.replaceState(null, '', branch ? featureHref(branch) : '/workspaces');
  }, []);
  const started = useCallback(
    (start: FeatureStart) => {
      setNotice(startedNotice(start));
      pick(start.feature.branch);
      setFlashed(start.feature.branch);
    },
    [pick],
  );
  const starter = useFeatureStarter(started, setError);
  const groups = useMemo(() => featureGroups(list?.features ?? [], reviews), [list, reviews]);
  const marks = useMemo(() => reviewMarks(reviews).marks, [reviews]);
  const rows = [...groups.needsYou, ...groups.working, ...groups.done];
  const current =
    rows.find((r) => r.feature.branch === picked) ?? (wide && !picked ? rows[0] : undefined);

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
    <div className="features">
      <h1 className="commits-title">
        Workspaces
        <span className="commits-help">
          What each workspace's agent needs from you · pick one to answer it · a branch name goes to
          its commits · n starts one
        </span>
        <span className="commits-actions">
          <button
            type="button"
            className="start-feature"
            title="Start a workspace: a branch, its worktree and an agent (n)"
            onClick={() => starter.open()}
          >
            Start a workspace
            <kbd aria-hidden="true">n</kbd>
          </button>
        </span>
      </h1>
      {notice && <NoticeLine notice={notice} />}
      {error && (
        <p className="commits-error error" role="alert">
          {error}
        </p>
      )}
      {!list ? (
        <p className="hint">Listing workspaces…</p>
      ) : list.features.length === 0 ? (
        <p className="hint">
          No workspaces yet. Start one: describe the work, and CPR makes its branch and worktree and
          starts an agent there.
        </p>
      ) : (
        <div className={`features-body${current ? ' has-panel' : ''}`}>
          <div className="features-list">
            {GROUPS.map(([key, title]) =>
              groups[key].length === 0 ? null : (
                <section key={key} className="feature-group" aria-label={title}>
                  <h2>
                    {title} <span className="branches-count">{groups[key].length}</span>
                  </h2>
                  <ul className="feature-list">
                    {groups[key].map((row) => (
                      <FeatureItem
                        key={row.feature.branch}
                        row={row}
                        mark={marks.get(row.feature.branch)}
                        picked={row === current}
                        flashed={row.feature.branch === flashed}
                        onPick={() => pick(row.feature.branch)}
                      />
                    ))}
                  </ul>
                </section>
              ),
            )}
          </div>
          {current && (
            <FeaturePanel
              key={current.feature.branch}
              row={current}
              mark={marks.get(current.feature.branch)}
              version={list}
              terminal={list.terminal}
              fillVerdict={send === 'verdict' && current.feature.branch === branchOfUrl()}
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

/** Whether a feature with commits merges into the default branch (V17's check), read once. */
function useMergeCheck(feature: FeatureSummary): BranchMerge | null {
  const [merge, setMerge] = useState<BranchMerge | null>(null);
  const wanted = feature.ahead > 0 && !feature.merged && feature.tip !== null;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    fetch(`/api/features/merge?branch=${encodeURIComponent(feature.branch)}`)
      .then((response) => (response.ok ? (response.json() as Promise<BranchMerge>) : null))
      .then((check) => live && setMerge(check))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [wanted, feature.branch, feature.tip]);
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

/** What is next for a feature, then its facts: commits, files not committed, the merge check. */
function FeatureState({ row: { feature, next } }: { row: FeatureRow }) {
  const merge = useMergeCheck(feature);
  const facts = [
    feature.ahead > 0 ? plural(feature.ahead, 'commit') : 'no commits yet',
    feature.worktree.changed
      ? `${plural(feature.worktree.changed, 'file')} not committed yet`
      : null,
    feature.worktree.exists ? null : 'its worktree is gone',
    mergeText(merge),
  ].filter((fact): fact is string => fact !== null);
  return (
    <p className="feature-state">
      <strong>{next.text}</strong>
      {facts.map((fact) => (
        <span key={fact}> · {fact}</span>
      ))}
    </p>
  );
}

/** A workspace's kind before its name (V24c): none for a Feature, the common case. */
function KindTag({ feature }: { feature: FeatureSummary }) {
  if (!feature.kind || feature.kind === 'feature') return null;
  return <span className="kind-tag">{feature.kind}</span>;
}

/** A feature's mark: what it needs, as its branch's badges show it. */
function FeatureChip({ row: { next } }: { row: FeatureRow }) {
  return (
    <span className={`feature-mark feature-mark-${next.chip.tone}`} aria-hidden="true">
      {next.chip.mark}
    </span>
  );
}

/** A feature's branch (a link to its commits) and its review's mark. */
function FeatureBranch({ row: { feature }, mark }: { row: FeatureRow; mark?: ReviewMark }) {
  const { branch } = feature;
  return (
    <>
      {feature.tip === null ? (
        <span className="ref ref-branch">{branch}</span>
      ) : (
        <a
          className="ref ref-branch"
          href={`/?branch=${encodeURIComponent(branch)}`}
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

/** A feature in the list: what it is and what it needs; a click picks it. */
function FeatureItem({
  row,
  mark,
  picked,
  flashed,
  onPick,
}: {
  row: FeatureRow;
  mark: ReviewMark | undefined;
  picked: boolean;
  flashed: boolean;
  onPick: () => void;
}) {
  const item = useRef<HTMLLIElement>(null);
  const [flash, setFlash] = useState(false);
  const { feature } = row;

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
      className={`feature-row${picked ? ' picked' : ''}${flash ? ' flash' : ''}`}
      data-branch={feature.branch}
      onClick={onPick}
    >
      <div className="feature-head">
        <FeatureChip row={row} />
        <button
          type="button"
          className="feature-about"
          title={feature.brief}
          aria-current={picked ? 'true' : undefined}
          onClick={(event) => {
            event.stopPropagation();
            onPick();
          }}
        >
          <KindTag feature={feature} />
          {featureName(feature)}
        </button>
        <time className="commit-date" dateTime={feature.created}>
          {relativeDate(feature.created, Date.now())}
        </time>
      </div>
      <div className="feature-branch">
        <FeatureBranch row={row} mark={mark} />
      </div>
      <FeatureState row={row} />
    </li>
  );
}

/**
 * A feature's thread (V18c), read when it is picked and with every read of the list (on focus,
 * every 5 s while an agent works or waits).
 */
function useThread(branch: string, version: unknown): [FeatureThread | null, () => void] {
  const [thread, setThread] = useState<FeatureThread | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(`/api/features/thread?branch=${encodeURIComponent(branch)}`)
      .then((response) => (response.ok ? (response.json() as Promise<FeatureThread>) : null))
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
function Thread({ thread, worktree }: { thread: FeatureThread | null; worktree: string }) {
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
 * The picked feature (V18c): its state and actions, its thread, and one box whose message
 * continues the agent's session. Nothing is sent without Send (decision 82); sending to an agent
 * that works, or waits on a prompt, ends its turn, so that is asked first.
 */
function FeaturePanel({
  row,
  mark,
  version,
  terminal,
  fillVerdict,
  onNotice,
  onError,
  onBack,
}: {
  row: FeatureRow;
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
  const { feature } = row;
  const { branch, agent } = feature;
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
  const talk = talkCommand(agent, feature.worktree.path);
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
    const href = featureHref(branch);
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
        void reloadFeatures();
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
      postJson<FeatureReplied>('/api/features/reply', {
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
      postJson('/api/features/clean', { branch, ...(unmerged ? { unmerged: true } : {}) }).then(
        () => {
          onNotice({ text: `Cleaned up ${branch}: its worktree is removed.` });
          onBack();
          return null;
        },
      ),
    );
  };

  return (
    <section className="feature-panel" aria-label={`Workspace ${branch}`}>
      <button type="button" className="link feature-back" onClick={onBack}>
        ← Workspaces
      </button>
      <div className="feature-head">
        <FeatureChip row={row} />
        <FeatureBranch row={row} mark={mark} />
        <span className="feature-about" title={feature.brief}>
          <KindTag feature={feature} />
          {featureName(feature)}
        </span>
      </div>
      <FeatureState row={row} />
      <div className="feature-actions">
        <button type="button" className="link" onClick={() => setBriefOpen((o) => !o)}>
          {briefOpen ? 'Hide the brief' : 'The brief'}
        </button>
        {feature.ahead > 0 && feature.tip !== null && (
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
        {feature.worktree.exists && (
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() =>
              act(() => postJson('/api/features/open', { branch }).then(() => 'Opened in VS Code'))
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
              act(() => postJson('/api/features/stop', { branch }).then(() => 'Stopped'))
            }
          >
            Stop the agent
          </button>
        )}
        {restartable && feature.worktree.exists && (
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() =>
              act(() =>
                postJson<FeatureStart>('/api/features/start', { branch }).then((start) => {
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
                `/api/features/prompt?branch=${encodeURIComponent(branch)}`,
              );
              if (!response.ok) throw new Error(await response.text());
              const { prompt } = (await response.json()) as { prompt: string };
              return copy(prompt, 'the prompt');
            })
          }
        >
          Copy the prompt
        </button>
        {(feature.merged || !live) && (
          <button
            type="button"
            className="link"
            disabled={busy}
            title={
              feature.merged
                ? 'Remove its sessions, its worktree and its merged branch'
                : 'Not merged: remove its worktree, keep the branch'
            }
            onClick={() => (feature.merged ? clean(false) : setConfirming('clean'))}
          >
            {feature.merged ? 'Clean up' : 'Clean up…'}
          </button>
        )}
        {said && (
          <span className="feature-said" role="status">
            {said}
          </span>
        )}
      </div>
      {confirming === 'clean' && (
        <p className="feature-confirm">
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
      {briefOpen && <pre className="feature-brief">{feature.brief}</pre>}
      {terminals && (
        <div className="feature-views" role="tablist" aria-label="Talk to the agent">
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
        <div className="feature-terminal">
          {asking ? (
            <p className="feature-confirm">
              Opening the terminal continues the stopped session.{' '}
              <button type="button" className="button" onClick={() => setAsking(false)}>
                Open the terminal
              </button>
            </p>
          ) : (
            <AgentTerminal key={attempt} branch={branch} onOpened={setOpened} onEnded={setEnded} />
          )}
          {ended && (
            <p className="feature-confirm">
              The terminal {ended === 'exited' ? 'ended' : 'lost its session'}.{' '}
              <button
                type="button"
                className="button"
                onClick={() => {
                  setEnded(null);
                  // A stop ends the terminal before the list says so: the state is read anew.
                  void readFeaturesAgain().then(({ list }) => {
                    const now = list?.features.find((f) => f.branch === branch)?.agent.state;
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
        <Thread thread={thread} worktree={feature.worktree.path} />
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
            <span className="feature-confirm">
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
