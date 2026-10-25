// The sidenav's cards moving to their new place (V48): a card whose workspace changed group, or
// that moved because one above it came or went, slides there from where it was (FLIP); a new card
// fades in. After each render, from each card's place in the list; nothing under reduced motion.
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { moves } from './transitions.js';

const CARD = '.workspace-row[data-branch]';
const MOVE = { duration: 200, easing: 'ease-out' };

export function useCardMoves(list: RefObject<HTMLElement | null>): void {
  const last = useRef<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const box = list.current;
    if (!box) return;
    // Places in the list (it is positioned): untouched by its scroll, and by a move under way.
    const now = new Map<string, number>();
    for (const card of box.querySelectorAll<HTMLElement>(CARD)) {
      if (card.dataset.branch) now.set(card.dataset.branch, card.offsetTop);
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) {
      for (const move of moves(last.current, now)) {
        const card = box.querySelector(`${CARD}[data-branch="${CSS.escape(move.key)}"]`);
        if (!card) continue;
        if ('enter' in move) {
          card.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1 }], MOVE);
        } else {
          card.animate([{ transform: `translateY(${move.dy}px)` }, { transform: 'none' }], MOVE);
        }
      }
    }
    last.current = now;
  });
}
