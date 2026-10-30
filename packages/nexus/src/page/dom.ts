// The page's drawing helpers (NX1b): elements, and icons as the viewer draws them. Shared by the
// tabs and lists (`main.ts`) and the Folders tab (`folders-view.ts`).

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false) continue;
    node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

/** An icon as the viewer draws it (`ui/icons.tsx`): its paths on its grid. */
export function icon(paths: string, lucide = false): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', lucide ? 'icon lucide' : 'icon');
  svg.setAttribute('viewBox', lucide ? '0 0 24 24' : '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = paths;
  return svg;
}

// The viewer's own (`ui/icons.tsx`): lucide's git-branch, folder and circle-stop, circle-pause,
// and the window's buttons.
export const BRANCH =
  '<path d="M6 3v12" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />';
export const FOLDER =
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />';
export const STOP =
  '<circle cx="12" cy="12" r="10" /><rect x="9" y="9" width="6" height="6" rx="1" />';
export const STOPPED = '<circle cx="8" cy="8" r="6" /><path d="M6.67 10V6M9.33 10V6" />';
export const MINIMIZE = '<path d="M4 8h8" />';
export const MAXIMIZE = '<rect x="4" y="4" width="8" height="8" rx="1.5" />';
export const RESTORE =
  '<rect x="3.5" y="5.5" width="7" height="7" rx="1.5" /><path d="M6 5.5V5A1.5 1.5 0 0 1 7.5 3.5H11A1.5 1.5 0 0 1 12.5 5v3.5A1.5 1.5 0 0 1 11 10h-.5" />';
export const CLOSE = '<path d="M4 4l8 8M12 4l-8 8" />';

// The Folders tab's (NX2b), lucide's (ISC): house, hard-drive, folder-git-2, arrow-up.
export const HOUSE =
  '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />';
export const DRIVE =
  '<path d="M22 12H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /><path d="M6 16h.01" /><path d="M10 16h.01" />';
export const FOLDER_GIT =
  '<path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" /><circle cx="13" cy="12" r="2" /><path d="M18 19c-2.8 0-5-2.2-5-5v8" /><circle cx="20" cy="19" r="2" />';
export const ARROW_UP = '<path d="m5 12 7-7 7 7" /><path d="M12 19V5" />';

// NX3's, lucide's (ISC): layout-grid (Symbiotes' tab), chevron-right (a folder's way in).
export const GRID =
  '<rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" />';
export const CHEVRON_RIGHT = '<path d="m9 18 6-6-6-6" />';

// NX4's, lucide's (ISC): pin.
export const PIN =
  '<path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />';

/**
 * A pin's button (NX4, decision 620): an outline that pins `name`, filled in the accent once
 * pinned, when it unpins. `kind`, its first class, tells the head's, a card's and a pin's row's
 * apart when the focus is put back after a drawing.
 */
export function pinButton(
  kind: string,
  { name, path, pinned }: { name: string; path: string; pinned: boolean },
  toggle: () => void,
): HTMLButtonElement {
  const button = el(
    'button',
    {
      type: 'button',
      class: pinned ? `${kind} icon-button nexus-pinned` : `${kind} icon-button`,
      'aria-label': `${pinned ? 'Unpin' : 'Pin'} ${name}`,
      'data-path': path,
    },
    icon(PIN, true),
  );
  button.addEventListener('click', toggle);
  return button;
}
