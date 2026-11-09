// A workspace's steps card (V93, decision 884; proofs 02, 03, 07): Hive's pipeline or the normal
// one, its steps' marks and its cells.
import type { ReactNode } from 'react';
import { changedFiles, useChanges } from './ChangesPanel.js';
import { Since } from './HeadSteps.js';
import { pipelineSteps } from './workspace-steps.js';
import { Pipeline } from '../ui/Pipeline.js';
import { HivePipeline } from './HivePipeline.js';
import type { WorkspaceRow } from './workspace-groups.js';
import { useWorkspaces } from './useWorkspaces.js';
import { startedAt } from './workspace-words.js';

import type { WorkspaceHiveDetail } from '@symbiote/core';
import type { StepsModel } from './workspace-steps.js';
import {
  BellIcon,
  CheckIcon,
  ChoreIcon,
  CloseIcon,
  MergeIcon,
  PencilIcon,
  ReviewIcon,
  SpinIcon,
} from '../ui/icons.js';
import type { PipelineState } from '../ui/Pipeline.js';

/** Whose turn it is, the pipeline card's Turn (proof 02). */
export const TURN_WORDS: Record<StepsModel['tone'], string> = {
  you: 'Yours',
  run: "Agent's",
  ok: 'Done',
  error: 'Stopped',
  info: 'Paused',
  idle: 'Nobody',
};

/** A pipeline step's mark (V93): done a check, at work the arc, failed a cross, else its own. */
export function stepIcon(name: string, state: PipelineState): ReactNode {
  if (state === 'done') return <CheckIcon />;
  if (state === 'now') return <SpinIcon />;
  if (state === 'bad') return <CloseIcon />;
  switch (name) {
    case 'Your OK':
      return <BellIcon />;
    case 'Review':
      return <ReviewIcon />;
    case 'Merge':
    case 'Land':
      return <MergeIcon />;
    case 'Check':
      return <ChoreIcon />;
    default:
      return <PencilIcon />;
  }
}

/** The steps card outside the terminal view: Hive's pipeline once its record is read, else the steps. */
export function WorkspacePipeline({
  showPipeline,
  hiveDrives,
  row,
  hive,
  steps,
  merges,
  landed,
  read,
}: {
  showPipeline: boolean;
  hiveDrives: boolean;
  row: WorkspaceRow;
  hive: { detail: WorkspaceHiveDetail | null };
  steps: StepsModel;
  merges: ReturnType<typeof useWorkspaces>['merges'];
  landed: string | undefined;
  read: Exclude<ReturnType<typeof useChanges>, string | null> | null;
}) {
  const { workspace } = row;
  return (
    <>
      {showPipeline && hiveDrives && workspace.hive && hive.detail && (
        <HivePipeline
          model={steps}
          detail={hive.detail}
          into={workspace.from ?? 'its branch'}
          commits={workspace.ahead}
          push={merges?.push === true}
          created={workspace.created}
          landed={landed}
          icon={stepIcon}
        />
      )}
      {showPipeline && !(hiveDrives && workspace.hive && hive.detail) && (
        <Pipeline
          label="Its steps"
          steps={pipelineSteps(steps, {
            into: workspace.from ?? 'its branch',
            commits: workspace.ahead,
          }).map((step) => ({
            name: step.name,
            state: step.state,
            // At work, what its agent does now (V48f: "Thinking", "Editing src/a.ts").
            detail: step.state === 'now' && row.next.doing ? row.next.doing : step.detail,
            icon: stepIcon(step.name, step.state),
          }))}
          cells={
            hiveDrives && workspace.hive
              ? [
                  {
                    label: 'Round',
                    value: (
                      <>
                        {workspace.hive.round} <small>of {workspace.hive.rounds}</small>
                      </>
                    ),
                    words: steps.word,
                  },
                  {
                    label: 'Time',
                    value: (
                      <Since since={workspace.created} {...(landed ? { until: landed } : {})} />
                    ),
                    words: landed ? 'brief to landed' : 'since the brief',
                  },
                  ...(hive.detail?.spend
                    ? [
                        {
                          label: 'Spend',
                          value: `$${hive.detail.spend.total.toFixed(2)}`,
                          words:
                            hive.detail.spend.budget !== undefined
                              ? `of $${hive.detail.spend.budget.toFixed(2)}`
                              : 'no budget',
                        },
                      ]
                    : []),
                ]
              : [
                  {
                    label: 'Turn',
                    value: TURN_WORDS[steps.tone],
                    ...(steps.tone === 'you' ? { tone: 'you' as const } : {}),
                    ...(steps.since ? { words: `since ${startedAt(steps.since)}` } : {}),
                  },
                  {
                    label: 'Commits',
                    value: workspace.ahead,
                    words:
                      workspace.ahead === 0 && workspace.planFirst
                        ? 'plan first'
                        : read
                          ? `${changedFiles(read)} file${changedFiles(read) === 1 ? '' : 's'}`
                          : 'on its branch',
                  },
                ]
          }
        />
      )}
    </>
  );
}
