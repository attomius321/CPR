import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { backTrail, pushTrail, trailBack, type Trail } from './review.js';

/**
 * The detail panel's way back (V107, decision 982): `followLink` picks a symbol named in the panel
 * and keeps the pick it left on the trail; `back` returns to it; `previous` is where Back goes,
 * null without a trail. Any other pick (the sidebar, j/k, the canvas, Esc) leaves the trail's end,
 * and the trail is dropped.
 */
export function useTrail(
  selected: string | null,
  setSelected: Dispatch<SetStateAction<string | null>>,
): { followLink: (id: string) => void; back: () => void; previous: string | null } {
  const [trail, setTrail] = useState<Trail | null>(null);
  useEffect(() => {
    if (trail && trail.at !== selected) setTrail(null);
  }, [trail, selected]);
  const followLink = useCallback(
    (id: string) => {
      if (selected !== null && id !== selected) setTrail((t) => pushTrail(t, selected, id));
      setSelected(id);
    },
    [selected, setSelected],
  );
  const back = useCallback(() => {
    const step = backTrail(trail);
    if (!step) return;
    setTrail(step.trail);
    setSelected(step.pick);
  }, [trail, setSelected]);
  return { followLink, back, previous: trailBack(trail, selected) };
}
