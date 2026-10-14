import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BranchMerge, FeatureStart, FeatureSummary } from '@cpr/core';
import { reviewMarks, type ReviewMark } from './branchReviews.js';
import { relativeDate } from './commits.js';
import { postJson, useFeatureStarter } from './FeatureStarter.js';
import { featureGroups, startedNotice, type FeatureRow } from './features.js';
import { reloadFeatures, useFeatures } from './useFeatures.js';

/** `?branch=<name>`: the feature to show, flashed (from a branch's mark, V18b). */
const branchOfUrl = (): string | null => new URLSearchParams(window.location.search).get('branch');

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

/**
 * The features view (V18b): the features started from CPR, grouped by what each needs from the
 * person — needs you, working, done — each with its agent's state, its commits, what is not
 * committed yet, its review and whether it merges, and what can be done about it. Each feature's
 * branch leads to its commits; `?branch=` shows one feature.
 */
export function FeaturesPage() {
  const { list, reviews } = useFeatures();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(branchOfUrl);
  const started = useCallback((start: FeatureStart) => {
    setNotice(startedNotice(start));
    setFocus(start.feature.branch);
  }, []);
  const starter = useFeatureStarter(started, setError);
  const groups = useMemo(() => featureGroups(list?.features ?? [], reviews), [list, reviews]);
  const marks = useMemo(() => reviewMarks(reviews).marks, [reviews]);

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
        Features
        <span className="commits-help">
          What each feature's agent needs from you · a branch name goes to its commits · n starts
          one
        </span>
        <span className="commits-actions">
          <button
            type="button"
            className="start-feature"
            title="Start a feature: a branch, its worktree and an agent (n)"
            onClick={() => starter.open()}
          >
            Start a feature
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
        <p className="hint">Listing features…</p>
      ) : list.features.length === 0 ? (
        <p className="hint">
          No features yet. Start one: describe it, and CPR makes its branch and worktree and starts
          an agent there.
        </p>
      ) : (
        GROUPS.map(([key, title]) =>
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
                    focused={row.feature.branch === focus}
                    onError={setError}
                    onNotice={setNotice}
                  />
                ))}
              </ul>
            </section>
          ),
        )
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

function FeatureItem({
  row: { feature, next },
  mark,
  focused,
  onError,
  onNotice,
}: {
  row: FeatureRow;
  mark: ReviewMark | undefined;
  focused: boolean;
  onError: (message: string | null) => void;
  onNotice: (notice: Notice | null) => void;
}) {
  const [briefOpen, setBriefOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const item = useRef<HTMLLIElement>(null);
  const [flash, setFlash] = useState(false);
  const merge = useMergeCheck(feature);

  // Shown from a link: in view, flashed.
  useLayoutEffect(() => {
    if (!focused) return;
    item.current?.scrollIntoView({ block: 'center' });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(timer);
  }, [focused]);

  const { branch, agent } = feature;
  const about = feature.brief.trim().split('\n')[0] ?? branch;
  const live = agent.state === 'working' || agent.state === 'needs-you';
  const restartable =
    agent.kind !== undefined &&
    ['not-started', 'failed', 'stopped', 'not-running'].includes(agent.state);

  /** Runs an action, says how it went on the row; the list is read again. */
  const act = (task: () => Promise<string | null>) => {
    setBusy(true);
    onError(null);
    task()
      .then((text) => setSaid(text))
      .catch((e: unknown) => setSaid(`${(e as Error).message}`))
      .finally(() => {
        setBusy(false);
        void reloadFeatures();
      });
  };
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => `Copied ${what}`,
      () => `Could not copy ${what}`,
    );

  const facts = [
    feature.ahead > 0 ? plural(feature.ahead, 'commit') : 'no commits yet',
    feature.worktree.changed
      ? `${plural(feature.worktree.changed, 'file')} not committed yet`
      : null,
    feature.worktree.exists ? null : 'its worktree is gone',
    mergeText(merge),
  ].filter((fact): fact is string => fact !== null);

  return (
    <li ref={item} className={`feature-row${flash ? ' flash' : ''}`} data-branch={branch}>
      <div className="feature-head">
        <span className={`feature-mark feature-mark-${next.chip.tone}`} aria-hidden="true">
          {next.chip.mark}
        </span>
        {feature.tip === null ? (
          <span className="ref ref-branch">{branch}</span>
        ) : (
          <a
            className="ref ref-branch"
            href={`/?branch=${encodeURIComponent(branch)}`}
            title={`${branch}: its commits`}
          >
            {branch}
          </a>
        )}
        {mark && (
          <span className={`ref-review ref-review-${mark.tone}`} title={mark.title}>
            {mark.mark}
          </span>
        )}
        <span className="feature-about" title={feature.brief}>
          {about}
        </span>
        <time className="commit-date" dateTime={feature.created}>
          {relativeDate(feature.created, Date.now())}
        </time>
      </div>
      <p className="feature-state">
        <strong>{next.text}</strong>
        {facts.map((fact) => (
          <span key={fact}> · {fact}</span>
        ))}
      </p>
      {briefOpen && <pre className="feature-brief">{feature.brief}</pre>}
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
        {agent.id && (
          <button
            type="button"
            className="link"
            title="Talk to the agent in a terminal: claude attach"
            onClick={() =>
              act(() =>
                copy(
                  `claude attach ${agent.id ?? ''}`,
                  `claude attach ${agent.id ?? ''}: paste it in a terminal`,
                ),
              )
            }
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
        {said && (
          <span className="feature-said" role="status">
            {said}
          </span>
        )}
      </div>
    </li>
  );
}
