// A workspace's head (V72, decision 511; V89, decision 823; V93): its kind's icon, its name, its
// branch and where it started, then what it says, its steps or its state's pill, and its actions.
import type { StepsModel } from './workspace-steps.js';
import type { WorkspaceStart, TerminalAvailability, WorkspaceHiveDetail } from '@symbiote/core';
import type { ReviewMark } from '../history/branchReviews.js';
import { changedFiles, useChanges } from './ChangesPanel.js';
import { HeadSteps } from './HeadSteps.js';
import { BranchIcon, ChangesIcon, EditorIcon } from '../ui/icons.js';
import { hivePipeline } from './hive-pipeline.js';
import { StatusLabel } from '../ui/StatusLabel.js';
import { PageHead } from '../ui/PageHead.js';
import { KIND_ICONS } from './StartKinds.js';
import { MoreActions, type MenuAction } from '../ui/MoreActions.js';
import { MergeControl } from './MergeControl.js';
import { openReview } from './review-open.js';
import { RunsOn, WorkspaceBranch } from './WorkspaceFacts.js';
import { rowWords } from './row-words.js';
import { postJson } from '../ui/http.js';
import { workspaceName, briefTip } from './workspaces.js';
import type { WorkspaceRow } from './workspace-groups.js';
import { mergedForCard } from './workspace-next.js';
import { startedNotice } from './start-branch.js';
import type { Notice } from '../shell/shell-context.js';
import { useWorkspaces } from './useWorkspaces.js';
import { tip } from '../ui/tip.js';
import { Loading } from '../ui/Loading.js';
import { startedAt } from './workspace-words.js';
import { useShell } from '../shell/shell-context.js';

/** A workspace's issue (HV10b): `#n`, opening it on the Issues page. */
function IssueLink({ number }: { number: number }) {
  const shell = useShell();
  return (
    <a
      className="workspace-issue"
      href={`/issues?number=${number}`}
      {...tip('Its issue, on the Issues page')}
      onClick={(event) => {
        if (!shell) return;
        event.preventDefault();
        shell.navigate({ page: 'issues', number });
      }}
    >
      #{number}
    </a>
  );
}

import type { Dispatch, SetStateAction } from 'react';

/** The page frame's head of a workspace, its ⋯ menu with it. */
export function WorkspaceHead({
  row,
  mark,
  nucleusName,
  stopping,
  setStopping,
  said,
  setSaid,
  showPipeline,
  steps,
  hiveDrives,
  landed,
  hive,
  read,
  merges,
  restartable,
  busy,
  act,
  copy,
  onNotice,
  hiveLands,
  focus,
  changesShown,
  toggleChanges,
  clean,
  cleaning,
  openInCode,
  live,
  talk,
  terminals,
  terminal,
  setConfirming,
}: {
  row: WorkspaceRow;
  mark: ReviewMark | undefined;
  nucleusName: string;
  /** Its stop asked, until the server answers (V48). */
  stopping: boolean;
  setStopping: Dispatch<SetStateAction<boolean>>;
  said: string | null;
  setSaid: Dispatch<SetStateAction<string | null>>;
  showPipeline: boolean;
  steps: StepsModel;
  hiveDrives: boolean;
  landed: string | undefined;
  hive: { detail: WorkspaceHiveDetail | null };
  read: Exclude<ReturnType<typeof useChanges>, string | null> | null;
  merges: ReturnType<typeof useWorkspaces>['merges'];
  restartable: boolean;
  busy: boolean;
  act: (task: () => Promise<string | null>) => void;
  copy: (words: string, what: string) => Promise<string>;
  onNotice: (notice: Notice | null) => void;
  /** Hive lands it (HV4, decision 774): no Merge into, no Review. */
  hiveLands: boolean;
  focus: boolean;
  changesShown: boolean;
  toggleChanges: () => void;
  clean: (unmerged: boolean) => void;
  cleaning: boolean;
  openInCode: () => void;
  live: boolean;
  /** The command that continues its session in a terminal, if any. */
  talk: string | null;
  terminals: boolean;
  terminal: TerminalAvailability | undefined;
  setConfirming: Dispatch<SetStateAction<'send' | 'clean' | null>>;
}) {
  const { workspace } = row;
  const { branch, agent } = workspace;
  const more: MenuAction[] = [
    // Stop is the menu's, as proofs 02 and 08 draw the head (V93): it says it stops meanwhile.
    ...(live
      ? [
          {
            label: 'Stop the agent',
            disabled: busy,
            onSelect: () => {
              // The head says it stops meanwhile, its arc turning.
              setStopping(true);
              setSaid(null);
              act(() =>
                postJson('/api/workspaces/stop', { branch })
                  .then(() => null)
                  .finally(() => setStopping(false)),
              );
            },
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
    // Merged, Clean up is the head's own button (V55).
    ...(!mergedForCard(workspace) && !live
      ? [
          {
            label: 'Clean up…',
            disabled: busy,
            title: 'Not merged: remove its worktree, keep the branch',
            onSelect: () => setConfirming('clean'),
          },
        ]
      : []),
  ];

  return (
    <>
      {/* The page frame's head (V72, decision 511): the kind's icon, the name and its kind, then
      the branch, where it started and what runs it; its steps and actions at the right
      (V89, decision 823). */}
      <PageHead
        className={`workspace-top tone-${row.next.chip.tone}`}
        icon={(workspace.kind && KIND_ICONS[workspace.kind]) ?? <BranchIcon />}
        title={
          <>
            {/* HV10b: the issue it was started from, on the Issues page. */}
            {workspace.issue && <IssueLink number={workspace.issue.number} />}
            <span {...tip(briefTip(workspace.brief))}>{workspaceName(workspace)}</span>
          </>
        }
        line={
          <span className="workspace-state-line">
            <span className="workspace-ref">
              <WorkspaceBranch row={row} mark={mark} />
            </span>
            {workspace.from && (
              <span className="workspace-from">
                from <span className="mono">{workspace.from}</span>
              </span>
            )}
            <span className="workspace-since">
              started {startedAt(workspace.created)}
              {workspace.via ? ` by ${workspace.via === 'nucleus' ? nucleusName : 'an agent'}` : ''}
            </span>
            <RunsOn agent={workspace.agent} />
          </span>
        }
        actions={
          <>
            {stopping ? (
              <span className="workspace-said" role="status">
                <Loading inline>Stopping the agent…</Loading>
              </span>
            ) : (
              said && (
                <span className="workspace-said" role="status">
                  {said}
                </span>
              )
            )}
            {/* The pipeline card holds the steps outside the terminal view (V93, decision 884):
            the head its state's pill. In the terminal view they stay in the head (V89). */}
            {!showPipeline && (
              <HeadSteps
                model={steps}
                {...(hiveDrives
                  ? {
                      hive: {
                        started: workspace.created,
                        ...(landed ? { ended: landed } : {}),
                        ...(hive.detail?.spend ? { spend: hive.detail.spend } : {}),
                      },
                    }
                  : {
                      normal: {
                        commits: workspace.ahead,
                        files: read ? changedFiles(read) : null,
                      },
                    })}
              />
            )}
            {showPipeline && (
              <StatusLabel tone={steps.tone} className="workspace-pill">
                {hiveDrives && workspace.hive && hive.detail
                  ? hivePipeline(steps, hive.detail, {
                      into: workspace.from ?? 'its branch',
                      commits: workspace.ahead,
                      push: merges?.push === true,
                      now: Date.now(),
                    }).pill
                  : steps.tone === 'you'
                    ? `${rowWords(row, Date.now()).word} · your turn`
                    : steps.tone === 'run'
                      ? 'Working'
                      : steps.word}
              </StatusLabel>
            )}
            {restartable && workspace.worktree.exists && (
              <button
                type="button"
                className="button secondary"
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
            {/* Hive lands its own (HV4, decision 774): no Merge into while Hive drives it. */}
            {workspace.ahead > 0 && !mergedForCard(workspace) && !hiveLands && (
              <MergeControl branch={branch} />
            )}
            {/* Open in VS Code, the proofs' ‹› beside the side card's toggle (V93). */}
            {workspace.worktree.exists && (
              <button
                type="button"
                className="icon-button head-open"
                aria-label="Open in VS Code"
                disabled={busy}
                {...tip('Open its worktree in VS Code')}
                onClick={openInCode}
              >
                <EditorIcon />
              </button>
            )}
            {!focus && (
              <button
                type="button"
                className="icon-button changes-toggle"
                aria-label="Changes"
                aria-pressed={changesShown}
                {...tip(`${changesShown ? 'Hide' : 'Show'} the side card`, { keys: ']' })}
                onClick={toggleChanges}
              >
                <ChangesIcon />
              </button>
            )}
            <MoreActions actions={more} />
            {!hiveLands && workspace.ahead > 0 && workspace.tip !== null && (
              <button
                type="button"
                className={mergedForCard(workspace) ? 'button secondary' : 'button primary'}
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await openReview(branch);
                    return null;
                  })
                }
              >
                Review
              </button>
            )}
            {mergedForCard(workspace) && (
              <button
                type="button"
                className="button danger"
                disabled={busy}
                {...tip('Remove its sessions, its worktree and its merged branch')}
                onClick={() => clean(false)}
              >
                {cleaning ? <Loading inline>Cleaning up…</Loading> : 'Clean up'}
              </button>
            )}
          </>
        }
      />
    </>
  );
}
