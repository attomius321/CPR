import { useState, type ReactElement } from 'react';
import type { MergeEntry, MergeList, WorkspaceList } from '@symbiote/core';
import { useShell } from '../shell/shell-context.js';
import { hrefOf } from '../shell/pages.js';
import { postJson } from '../ui/http.js';
import { removeMerge } from './cleanup.js';
import {
  failedCheck,
  mergeButtons,
  mergeLive,
  mergeState,
  mergeTitle,
  resolutionFiles,
  type MergeAction,
} from './merges.js';
import { MergeLog } from './MergeLog.js';
import {
  AgentIcon,
  AlertIcon,
  CheckIcon,
  ChecksIcon,
  CloseIcon,
  CommitIcon,
  FailedIcon,
  FileIcon,
  MergeIcon,
  MergingIcon,
  PushIcon,
  ReviewIcon,
  ShieldIcon,
  SpinIcon,
  TerminalIcon,
} from '../ui/icons.js';
import { Pipeline } from '../ui/Pipeline.js';
import { StatusLabel } from '../ui/StatusLabel.js';
import { useSecondsWhile } from './clock.js';
import { FileRow, useChanges } from './ChangesPanel.js';
import {
  expectedCheck,
  mergePage,
  type MergeCommand,
  type MergeStep,
  type MergeStepState,
} from './merge-steps.js';
import { ChecksMark, Item, type ItemState } from './RunItem.js';
import { PageHead } from '../ui/PageHead.js';
import { MoreActions, type MenuAction } from '../ui/MoreActions.js';
import { reloadWorkspaces, useWorkspaces } from './useWorkspaces.js';
import { replyMode } from './thread-items.js';
import { tip } from '../ui/tip.js';
import { Loading } from '../ui/Loading.js';
import { MergeFiles } from './MergeFiles.js';

const ACTION_NAMES: Record<MergeAction, string> = {
  land: 'Land',
  approve: 'Approve',
  change: 'Request changes',
  recheck: 'Check again',
  send: 'Send to the agent',
  'merge-commit': 'Merge commit instead',
  retry: 'Retry',
  remove: 'Remove',
};

/** The head's primary buttons; Remove is a button only once its merge landed (V55). */
const PRIMARY: ReadonlySet<MergeAction> = new Set(['approve', 'land', 'merge-commit', 'remove']);

/** The queue's entry for a branch: the one still in progress, else its last. */
export function mergeOf(merges: MergeList | null, branch: string): MergeEntry | undefined {
  const entries = merges?.merges.filter((e) => e.branch === branch) ?? [];
  return entries.find((e) => e.state !== 'landed') ?? entries.at(-1);
}

/**
 * A merge in Symbiote's queue (V26a), in the shell's main area (V29a; a row of the Workspaces
 * page's Merging section before): its branch, target and state, what a failed check ran, and Land,
 * Approve, Request changes or Check again, with Retry and Remove under "⋯"; when the merger agent
 * asked, the box to answer it (fix/merge-viewer-on-conflict). Below, its log (V46a: each step and
 * what it wrote, as it goes) and, when it conflicted, its files (V46c), each with its resolution
 * to review region by region, or the regions the agent asked about.
 */
export function MergeView({ branch }: { branch: string }) {
  const { merges, list } = useWorkspaces();
  if (!merges) return <Loading className="hint main-hint">Reading the merges…</Loading>;
  const entry = mergeOf(merges, branch);
  if (!entry) {
    return (
      <div className="main-empty">
        <p>No merge of {branch} in Symbiote&apos;s queue.</p>
      </div>
    );
  }
  return (
    <div className="merge-view">
      {merges.elsewhere && (
        <p className="hint">
          Another Symbiote in this repository merges these: it shows them as it goes.
        </p>
      )}
      <MergeEntryView
        key={entry.id}
        entry={entry}
        send={entry.by !== 'hive' && sendable(list, entry.branch)}
      />
    </div>
  );
}

/**
 * Whether a failed check can be sent to the branch's agent (AR2): its workspace's agent takes
 * messages (Claude Code or Codex with a session).
 */
function sendable(list: WorkspaceList | null, branch: string): boolean {
  const workspace = list?.workspaces.find((w) => w.branch === branch);
  if (!workspace) return false;
  return replyMode(workspace.agent) !== 'none';
}

function MergeEntryView({ entry, send = false }: { entry: MergeEntry; send?: boolean }) {
  const shell = useShell();
  const { merges, list, reviews } = useWorkspaces();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState(false);
  const [changing, setChanging] = useState(false);
  const [comments, setComments] = useState('');
  // Its log has the check's whole output (V46a): the entry's last lines only without one.
  const [logged, setLogged] = useState(false);
  // Log, Changes or Files (V46c, V93): the person's pick, else Files once a resolution is there.
  const [picked, setPicked] = useState<Tab | null>(null);
  const live = mergeLive([entry]);
  const now = useSecondsWhile(live);
  const workspace = list?.workspaces.find((w) => w.branch === entry.branch);
  const review = reviews?.reviews.find((r) => r.branch === entry.branch);
  const verdict = review?.verdict?.event === 'approve' ? review.verdict : undefined;
  const queue = merges?.merges ?? [entry];
  const page = mergePage(entry, {
    queue,
    verdict,
    title: workspace?.title,
    expected: entry.check ? expectedCheck(queue, entry.check.commands) : undefined,
    push: merges?.push === true,
    now,
  });
  const changes = useChanges(entry.branch, entry.updated, 0, workspace !== undefined);
  const post = (path: string, body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    postJson(path, { id: entry.id, ...body })
      .then(() => {
        setChanging(false);
        setComments('');
        return reloadWorkspaces();
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  /**
   * Removed, the merge's page gives way to the Overview (V91), the status bar saying so;
   * `removeMerge` reads the list again (V57).
   */
  const remove = () => {
    setBusy(true);
    setError(null);
    removeMerge(entry)
      .then((notice) => {
        shell?.notify(notice);
        shell?.navigate({ page: 'overview' });
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  /**
   * The failed check typed into the branch's agent (AR2, decision 742); the bar says so, and its
   * workspace's page opens, where the agent answers (fix/failed-merge-hides-workspace).
   */
  const sendToAgent = () => {
    setBusy(true);
    setError(null);
    postJson('/api/merges/send', { id: entry.id })
      .then(() => {
        shell?.notify({ text: `Sent the failed check to ${entry.branch}'s agent` });
        shell?.navigate({ page: 'workspace', branch: entry.branch });
        return reloadWorkspaces();
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const act = (action: MergeAction) => {
    if (action === 'change') setChanging((open) => !open);
    else if (action === 'remove') remove();
    else if (action === 'send') sendToAgent();
    else post(`/api/merges/${action}`, {});
  };
  // The frequent actions as buttons; Retry and Remove, rarer, in the "⋯" menu; a landed merge's
  // Remove, its last, its primary button (V55). While it waits or runs, Remove is "Take out of the
  // queue", a secondary button (V93, proof 05).
  const { buttons, more: rarer } = mergeButtons(entry, { send });
  const takeOut = live && rarer.includes('remove');
  const shownActions = takeOut ? [...buttons, 'remove' as const] : buttons;
  const more: MenuAction[] = rarer
    .filter((a) => !(takeOut && a === 'remove'))
    .map((a) => ({ label: ACTION_NAMES[a], disabled: busy, onSelect: () => act(a) }));
  const files = resolutionFiles(entry);
  // Files first once there is a resolution to read, or a question to answer.
  const resolved = files.some((f) => f.regions.length > 0 || f.asked.length > 0) && !live;
  const asking = entry.state === 'needs-you' && Boolean(entry.resolution?.needsYou);
  const changed = changes !== null && typeof changes !== 'string' ? changes.files : null;
  const tab: Tab =
    picked === 'files' && files.length === 0
      ? 'log'
      : picked === 'changes' && !changed
        ? 'log'
        : (picked ?? (files.length > 0 && resolved ? 'files' : 'log'));
  const shown = !logged && entry.check?.output && entry.check.ok === false;
  const ran = entry.check ? failedCheck(entry.check) : null;
  // Approve lands a resolution whatever its check said: the button says so when it failed.
  const approveTitle =
    entry.check?.ok === false
      ? `Land the merge, though its check failed (${entry.check.failed ?? ''})`
      : undefined;
  const check = entry.check;
  const checkState = (state: MergeStepState): ItemState =>
    state === 'done' ? 'ok' : state === 'now' ? 'run' : state === 'bad' ? 'fail' : 'todo';
  const [, mergeStep, checkStep, land] = page.steps as [MergeStep, MergeStep, MergeStep, MergeStep];
  return (
    <section
      className={`merge-row merge-page merge-tone-${mergeState(entry).tone}`}
      aria-label={`Merge of ${entry.branch}`}
    >
      {/* The page frame's head (V72; V93, proof 05): the title and where it goes, the branch, who
          approved it and where it is in the queue; the state's pill and the actions. */}
      <PageHead
        className="merge-row-head"
        icon={<MergingIcon />}
        title={
          <>
            {page.title} <span className="merge-into">→ {entry.into}</span>
          </>
        }
        line={
          <span {...tip(`${mergeState(entry).text}\n${mergeTitle(entry)}`)}>
            {/* Its state and its merge commit in full, for screen readers; the pill and the steps
                show them. */}
            <span className="merge-said">
              <span className="merge-row-state">{mergeState(entry).text}</span> ·{' '}
              <span className="merge-title">{mergeTitle(entry)}</span>
            </span>
            {/* Its workspace's page, while it has one (fix/failed-merge-hides-workspace). */}
            {workspace ? (
              <a
                className="link merge-branch"
                href={hrefOf({ page: 'workspace', branch: entry.branch })}
                {...tip(`Open its workspace\n${workspace.title}`)}
              >
                {entry.branch}
              </a>
            ) : (
              <code className="merge-branch">{entry.branch}</code>
            )}
            {entry.strategy === 'fast-forward' && (
              <>
                {' · '}
                <span className="merge-how">by fast-forward</span>
              </>
            )}
            {page.line.map((part) => (
              <span key={part}> · {part}</span>
            ))}
          </span>
        }
        actions={
          <>
            <StatusLabel
              tone={page.pill.tone === 'fail' ? 'error' : page.pill.tone}
              {...(page.pill.tone === 'run' ? { icon: <SpinIcon /> } : {})}
              className="merge-label"
            >
              {page.pill.word}
            </StatusLabel>
            {shownActions.map((action) => (
              <button
                key={action}
                type="button"
                className={
                  action === 'remove' && takeOut
                    ? 'button'
                    : PRIMARY.has(action)
                      ? 'button primary'
                      : 'button'
                }
                {...tip(action === 'approve' ? approveTitle : undefined, { tone: 'warn' })}
                disabled={busy}
                onClick={() => act(action)}
              >
                {action === 'remove' && takeOut ? (
                  <>
                    <CloseIcon />
                    Take out of the queue
                  </>
                ) : (
                  ACTION_NAMES[action]
                )}
              </button>
            ))}
            {more.length > 0 && <MoreActions actions={more} />}
          </>
        }
      />
      {changing && (
        <form
          className="merge-change"
          onSubmit={(event) => {
            event.preventDefault();
            post('/api/merges/request-changes', { comments });
          }}
        >
          <textarea
            aria-label="What to change in the resolution"
            placeholder="What to change: the merger agent answers again with your words"
            rows={2}
            value={comments}
            onChange={(event) => setComments(event.target.value)}
          />
          <button type="submit" className="button" disabled={busy || comments.trim() === ''}>
            Ask again
          </button>
        </form>
      )}
      {asking && (
        <form
          className="merge-change"
          onSubmit={(event) => {
            event.preventDefault();
            post('/api/merges/request-changes', { comments });
          }}
        >
          <textarea
            aria-label="Your answer to the merger agent"
            placeholder="Your answer: the merger agent resolves the conflict again with it"
            rows={2}
            value={comments}
            onChange={(event) => setComments(event.target.value)}
          />
          <button
            type="submit"
            className="button primary"
            disabled={busy || comments.trim() === ''}
          >
            Answer
          </button>
        </form>
      )}
      {/* A fast-forward that cannot land says why in its state line (V67). */}
      {entry.state === 'needs-you' &&
        entry.message &&
        !entry.resolution?.needsYou &&
        !entry.behind && <p className="hint small">{entry.message}</p>}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <Pipeline
        label="Its steps"
        steps={page.steps.map((step) => ({
          name: step.name,
          state: step.state,
          detail: step.detail,
          icon: STEP_ICONS[step.name](step.state),
          progress: step.progress,
        }))}
        cells={[
          {
            label: 'Queue',
            value: (
              <>
                {page.queue.value} {page.queue.of && <small>{page.queue.of}</small>}
              </>
            ),
            words: page.queue.words,
          },
          { label: 'Time', value: page.time.value, words: page.time.words },
        ]}
      />
      <div className="merge-body">
        <section className="card merge-steps-card" aria-label="Steps">
          <div className="card-head merge-steps-card-head">
            <h2>Steps</h2>
            <span className="merge-rules-file">
              <FileIcon />
              symbiote/merge.md
            </span>
          </div>
          <ol className="run-items merge-items">
            <Item
              name="Approved"
              state="ok"
              icon={<ReviewIcon />}
              words={page.approval.words}
              end={<span>{page.approval.at}</span>}
            >
              {page.approval.quote && <p className="run-quote">“{page.approval.quote}”</p>}
            </Item>
            <Item
              name="Merge"
              state={checkState(mergeStep.state)}
              icon={<MergeIcon />}
              words={mergeStep.state === 'bad' ? mergeStep.detail : "in Symbiote's merge worktree"}
              end={
                entry.mergeMs !== undefined ? <span>{mergeTook(entry.mergeMs)}</span> : undefined
              }
            >
              {entry.merge && (
                <p className="merge-commit-line">
                  <CommitIcon />
                  <code>{entry.head.slice(0, 7)}</code>
                  <span>into</span>
                  <code>{entry.into}</code>
                  {entry.base && (
                    <>
                      <span>at</span>
                      <code>{entry.base.slice(0, 7)}</code>
                    </>
                  )}
                  <span className="merge-arrow">→</span>
                  <code>{entry.merge.slice(0, 7)}</code>
                </p>
              )}
            </Item>
            {(entry.state === 'resolving' || entry.resolution) && (
              <Item
                name="Merger agent"
                state={
                  entry.state === 'resolving'
                    ? 'run'
                    : entry.resolution?.needsYou
                      ? 'warning'
                      : 'ok'
                }
                icon={entry.state === 'resolving' ? <SpinIcon /> : <AgentIcon />}
                words={
                  entry.state === 'resolving'
                    ? `answers ${entry.conflicts?.length ?? 0} conflicting file${entry.conflicts?.length === 1 ? '' : 's'}`
                    : entry.resolution?.needsYou
                      ? 'asks you'
                      : `wrote ${entry.resolution?.regions.length ?? 0} region${entry.resolution?.regions.length === 1 ? '' : 's'}`
                }
                end={entry.resolution ? <span>{mergeTook(entry.resolution.ms)}</span> : undefined}
              />
            )}
            <Item
              name="Check"
              state={checkState(checkStep.state)}
              icon={checkStep.state === 'now' ? <SpinIcon /> : <ChecksIcon />}
              words={
                check
                  ? check.source.replace(/^symbiote\/config\.json \((.+)\)$/, '$1')
                  : checkStep.detail
              }
              end={page.checkTime ? <span>{page.checkTime}</span> : undefined}
            >
              {page.commands.length > 0 && <MergeCommands commands={page.commands} />}
              {(ran || shown) && (
                <p className="merge-run small">
                  {ran}
                  {shown && (
                    <button
                      type="button"
                      className="link small"
                      onClick={() => setOutput((o) => !o)}
                    >
                      {output ? 'Hide its output' : 'Its output'}
                    </button>
                  )}
                </p>
              )}
              {shown && output && <pre className="merge-output">{entry.check?.output}</pre>}
            </Item>
            <Item
              name="Land"
              state={checkState(land.state)}
              icon={<PushIcon />}
              words={page.landWords}
              end={entry.landed ? <span>{approvedAt(entry.landed)}</span> : undefined}
              last
            />
          </ol>
          <p className="merge-note">
            <ShieldIcon />
            {entry.by === 'hive'
              ? "A failed check goes back to Hive's writer, with its output."
              : send
                ? "A failed check goes back to the workspace's agent, with its output."
                : 'A failed check waits here for you, with its output.'}
          </p>
        </section>
        <section className="card merge-output-card" aria-label="Its output">
          <div className="merge-tabs" role="tablist" aria-label="The merge">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'log'}
              onClick={() => setPicked('log')}
            >
              <TerminalIcon />
              Log
            </button>
            {changed && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'changes'}
                onClick={() => setPicked('changes')}
              >
                <FileIcon />
                Changes <span className="count">{changed.count}</span>
              </button>
            )}
            {files.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'files'}
                onClick={() => setPicked('files')}
              >
                <AlertIcon />
                Conflicts <span className="count">{files.length}</span>
              </button>
            )}
            {live && (
              <span className="merge-live">
                <SpinIcon />
                live
              </span>
            )}
          </div>
          {files.length > 0 && <MergeFiles entry={entry} files={files} hidden={tab !== 'files'} />}
          {changed && (
            <ul
              className="merge-changes changes-files"
              hidden={tab !== 'changes'}
              aria-label="Its changes"
            >
              {changed.listed.map((file) => (
                <li key={file.path}>
                  <FileRow
                    file={file}
                    label={file.path}
                    hover={`${file.path}\nOpen its changes in VS Code`}
                    onOpen={(f) =>
                      void postJson('/api/workspaces/diff', {
                        branch: entry.branch,
                        file: f.path,
                        ...(f.previousPath ? { previousPath: f.previousPath } : {}),
                      }).then(
                        () => shell?.notify({ text: `Opened the changes to ${f.path} in VS Code` }),
                        (e: unknown) => shell?.notify({ text: (e as Error).message, error: true }),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          <MergeLog entry={entry} hidden={tab !== 'log'} onLogged={() => setLogged(true)} />
        </section>
      </div>
    </section>
  );
}

/** "12:51". */
const approvedAt = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** The merge step's time: "0.4 s". */
const mergeTook = (ms: number) =>
  ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;

/** Each step's mark in its hexagon (the proof's: a check once done, a spinner while it runs). */
const STEP_ICONS: Record<MergeStep['name'], (state: MergeStepState) => ReactElement> = {
  Approved: () => <CheckIcon />,
  Merge: (state) =>
    state === 'done' ? <CheckIcon /> : state === 'now' ? <SpinIcon /> : <MergeIcon />,
  Check: (state) =>
    state === 'done' ? (
      <CheckIcon />
    ) : state === 'now' ? (
      <SpinIcon />
    ) : state === 'bad' ? (
      <CloseIcon />
    ) : (
      <ChecksIcon />
    ),
  Land: (state) => (state === 'done' ? <CheckIcon /> : <PushIcon />),
};

/** The check's commands, each with its time; the running one with its bar (decision 881). */
function MergeCommands({ commands }: { commands: readonly MergeCommand[] }) {
  return (
    <ul className="run-commands" aria-label="Its commands">
      {commands.map((row, i) => (
        <li key={i} className={`run-command is-${row.mark}`}>
          <span className="run-mark" aria-label={row.mark === 'skipped' ? 'not run' : row.mark}>
            {row.mark === 'passed' ? (
              <ChecksMark />
            ) : row.mark === 'failed' ? (
              <FailedIcon />
            ) : row.mark === 'running' ? (
              <span className="run-spinner" />
            ) : null}
          </span>
          <code>{row.command}</code>
          <span className="run-command-note">
            {row.mark === 'failed' ? (
              'failed'
            ) : row.mark === 'skipped' ? (
              'not run'
            ) : row.share !== undefined ? (
              <span
                className="run-bar"
                role="progressbar"
                aria-label={`${row.command}, against its last passing run`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(row.share * 100)}
              >
                <i style={{ width: `${row.share * 100}%` }} />
              </span>
            ) : (
              ''
            )}
          </span>
          <span className="run-time">{row.time ?? ''}</span>
        </li>
      ))}
    </ul>
  );
}

/** A merge's two views, when it had conflicts (V46c). */
type Tab = 'files' | 'log' | 'changes';
