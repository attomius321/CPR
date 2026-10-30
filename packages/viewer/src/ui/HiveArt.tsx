import { useId } from 'react';
import {
  centreline,
  hexagon,
  highlight,
  JOINING,
  SIDENAV_TENDRILS,
  taper,
  type Tendril,
} from './hive-art.js';

/** A tendril's body, its crimson edge, and two highlights: wet, rounded, glossy. */
function Body({ tendril, fill }: { tendril: Tendril; fill: string }) {
  return (
    <>
      <path className="hive-body" d={taper(tendril)} fill={fill} />
      <path className="hive-shine" d={highlight(tendril, { side: 0.28, from: 0.05, to: 0.7 })} />
      <path
        className="hive-shine faint"
        d={highlight(tendril, { side: -0.18, from: 0.2, to: 0.55 })}
      />
    </>
  );
}

/** An SVG id of `useId`'s, without the characters a `url(#…)` reference would trip on. */
const svgId = (id: string) => id.replace(/[^\w-]/g, '');

/**
 * Hive mode's tendrils at the sidenav's foot (V82, decision 614), behind its rows; decorative.
 * Their colours are `ui/hive.css`'s.
 */
export function HiveTendrils() {
  const ink = `hive-ink-${svgId(useId())}`;
  return (
    <svg
      className="hive-tendrils"
      viewBox="0 0 300 420"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={ink} x1="0" y1="1" x2="0" y2="0">
          <stop className="hive-ink-deep" offset="0" />
          <stop className="hive-ink-top" offset="1" />
        </linearGradient>
      </defs>
      {SIDENAV_TENDRILS.map((tendril, i) => (
        <Body key={i} tendril={tendril} fill={`url(#${ink})`} />
      ))}
    </svg>
  );
}

/**
 * The Hive dialog's head (decision 615): tendrils grow in from both sides along their lines (a
 * mask drawn by `hive.css`'s animation), meet, and a hexagon closes where they meet; then all is
 * still. With reduced motion, the last frame.
 */
export function HiveJoining() {
  const id = svgId(useId());
  const { cx, cy, r } = JOINING.hexagon;
  return (
    <svg
      className="hive-joining"
      viewBox={`0 0 ${JOINING.width} ${JOINING.height}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-ink`} x1="0" y1="0" x2="0" y2="1">
          <stop className="hive-ink-top" offset="0" />
          <stop className="hive-ink-mid" offset="0.6" />
          <stop className="hive-ink-deep" offset="1" />
        </linearGradient>
        <radialGradient id={`${id}-core`} cx="0.4" cy="0.3" r="0.8">
          <stop className="hive-core-light" offset="0" />
          <stop className="hive-core-dark" offset="0.7" />
        </radialGradient>
        {JOINING.tendrils.map((tendril, i) => (
          <mask key={i} id={`${id}-grow-${i}`} maskUnits="userSpaceOnUse">
            <path
              className={i % 3 === 2 ? 'hive-grow later' : 'hive-grow'}
              d={centreline(tendril.path)}
              pathLength={1}
              strokeWidth={tendril.width + 6}
            />
          </mask>
        ))}
      </defs>
      {JOINING.tendrils.map((tendril, i) => (
        <g key={i} mask={`url(#${id}-grow-${i})`}>
          <Body tendril={tendril} fill={`url(#${id}-ink)`} />
        </g>
      ))}
      <path className="hive-hex-fill" d={hexagon(cx, cy, r)} fill={`url(#${id}-core)`} />
      <path className="hive-hex-line" d={hexagon(cx, cy, r)} pathLength={1} />
      <path className="hive-hex-inner" d={hexagon(cx, cy, r * 0.55)} pathLength={1} />
    </svg>
  );
}
