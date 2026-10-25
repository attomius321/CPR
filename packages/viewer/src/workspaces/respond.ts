// Respond to a waiting agent (V48): its workspace opened on its terminal, focused — or its thread
// and the box, where no terminal runs. A workspace opened anew focuses its terminal as it opens;
// one already open is told by this event, which its panel listens for.
import type { Route } from '../shell/pages.js';

/** The event an open workspace's panel takes as "respond": its `detail` is the branch. */
export const RESPOND_EVENT = 'symbiote:respond';

/** Opens `branch`'s workspace and asks its panel to take the person's answer. */
export function respondTo(branch: string, navigate: ((route: Route) => void) | undefined): void {
  navigate?.({ page: 'workspace', branch });
  // After the route's render: a panel already open for it takes the event.
  requestAnimationFrame(() =>
    window.dispatchEvent(new CustomEvent(RESPOND_EVENT, { detail: branch })),
  );
}
