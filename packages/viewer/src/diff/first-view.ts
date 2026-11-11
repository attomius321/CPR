// The Graph page's first view (V109, decision 986): a change with an error or a warning opens on
// its riskiest finding's symbol, focused; otherwise, or when the person chose it, on the whole
// change. Pure: `useFirstView.ts` applies it.
import type { Finding } from '@symbiote/core';

/** What the Graph page opens on: the riskiest finding, or the whole change (as before V109). */
export type FirstView = 'risk' | 'whole';

/** Where the person's last choice is kept in this browser (`ui/stored.ts`). */
export const FIRST_VIEW_KEY = 'symbiote.viewer.first-view';

/** The kept choice: the riskiest finding unless the whole change was chosen. */
export function firstViewOf(stored: string | null): FirstView {
  return stored === 'whole' ? 'whole' : 'risk';
}

/**
 * The view F goes to: the whole change from any pick (the riskiest or another), the riskiest
 * finding from the whole change. The person sees it move whatever they did since the page opened.
 */
export function viewAfterF(selected: string | null): FirstView {
  return selected === null ? 'risk' : 'whole';
}

/**
 * The symbol of the change's riskiest finding: the first error listed, else the first warning,
 * whose symbol the graph holds. `shown` is the Findings tab's list (`foldFindings`), so the head's
 * first pill and the tab's first row are about it. None for a change with only infos, or none.
 */
export function riskiest(
  shown: readonly Finding[],
  nodes: readonly { readonly id: string }[],
): string | null {
  const ids = new Set(nodes.map((node) => node.id));
  const first = (severity: Finding['severity']) =>
    shown.find((finding) => finding.severity === severity && ids.has(finding.symbol));
  return (first('error') ?? first('warning'))?.symbol ?? null;
}

/**
 * The symbol the Graph page's first view picks: the riskiest, when the person keeps that view and
 * nothing is picked yet. A pick carried from Files (V104's `g` on a line) is the person's own.
 */
export function symbolOpened(
  view: FirstView,
  risk: string | null,
  selected: string | null,
): string | null {
  return view === 'risk' && selected === null ? risk : null;
}
