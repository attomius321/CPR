// A workspace's steps card (V93, decision 884; proofs 02, 03, 07): Hive's pipeline or the normal
// one, its steps' marks and its cells.
import type { ReactNode } from 'react';
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
