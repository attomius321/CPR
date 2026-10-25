import { useId, type ReactNode } from 'react';
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

/**
 * Removes a done workspace or a landed merge from its card (V55): a bin, after lucide's trash-2
 * (ISC). Clean up deletes a worktree and a branch: an × would read as hiding the card.
 */
export const TrashIcon = () => (
  <Icon>
    <path d="M2.5 4h11" />
    <path d="M12.5 4v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 13V4" />
    <path d="M5.5 4V3A1.5 1.5 0 0 1 7 1.5h2A1.5 1.5 0 0 1 10.5 3v1" />
    <path d="M6.5 7v4.5M9.5 7v4.5" />
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

/**
 * The agents' marks (V53, decision 395): which agent works, before what it does. Filled, in their
 * vendors' colours in both themes, and named, unlike the icons above: the mark alone says it.
 * Claude's spark is Simple Icons' (CC0), Codex's Lobe Icons' (MIT); the marks are their makers'.
 */
export const ClaudeMark = () => (
  <svg
    className="agent-mark claude"
    viewBox="0 0 24 24"
    fill="#d97757"
    role="img"
    aria-label="Claude Code"
  >
    <title>Claude Code</title>
    <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
  </svg>
);

/** Codex's, in its gradient, whose `id` is its own: a repeated one may name a gradient not drawn. */
export function CodexMark() {
  const gradient = useId();
  return (
    <svg className="agent-mark codex" viewBox="0 0 24 24" role="img" aria-label="Codex">
      <title>Codex</title>
      <defs>
        <linearGradient id={gradient} x2="0" y2="1">
          <stop stopColor="#b1a7ff" />
          <stop offset="0.5" stopColor="#7a9dff" />
          <stop offset="1" stopColor="#3941ff" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradient})`}
        fillRule="evenodd"
        d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"
      />
    </svg>
  );
}
