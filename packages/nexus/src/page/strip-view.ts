// The nexus page's row of tabs (decisions 551, 626): Symbiotes, a line, then each Symbiote's tab
// with its state's dot; a stopped one closes. The arrows, Home and End move between them.
import { CLOSE, el, GRID, icon, type Child } from './dom.js';
import { checkoutText } from './tabs.js';
import type { PageState } from './state.js';

/** The row of tabs over the page's state: `draw` draws it again when what it shows changed. */
export function stripView(
  state: PageState,
  {
    select,
    closeStopped,
  }: {
    select: (root: string | null, options?: { focusFrame?: boolean }) => void;
    closeStopped: (root: string) => void;
  },
) {
  // The row's tabs are the viewer's session tabs (V89's `.workspace-tabs`, `.stab`): its line tabs'
  // look lives on those classes only (fix/fix-nexus-top-left).
  const strip = el('div', {
    class: 'workspace-tabs nexus-tabs',
    role: 'tablist',
    'aria-label': 'Running Symbiotes',
  });

  /** What the row last drew: drawn again only when what it shows changed. */
  const drawn = { strip: '' };

  function drawStrip(): void {
    const key = JSON.stringify([
      state.selected,
      state.tabs.length,
      state.tabs.map((t) => [t.root, t.name, t.url, t.branch, t.head]),
    ]);
    if (key === drawn.strip) return;
    drawn.strip = key;
    const focused = (document.activeElement as HTMLElement | null)?.dataset.tab;
    const running = state.tabs.filter((tab) => tab.url !== null).length;
    const list = tabButton(
      null,
      icon(GRID, true),
      el('span', {}, 'Symbiotes'),
      el('span', { class: 'count' }, String(running)),
    );
    // The nexus's own page, with its icon, stays at the left; a line, then the Symbiotes, each with
    // its state's dot (decision 551). Folders is under Symbiotes since decision 626.
    const own = el(
      'div',
      { class: 'nexus-own' },
      list,
      state.tabs.length > 0 && el('span', { class: 'views-divider', 'aria-hidden': 'true' }),
    );
    const children: HTMLElement[] = [own];
    for (const tab of state.tabs) {
      const button = tabButton(
        tab.root,
        el('span', {
          class: tab.url === null ? 'state-dot tone-idle' : 'state-dot nexus-live',
          'aria-hidden': 'true',
        }),
        el('span', { class: 'nexus-tab-name' }, tab.name),
        el('span', { class: 'nexus-tab-where' }, tab.url === null ? 'stopped' : checkoutText(tab)),
      );
      if (tab.url !== null) {
        children.push(button);
        continue;
      }
      // A stopped tab closes, as a workspace's shell does (its × inside the tab).
      button.classList.add('nexus-tab-stopped');
      const close = el(
        'button',
        { type: 'button', class: 'icon-button shell-close', 'aria-label': `Close ${tab.name}` },
        icon(CLOSE),
      );
      close.addEventListener('click', () => closeStopped(tab.root));
      children.push(el('div', { class: 'shell-tab' }, button, close));
    }
    strip.replaceChildren(...children);
    // A Symbiote's tab focused by the keys scrolls clear of the own pages over the strip's start.
    strip.style.scrollPaddingInlineStart = `${own.offsetWidth}px`;
    if (focused !== undefined)
      strip.querySelector<HTMLElement>(`[data-tab="${CSS.escape(focused)}"]`)?.focus();
  }

  function tabButton(root: string | null, ...children: Child[]): HTMLButtonElement {
    const picked = root === state.selected;
    const button = el(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: picked ? 'stab selected' : 'stab',
        'aria-selected': picked ? 'true' : 'false',
        tabindex: picked ? '0' : '-1',
        'data-tab': root ?? '',
      },
      ...children,
    );
    button.addEventListener('click', () => select(root, { focusFrame: true }));
    return button;
  }

  // The tabs by the keys, as a tab list has them: the arrows, Home and End.
  strip.addEventListener('keydown', (event) => {
    const buttons = [...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to =
      event.key === 'ArrowRight'
        ? (at + 1) % buttons.length
        : event.key === 'ArrowLeft'
          ? (at - 1 + buttons.length) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : -1;
    const next = buttons[to];
    if (!next) return;
    event.preventDefault();
    const root = next.dataset.tab;
    select(root ? root : null);
    strip.querySelector<HTMLElement>(`[data-tab="${CSS.escape(root ?? '')}"]`)?.focus();
  });

  return { element: strip, draw: drawStrip };
}
