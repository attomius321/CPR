// Hive's honeycomb behind the page while Hive is on (V85, decisions 701–707): the arrival's shutter
// kept, one SVG path drawn once and again only when the window's size changes, on the lattice the
// arrival laid (`layComb`) or, loaded with Hive on, centred on the window.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { combLattice, combRadius } from '../ui/hive-art.js';
import { combPath, layComb, laidComb, onComb, type CombOrigin } from './hive-comb.js';
import { useHive } from './hive.js';

const windowSize = () => ({ width: window.innerWidth, height: window.innerHeight });

/** The honeycomb, while Hive is on; nothing while it is off. */
export function HiveComb() {
  return useHive() ? <Comb /> : null;
}

function Comb() {
  const laid = useSyncExternalStore(onComb, laidComb);
  const [size, setSize] = useState(windowSize);
  // Without the arrival's, the window's middle as it is now: kept while the window is resized.
  const [own] = useState<CombOrigin>(() => ({
    x: size.width / 2,
    y: size.height / 2,
    r: combRadius(size.width, size.height),
  }));
  const origin = laid ?? own;

  useEffect(() => {
    const resize = () => setSize(windowSize());
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      // Off: the next time it turns on lays its own.
      layComb(null);
    };
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
