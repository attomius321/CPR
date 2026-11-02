import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUT_REST_MS, MAP_ZOOM, mapZoomStyle, nextMapZoom } from '../src/graph/mapzoom.js';

describe('nextMapZoom', () => {
  it('writes the zoom on the map, once per value', () => {
    expect(nextMapZoom(0.2, undefined)).toBe(0.2);
    expect(nextMapZoom(0.1, 0.2)).toBe(0.1);
    expect(nextMapZoom(0.1, 0.1)).toBeUndefined();
  });

  it('writes nothing off the map, where no label reads it', () => {
    expect(nextMapZoom(MAP_ZOOM, undefined)).toBeUndefined();
    expect(nextMapZoom(1.1, 0.3)).toBeUndefined();
    // Back on the map at another zoom: written again.
    expect(nextMapZoom(0.3, 0.2)).toBe(0.3);
  });
});

describe('mapZoomStyle', () => {
  // A one-rule stylesheet, as the browser's: the rule's properties are what the labels read.
  class Rule {
    readonly values = new Map<string, string>();
    readonly style = { setProperty: (name: string, value: string) => this.values.set(name, value) };
  }
  const page = () => {
    const rule = new Rule();
    const doc = {
      createElement: () => ({ textContent: '', sheet: { cssRules: [rule] }, remove: () => {} }),
      head: { append: () => {} },
    } as unknown as Document;
    return { rule, doc };
  };
  beforeEach(() => {
    vi.stubGlobal('CSSStyleRule', Rule);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('cuts the names to their boxes at the zoom once it rests, not on every frame (fix/hive-turn-end-flaky-tests-verdict)', () => {
    const { rule, doc } = page();
    const labels = mapZoomStyle(doc);
    // Onto the map: both at once.
    labels.update(0.3);
    expect(rule.values.get('--symbiote-zoom')).toBe('0.3');
    expect(rule.values.get('--symbiote-cut')).toBe('0.3');
    // A zoom under way: the scale follows each frame, the cut waits.
    labels.update(0.25);
    vi.advanceTimersByTime(CUT_REST_MS - 1);
    labels.update(0.2);
    expect(rule.values.get('--symbiote-zoom')).toBe('0.2');
    vi.advanceTimersByTime(CUT_REST_MS - 1);
    expect(rule.values.get('--symbiote-cut')).toBe('0.3');
    vi.advanceTimersByTime(1);
    expect(rule.values.get('--symbiote-cut')).toBe('0.2');
    // Gone with the canvas: nothing written after.
    labels.update(0.1);
    labels.remove();
    vi.advanceTimersByTime(CUT_REST_MS);
    expect(rule.values.get('--symbiote-cut')).toBe('0.2');
  });
});
