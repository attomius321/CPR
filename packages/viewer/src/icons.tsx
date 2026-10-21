import type { ReactNode } from 'react';

/**
 * CPR's icons (V29): 16 px line drawings in the text's colour. Inline SVG, so no icon library is
 * bundled; each is decorative (`aria-hidden`), named by the control that holds it.
 */
function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const HistoryIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

/** The sidenav's edge: folds it to a rail, or opens it. */
export const SidenavIcon = () => (
  <Icon>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6 3v10" />
  </Icon>
);

/** A workspace's changes panel (V29d), at the right: shows or hides it. */
export const ChangesIcon = () => (
  <Icon>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M10 3v10" />
  </Icon>
);

export const MenuIcon = () => (
  <Icon>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <circle cx="3.5" cy="8" r="0.6" />
    <circle cx="8" cy="8" r="0.6" />
    <circle cx="12.5" cy="8" r="0.6" />
  </Icon>
);

/** CPR's mark: two commits and the line between them. */
/** Back and forward, in CPR's window's title bar (N1c). */
export const BackIcon = () => (
  <Icon>
    <path d="M13 8H3M7 4L3 8l4 4" />
  </Icon>
);

export const ForwardIcon = () => (
  <Icon>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Icon>
);

export const CprIcon = () => (
  <Icon>
    <circle cx="5" cy="5" r="2" />
    <circle cx="11" cy="11" r="2" />
    <path d="M5 7v2a2 2 0 0 0 2 2h2" />
  </Icon>
);

/** Open or folded (a folder, a project, More): down when open, right when folded. */
export const ChevronIcon = ({ open }: { open: boolean }) => (
  <Icon className={open ? 'chevron open' : 'chevron'}>
    <path d="M6 4l4 4-4 4" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

/** The window's own buttons, where CPR draws them (N1d). */
export const MinimizeIcon = () => (
  <Icon>
    <path d="M4 8h8" />
  </Icon>
);

export const MaximizeIcon = () => (
  <Icon>
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
  </Icon>
);

export const RestoreIcon = () => (
  <Icon>
    <rect x="3.5" y="5.5" width="7" height="7" rx="1.5" />
    <path d="M6 5.5V5A1.5 1.5 0 0 1 7.5 3.5H11A1.5 1.5 0 0 1 12.5 5v3.5A1.5 1.5 0 0 1 11 10h-.5" />
  </Icon>
);
