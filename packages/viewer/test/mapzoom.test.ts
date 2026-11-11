import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUT_REST_MS,
  MAP_LABELS,
  MAP_ZOOM,
  NAME_PX,
  mapZoomStyle,
  nextMapZoom,
  pickView,
  readingZoom,
} from '../src/graph/mapzoom.js';
import { TEXT_SIZES } from '../src/shell/text-size.js';

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

/** A rule's declarations in a stylesheet, by its selector as written. */
function declared(file: string, selector: string, property: string): string | undefined {
  const css = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return undefined;
  const block = css.slice(at, css.indexOf('}', at));
  return new RegExp(`${property}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
}

describe('readingZoom (V99, decision 967)', () => {
  it("puts a graph's name at the person's body size: 14, 15 or 16 px for its 12", () => {
    expect(readingZoom('default')).toBe(1.25);
    expect(readingZoom('compact') * NAME_PX).toBeCloseTo(14, 9);
    expect(readingZoom('large') * NAME_PX).toBeCloseTo(16, 9);
    // Never closer than React Flow lets the person zoom (its 2), never on the map.
    for (const size of TEXT_SIZES) {
      expect(readingZoom(size)).toBeLessThan(2);
      expect(readingZoom(size)).toBeGreaterThan(MAP_ZOOM);
    }
  });

  it('reads the sizes the stylesheet draws', () => {
    // A name is the graph's caption, which keeps V32's 12 px inside `.react-flow` (decision 438).
    expect(declared('graph/SymbolNode.css', '.symbol-name', 'font')).toContain(
      'var(--size-caption)',
    );
    expect(declared('ui/base.css', '.react-flow', '--size-caption')).toBe(`${NAME_PX}px`);
    const body = {
      compact: declared('ui/base.css', ":root[data-text-size='compact']", '--size-body'),
      default: declared('ui/base.css', ':root', '--size-body'),
      large: declared('ui/base.css', ":root[data-text-size='large']", '--size-body'),
    };
    for (const size of TEXT_SIZES) {
      expect(`${Math.round(readingZoom(size) * NAME_PX)}px`, size).toBe(body[size]);
    }
  });
});

describe('pickView (V99, decision 966)', () => {
  it('brings a name drawn under 11 px to the reading zoom, in view or not', () => {
    // On the map, and between the map and 11 px: where V93 left a pick unreadable (5.9 px).
    for (const zoom of [0.3, 0.6, 0.9]) {
      expect(pickView(zoom, true), `${zoom}, shown`).toBe('zoom');
      expect(pickView(zoom, false), `${zoom}`).toBe('zoom');
    }
  });

  it("keeps a readable pick's framing (886): still in view, panned at its zoom out of view", () => {
    for (const zoom of [11 / NAME_PX, 1, 1.3]) {
      expect(pickView(zoom, true), `${zoom}, shown`).toBe('stay');
      expect(pickView(zoom, false), `${zoom}`).toBe('pan');
    }
  });
});

describe("the map's labels (V100, decision 970)", () => {
  it('scale the findings count with the names: every rule that reads the zoom aims at one', () => {
    const labels = MAP_LABELS.split(',').map((label) => label.trim());
    expect(labels).toContain('.map-count');
    const css = readFileSync(new URL('../src/graph/map.css', import.meta.url), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const readers = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, , body]) =>
      /--symbiote-(zoom|cut)/.test(body ?? ''),
    );
    expect(readers.length).toBeGreaterThan(0);
    for (const [, selectors = ''] of readers) {
      for (const selector of selectors.split(',').map((s) => s.trim())) {
        const element = selector.split(/\s+/).pop() ?? '';
        expect(
          labels.some((label) => element.startsWith(label)),
          selector,
        ).toBe(true);
      }
    }
  });
});
