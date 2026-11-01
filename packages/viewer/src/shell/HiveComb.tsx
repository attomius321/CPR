// Hive's honeycomb behind the page while Hive is on (V85, decisions 701–707): the arrival's shutter
// kept, one SVG path drawn once and again only when the window's size changes, on the lattice the
// arrival laid (`layComb`) or, loaded with Hive on in a new tab, centred on the window. Mounted
// once at the root (`main.tsx`): every page, a diff's and its loading too, draws the same tiles.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { combLattice, combRadius } from '../ui/hive-art.js';
import { combPath, layComb, laidComb, onComb } from './hive-comb.js';
import { useHive } from './hive.js';

const windowSize = () => ({ width: window.innerWidth, height: window.innerHeight });

/** The honeycomb, while Hive is on; nothing while it is off, and the tab forgets its tiles. */
export function HiveComb() {
  const on = useHive();
  useEffect(() => {
    if (!on) layComb(null);
  }, [on]);
  return on ? <Comb /> : null;
}

function Comb() {
  const laid = useSyncExternalStore(onComb, laidComb);
  const [size, setSize] = useState(windowSize);
  // Nothing laid yet (Hive on at load, in a new tab): the window's middle, kept for the tab.
  const origin = laid ?? {
    x: size.width / 2,
    y: size.height / 2,
    r: combRadius(size.width, size.height),
  };

  useEffect(() => {
    if (!laidComb()) layComb(origin);
    // Once, as it is first drawn: a resize keeps the lattice.
  }, []);

  useEffect(() => {
    const resize = () => setSize(windowSize());
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const d = useMemo(() => {
    const { centres, r } = combLattice(size.width, size.height, [origin.x, origin.y], origin.r);
    return combPath(centres, r);
  }, [size.width, size.height, origin.x, origin.y, origin.r]);

  return (
    <svg
      className="hive-comb"
      aria-hidden="true"
      width={size.width}
      height={size.height}
      data-x={origin.x}
      data-y={origin.y}
      data-r={origin.r}
    >
      <path d={d} />
    </svg>
  );
}
