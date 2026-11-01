import { useEffect, useState } from 'react';
import { NAME_MS, scrambled } from './alpha-ceph.js';

/**
 * Nucleus's name changing over in the sidenav as it becomes Alpha Ceph (V86, decision 733): the
 * letters scramble and lock into `to` from the left, about 25 times a second for `NAME_MS`, then
 * stop. The link's `aria-label` and tooltip say `to` throughout.
 */
export function BecomingName({ from, to }: { from: string; to: string }) {
  const [word, setWord] = useState(from);
  useEffect(() => {
    const start = performance.now();
    const tick = setInterval(() => {
      const ms = performance.now() - start;
      setWord(scrambled(from, to, ms));
      if (ms >= NAME_MS) clearInterval(tick);
    }, 40);
    return () => clearInterval(tick);
  }, [from, to]);
  return <>{word}</>;
}
