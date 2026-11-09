// A stopped Symbiote's panel on the nexus page: Start again, Close tab (NX2).
import { el, icon, loading, STOPPED } from './dom.js';
import type { Tab } from './tabs.js';
import type { PageState } from './state.js';

/** The panel of a stopped tab: `draw` when its tab is open, `clear` when another is. */
export function stoppedView(
  state: PageState,
  {
    startAgain,
    closeStopped,
  }: {
    startAgain: (root: string) => Promise<void>;
    closeStopped: (root: string) => void;
  },
) {
  const stopped = el('section', { class: 'nexus-stopped', role: 'tabpanel', hidden: true });

  /** What the panel last drew: drawn again only when what it shows changed. */
  const drawn = { stopped: '' };

  function drawStopped(tab: Tab): void {
    const busy = state.restarting.has(tab.root);
    const why = state.restartFailure?.root === tab.root ? state.restartFailure.why : null;
    const key = JSON.stringify([tab.root, tab.name, busy, why]);
    if (key === drawn.stopped) return;
    drawn.stopped = key;
    const again = el(
      'button',
      { type: 'button', class: 'button', disabled: busy },
      busy ? loading('Starting…') : 'Start again',
    );
    again.addEventListener('click', () => void startAgain(tab.root));
    const close = el('button', { type: 'button', class: 'button secondary' }, 'Close tab');
    close.addEventListener('click', () => closeStopped(tab.root));
    stopped.replaceChildren(
      el(
        'div',
        { class: 'nexus-empty' },
        icon(STOPPED),
        el('p', { class: 'nexus-empty-title' }, `${tab.name} stopped`),
        el(
          'p',
          { class: 'nexus-empty-text' },
          'Its ',
          el('code', {}, 'symbiote view'),
          ' ended: start it again here, or run it again in its folder, and this tab takes it back.',
        ),
        el('p', { class: 'nexus-empty-text' }, el('code', {}, tab.root)),
        why ? el('p', { class: 'nexus-empty-text error', role: 'alert' }, why) : null,
        el('div', { class: 'nexus-empty-actions' }, again, close),
      ),
    );
  }

  /** Empties the panel, once, when no stopped tab is open. */
  function clear(): void {
    if (drawn.stopped !== '') {
      drawn.stopped = '';
      stopped.replaceChildren();
    }
  }

  return { element: stopped, draw: drawStopped, clear };
}
