import { useId, type ReactNode } from 'react';
import mark from './mark.png';
import markLarge from './mark-96.png';
import { tip } from './tip.js';

/**
 * Symbiote's icons (V29): 16 px line drawings in the text's colour. Inline SVG, so no icon library
 * is bundled; each is decorative (`aria-hidden`), named by the control that holds it. `lucide`:
 * drawn on lucide's own 24-unit grid, its paths as published (V63), the stroke made to match.
 */
function Icon({
  children,
  className,
  lucide,
}: {
  children: ReactNode;
  className?: string;
  lucide?: boolean;
}) {
  const classes = ['icon', lucide && 'lucide', className].filter(Boolean).join(' ');
  return (
    <svg
      className={classes}
      viewBox={lucide ? '0 0 24 24' : '0 0 16 16'}
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

/** A review's comments on a file (V60), after lucide's message-square (ISC). */
export const CommentIcon = () => (
  <Icon>
    <path d="M14 10a1.3 1.3 0 0 1-1.3 1.3H4.7L2 14V3.3A1.3 1.3 0 0 1 3.3 2h9.4A1.3 1.3 0 0 1 14 3.3Z" />
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

/** A terminal (V61): where one answers a workspace's agent; after lucide's (ISC). */
export const TerminalIcon = () => (
  <Icon>
    <path d="M3 11.5 6.5 8 3 4.5M8 12h5" />
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
 * Symbiote's mark (V61): the person's S, cut round from `scripts/desktop/logo.png` by
 * `scripts/desktop/icon.mjs`, at 64 px for 32 on screen (20 in the title bar), 96 for the start
 * page's 48 (V63). Never 16: V39's koi S did not read there.
 */
export const SymbioteMark = ({ size = 32 }: { size?: 32 | 48 }) => (
  <img
    className={size === 32 ? 'symbiote-mark' : 'symbiote-mark large'}
    src={size === 32 ? mark : markLarge}
    alt=""
    width={size}
    height={size}
    draggable={false}
  />
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

/** A prompt back to Symbiote's text, in Settings (V62): an arrow turning back, lucide's rotate-ccw (ISC). */
export const ResetIcon = () => (
  <Icon>
    <path d="M2 8a6 6 0 1 0 6-6 6.5 6.5 0 0 0-4.5 1.83L2 5.33" />
    <path d="M2 2v3.33h3.33" />
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
 * Claude's spark and OpenAI's blossom for Codex are Simple Icons' (CC0); the marks are their makers'.
 * Hermes's caduceus is drawn here after the ☤ its CLI shows (V58).
 */
export const ClaudeMark = () => (
  <svg
    className="agent-mark claude"
    viewBox="0 0 24 24"
    fill="#d97757"
    role="img"
    aria-label="Claude Code"
    {...tip('Claude Code')}
  >
    <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
  </svg>
);

/** Codex's: OpenAI's blossom, in OpenAI's own colours, white on the dark theme, black on the light. */
export const CodexMark = () => (
  <svg
    className="agent-mark codex"
    viewBox="0 0 24 24"
    fill="var(--openai)"
    role="img"
    aria-label="Codex"
    {...tip('Codex')}
  >
    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
  </svg>
);

/**
 * Hermes's caduceus (V58), the ☤ its CLI shows, drawn: a glyph would be a font lookup (V29b). In
 * its CLI's golds, in a gradient whose `id` is its own: a repeated one may name a gradient not drawn.
 */
export function HermesMark() {
  const gradient = useId();
  return (
    <svg
      className="agent-mark hermes"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Hermes"
      {...tip('Hermes')}
    >
      <defs>
        <linearGradient id={gradient} x2="0" y2="1">
          <stop stopColor="#ffd700" />
          <stop offset="1" stopColor="#b8860b" />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradient})`}>
        <circle cx="12" cy="2.6" r="1.8" />
        <rect x="10.9" y="3.6" width="2.2" height="19.4" rx="1.1" />
        <path d="M11 6.2C8.6 4 5 3.5 1.2 4.6c2.3 1 4 2.2 5.1 3.9 1.5-.7 3.1-1 4.7-.8z" />
        <path d="M13 6.2c2.4-2.2 6-2.7 9.8-1.6-2.3 1-4 2.2-5.1 3.9-1.5-.7-3.1-1-4.7-.8z" />
      </g>
      <path
        fill="none"
        stroke={`url(#${gradient})`}
        strokeWidth="2"
        strokeLinecap="round"
        d="M8.2 10.2c0 2.3 7.6 1.8 7.6 4.5S8.2 17 8.2 19.4c0 1.4 2.2 2 3.8 1.8M15.8 10.2c0 2.3-7.6 1.8-7.6 4.5s7.6 2.3 7.6 4.7c0 1.4-2.2 2-3.8 1.8"
      />
    </svg>
  );
}

/*
 * The start page's icons (V63, the person's mockup): lucide's paths (ISC) on its 24-unit grid. The
 * kinds of work, the run's cards, and the controls the mockup draws.
 */

/** Feature, and Source: lucide's git-branch. */
export const BranchIcon = () => (
  <Icon lucide>
    <path d="M6 3v12" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </Icon>
);

/** Fix: lucide's scissors. */
export const FixIcon = () => (
  <Icon lucide>
    <circle cx="6" cy="6" r="3" />
    <path d="M8.12 8.12 12 12" />
    <path d="M20 4 8.12 15.88" />
    <circle cx="6" cy="18" r="3" />
    <path d="M14.8 14.8 20 20" />
  </Icon>
);

/** Refactor: lucide's blocks. */
export const RefactorIcon = () => (
  <Icon lucide>
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3" />
  </Icon>
);

/** Chore: lucide's power. */
export const ChoreIcon = () => (
  <Icon lucide>
    <path d="M12 2v10" />
    <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
  </Icon>
);

/** Spike: lucide's route. */
export const SpikeIcon = () => (
  <Icon lucide>
    <circle cx="6" cy="19" r="3" />
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    <circle cx="18" cy="5" r="3" />
  </Icon>
);

/** The agent's card: lucide's bot. */
export const AgentIcon = () => (
  <Icon lucide>
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </Icon>
);

/** The model's card: lucide's cpu. */
export const ModelIcon = () => (
  <Icon lucide>
    <rect width="16" height="16" x="4" y="4" rx="2" />
    <rect width="6" height="6" x="9" y="9" rx="1" />
    <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
  </Icon>
);

/** The effort's card: lucide's zap. */
export const EffortIcon = () => (
  <Icon lucide>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </Icon>
);

/** The permissions' card: lucide's shield-half. */
export const PermissionIcon = () => (
  <Icon lucide>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="M12 22V2" />
  </Icon>
);

/** Plan first's card: lucide's clock. */
export const PlanIcon = () => (
  <Icon lucide>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </Icon>
);

/** The documents' card, and a skill's SKILL.md on the Skills page (V64): lucide's file-text. */
export const DocumentsIcon = () => (
  <Icon lucide>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8M16 13H8M16 17H8" />
  </Icon>
);

/** Start workspace: lucide's play. */
export const PlayIcon = () => (
  <Icon lucide>
    <path d="M6 3l14 9-14 9z" />
  </Icon>
);

/** Branch name back to the title's: lucide's shuffle. */
export const ShuffleIcon = () => (
  <Icon lucide>
    <path d="m18 14 4 4-4 4" />
    <path d="m18 2 4 4-4 4" />
    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
    <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
    <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
  </Icon>
);

/** The brief's advice: lucide's lightbulb. */
export const AdviceIcon = () => (
  <Icon lucide>
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
    <path d="M9 18h6" />
    <path d="M10 22h4" />
  </Icon>
);

/** Before a subscription: lucide's crown. */
export const SubscriptionIcon = () => (
  <Icon lucide>
    <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" />
    <path d="M5 21h14" />
  </Icon>
);

/** Files for the documents, from the goal's tools: lucide's paperclip. */
export const AttachIcon = () => (
  <Icon lucide>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Icon>
);

/** The goal as Markdown: an M and a down arrow in a frame, Markdown's own mark. */
export const MarkdownIcon = () => (
  <Icon lucide>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="M6 15V9l3 3 3-3v6" />
    <path d="M17 9v6" />
    <path d="m14.5 12.5 2.5 2.5 2.5-2.5" />
  </Icon>
);

/** The Skills page's search (V64): lucide's search. */
export const SearchIcon = () => (
  <Icon lucide>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </Icon>
);

/** Scribe, and Improve with Scribe (V64): lucide's sparkles. */
export const SparklesIcon = () => (
  <Icon lucide>
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
  </Icon>
);

/** Save a skill (V64): lucide's save. */
export const SaveIcon = () => (
  <Icon lucide>
    <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
    <path d="M7 3v4a1 1 0 0 0 1 1h7" />
  </Icon>
);

/** The skill library's entry (V64): lucide's folder. */
export const FolderIcon = () => (
  <Icon lucide>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Icon>
);

/** A skill's text over the main area (V64): lucide's maximize-2. */
export const ExpandIcon = () => (
  <Icon lucide>
    <path d="M15 3h6v6M21 3l-7 7M3 21l7-7M9 21H3v-6" />
  </Icon>
);

/** Back from over the main area (V64): lucide's minimize-2. */
export const CollapseIcon = () => (
  <Icon lucide>
    <path d="m14 10 7-7M20 10h-6V4M3 21l7-7M4 14h6v6" />
  </Icon>
);

/** A skill's checks (V64): lucide's shield-check. */
export const ChecksIcon = () => (
  <Icon lucide>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

/** What cannot be done as picked (V67: a target that cannot fast-forward): lucide's circle-alert. */
export const AlertIcon = () => (
  <Icon lucide>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4M12 16h.01" />
  </Icon>
);
