import type { ReactNode } from 'react';
import { BellIcon, MergeIcon, PencilIcon, ReviewIcon } from '../ui/icons.js';
import type { NextStep } from './start-next.js';

/** What happens next's marks (V93, proof 06): the person's violet, the rest faint. */
export const NEXT_ICONS: Record<NextStep['icon'], ReactNode> = {
  pencil: <PencilIcon />,
  bell: <BellIcon />,
  eye: <ReviewIcon />,
  merge: <MergeIcon />,
};
