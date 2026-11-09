// The Overview's figures in words (V91). Pure.
import type { UsageWindow } from '@symbiote/core';
import { windowLabel } from '../shell/usage.js';

/** Dollars to the cent: "$11.66". */
export const dollars = (n: number) => `$${n.toFixed(2)}`;

/** A median time as a figure and its unit: "18" "min median", "2.4" "h median". */
export function medianFigure(ms: number | null): { value: string; unit?: string } {
  if (ms === null) return { value: '—' };
  const minutes = ms / 60_000;
  if (minutes < 1) return { value: '<1', unit: 'min median' };
  if (minutes < 60) return { value: `${Math.round(minutes)}`, unit: 'min median' };
  const hours = minutes / 60;
  return { value: hours < 10 ? hours.toFixed(1) : `${Math.round(hours)}`, unit: 'h median' };
}

/** A usage window's name as the cards say it: "5-hour window", "Week", "30 days". */
export function windowName(minutes: number): string {
  if (minutes === 300) return '5-hour window';
  if (minutes === 10_080) return 'Week';
  const label = windowLabel(minutes);
  return label.endsWith('d') ? `${label.slice(0, -1)} days` : label;
}

/** When a window starts again: its time within a day, else its day of the week ("Thursday"). */
export function resetsWords(window: Pick<UsageWindow, 'resetsAt'>, now: number): string | null {
  if (!window.resetsAt) return null;
  const at = new Date(window.resetsAt);
  const hours = (at.getTime() - now) / 3_600_000;
  if (hours <= 0) return 'has reset';
  if (hours < 24) {
    const two = (n: number) => String(n).padStart(2, '0');
    return `resets ${two(at.getHours())}:${two(at.getMinutes())}`;
  }
  return `resets ${at.toLocaleDateString('en-GB', { weekday: 'long' })}`;
}
