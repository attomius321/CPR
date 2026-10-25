import type { Locator } from '@playwright/test';

/**
 * A dot's spinner (V53; a comet since fix/merging-status), as its `::after` draws it: its
 * animation, its size across, and whether it is a comet — a ring (its mask) whose tail fades in to
 * a round head (its conic and radial gradients). A still dot has no animation and no comet.
 */
export const spinner = (dot: Locator) =>
  dot.evaluate((element) => {
    const drawn = getComputedStyle(element, '::after');
    const across = ['width', 'borderLeftWidth', 'borderRightWidth'] as const;
    return {
      animation: `${drawn.animationName} ${drawn.animationDuration}`,
      across: across.reduce((sum, side) => sum + Number.parseFloat(drawn[side]), 0),
      comet:
        drawn.backgroundImage.includes('conic-gradient(') &&
        drawn.backgroundImage.includes('radial-gradient(') &&
        drawn.maskImage.startsWith('radial-gradient('),
    };
  });
