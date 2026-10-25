import type { ReactNode } from 'react';
import koiMark from './koi-mark.png';

/**
 * Symbiote's icons (V29): 16 px line drawings in the text's colour. Inline SVG, so no icon library
 * is bundled; each is decorative (`aria-hidden`), named by the control that holds it.
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

/** Scout (V35): a compass, after lucide's (ISC). */
export const ScoutIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="M10.5 5.5 9.3 9.3 5.5 10.5l1.2-3.8z" />
  </Icon>
);

/** Skills (V41): an open book, after lucide's book-open (ISC). */
export const SkillsIcon = () => (
  <Icon>
    <path d="M8 4.7V14" />
    <path d="M2 12V2.7h3.3A2.7 2.7 0 0 1 8 5.3a2.7 2.7 0 0 1 2.7-2.6H14V12h-4a2 2 0 0 0-2 2 2 2 0 0 0-2-2z" />
  </Icon>
);

/** The Monitor (RM1): unequal blocks, a treemap, after lucide's layout-dashboard (ISC). */
export const MonitorIcon = () => (
  <Icon>
    <rect x="2" y="2" width="4.7" height="6" rx="0.7" />
    <rect x="9.3" y="2" width="4.7" height="3.3" rx="0.7" />
    <rect x="9.3" y="8" width="4.7" height="6" rx="0.7" />
    <rect x="2" y="10.7" width="4.7" height="3.3" rx="0.7" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </Icon>
);

/** The sidenav's Merging group (V44): two branches joining, after lucide's git-merge (ISC). */
export const MergingIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="2" />
    <circle cx="4" cy="4" r="2" />
    <path d="M4 14V6a6 6 0 0 0 6 6" />
  </Icon>
);

/**
 * The sidenav's Waiting for you group (V48; Needs you's in V44): an agent waits on the person, after
 * lucide's bell (ISC).
 */
export const WaitingIcon = () => (
  <Icon>
    <path d="M6.85 14a1.33 1.33 0 0 0 2.3 0" />
    <path d="M2.17 10.22a.67.67 0 0 0 .5 1.11h10.66a.67.67 0 0 0 .5-1.11C12.94 9.3 12 8.33 12 5.33a4 4 0 0 0-8 0c0 3-.94 3.97-1.83 4.89" />
  </Icon>
);

/**
 * The sidenav's Working group (V44): busy, after lucide's hourglass (ISC). Not a clock: that is
 * History's icon, two rows above.
 */
export const WorkingIcon = () => (
  <Icon>
    <path d="M3.33 14.67h9.34M3.33 1.33h9.34" />
    <path d="M11.33 14.67v-2.78a1.33 1.33 0 0 0-.39-.94L8 8l-2.94 2.94a1.33 1.33 0 0 0-.39.94v2.79" />
    <path d="M4.67 1.33v2.78a1.33 1.33 0 0 0 .39.94L8 8l2.94-2.94a1.33 1.33 0 0 0 .39-.94V1.33" />
  </Icon>
);

/** The sidenav's To review group (V48): work to look at, after lucide's eye (ISC). */
export const ReviewIcon = () => (
  <Icon>
    <path d="M1.37 8.23a.67.67 0 0 1 0-.46 7.17 7.17 0 0 1 13.26 0 .67.67 0 0 1 0 .46 7.17 7.17 0 0 1-13.26 0" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);

/** The sidenav's Not running group (V48): stopped or failed, after lucide's circle-pause (ISC). */
export const StoppedIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.67 10V6M9.33 10V6" />
  </Icon>
);

/** The sidenav's Done group (V44): merged, after lucide's circle-check (ISC). */
export const DoneIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="m6 8 1.33 1.33L10 6.67" />
  </Icon>
);

/** An image dropped on the agent's terminal (V36), after lucide's (ISC). */
export const ImageIcon = () => (
  <Icon>
    <rect x="2" y="2" width="12" height="12" rx="1.5" />
    <circle cx="6" cy="6" r="1.3" />
    <path d="m14 10-2.1-2.1a1.3 1.3 0 0 0-1.8 0L4 14" />
  </Icon>
);

/** A file given with a brief (V40), after lucide's file (ISC). */
export const FileIcon = () => (
  <Icon>
    <path d="M9.5 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5Z" />
    <path d="M9.5 1.5V4A1 1 0 0 0 10.5 5H13" />
  </Icon>
);

/** Help (V37), after lucide's circle-help (ISC): the button a page's or a field's help is behind. */
export const HelpIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.1 6a2 2 0 0 1 3.9.7c0 1.3-2 2-2 2" />
    <path d="M8 11.3h.01" />
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

/** Symbiote's mark: two commits and the line between them. */
/** Back and forward, in Symbiote's window's title bar (N1c). */
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

/**
 * Symbiote's mark (V42, decision 282): the koi S, the app's icon cropped to its tile, at 48 px for
 * 24 px on screen. It reads as an S from 24 px; V39 kept a glyph because it does not at 16.
 */
export const KoiMark = () => (
  <img className="koi-mark" src={koiMark} alt="" width={24} height={24} draggable={false} />
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

/** The window's own buttons, where Symbiote draws them (N1d). */
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
