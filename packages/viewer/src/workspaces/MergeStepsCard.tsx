// A merge's steps card (V93, proof 05): each step with its state, time and words, the check's
// commands, and where a failed check goes.
import { useState } from 'react';
import type { MergeEntry } from '@symbiote/core';
import { failedCheck } from './merges.js';
import {
  AgentIcon,
  ChecksIcon,
  CommitIcon,
  FailedIcon,
  FileIcon,
  MergeIcon,
  PushIcon,
  ReviewIcon,
  ShieldIcon,
  SpinIcon,
} from '../ui/icons.js';
import type { MergeCommand, MergePageWords, MergeStep, MergeStepState } from './merge-steps.js';
import { ChecksMark, Item, type ItemState } from './RunItem.js';

/** "12:51". */
const approvedAt = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** The merge step's time: "0.4 s". */
const mergeTook = (ms: number) =>
  ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;

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

/**
 * A merge's steps as a card (V93, proof 05): approved, merged, the merger agent's answer, the check
 * with its commands and its output, landed; then where a failed check goes.
 */
export function MergeStepsCard({
  entry,
  page,
  send,
  logged,
}: {
  entry: MergeEntry;
  page: MergePageWords;
  /** A failed check goes back to the workspace's agent. */
  send: boolean;
  /** Its log has the check's whole output (V46a): the entry's last lines only without one. */
  logged: boolean;
}) {
  const [output, setOutput] = useState(false);
  const shown = !logged && entry.check?.output && entry.check.ok === false;
  const ran = entry.check ? failedCheck(entry.check) : null;
  const check = entry.check;
  const checkState = (state: MergeStepState): ItemState =>
    state === 'done' ? 'ok' : state === 'now' ? 'run' : state === 'bad' ? 'fail' : 'todo';
  const [, mergeStep, checkStep, land] = page.steps as [MergeStep, MergeStep, MergeStep, MergeStep];
  return (
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
          end={entry.mergeMs !== undefined ? <span>{mergeTook(entry.mergeMs)}</span> : undefined}
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
              entry.state === 'resolving' ? 'run' : entry.resolution?.needsYou ? 'warning' : 'ok'
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
                <button type="button" className="link small" onClick={() => setOutput((o) => !o)}>
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
  );
}
