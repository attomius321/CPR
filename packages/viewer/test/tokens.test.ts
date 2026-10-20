import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The look's colours (V29b): tokens on <html>, dark by default, light chosen or the system's.
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** The custom properties declared in the first block whose selector is `selector`. */
function tokens(selector: string): Map<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(at, css.indexOf('}', at));
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

/** What both themes share: the fonts. */
const base = tokens(':root');
const dark = tokens(":root,\n:root[data-theme='dark']");
const light = tokens(":root[data-theme='light']");
const systemLight = tokens("  :root[data-theme='system']");

/** WCAG 2's relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not #rrggbb: ${hex}`);
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2's contrast ratio of two colours. */
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

const BACKGROUNDS = ['--bg', '--side', '--panel', '--raised'];
const TEXT = ['--text', '--muted'];
const STATES = [
  '--added',
  '--removed',
  '--modified',
  '--moved',
  '--context',
  '--error',
  '--warning',
  '--info',
];
const LANES = ['--lane-1', '--lane-2', '--lane-3', '--lane-4', '--lane-5', '--lane-6'];

/** Each pair of `fronts` on `backs` under `min`, as "front on back: ratio". */
function under(theme: Map<string, string>, fronts: string[], backs: string[], min: number) {
  const low: string[] = [];
  for (const front of fronts) {
    for (const back of backs) {
      const ratio = contrast(theme.get(front) ?? '', theme.get(back) ?? '');
      if (ratio < min) low.push(`${front} on ${back}: ${ratio.toFixed(2)}`);
    }
  }
  return low;
}

describe('the tokens (V29b)', () => {
  it('are the same names in both themes, and the system light is the light theme', () => {
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort());
    expect(systemLight).toEqual(light);
  });

  it('are the reference’s in the dark theme', () => {
    expect(Object.fromEntries(BACKGROUNDS.map((t) => [t, dark.get(t)]))).toEqual({
      '--bg': '#0b0b0c',
      '--side': '#111113',
      '--panel': '#161618',
      '--raised': '#1f1f23',
    });
    expect(dark.get('--text')).toBe('#e6e6e9');
    expect(dark.get('--line')).toBe('#26262b');
  });

  for (const [name, theme] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    describe(`${name}`, () => {
      it('gives text at least 4.5:1 on every background', () => {
        expect(under(theme, TEXT, BACKGROUNDS, 4.5)).toEqual([]);
      });

      it("gives states, a control's edge and the focus ring at least 3:1", () => {
        expect(under(theme, [...STATES, '--focus', '--faint'], BACKGROUNDS, 3)).toEqual([]);
        expect(under(theme, ['--edge'], ['--bg', '--side', '--panel'], 3)).toEqual([]);
      });

      it("draws History's lanes at least 3:1 on its rows", () => {
        expect(under(theme, LANES, ['--bg', '--raised'], 3)).toEqual([]);
      });

      it('separates regions with lines that show', () => {
        expect(under(theme, ['--line'], ['--bg', '--side', '--panel'], 1.2)).toEqual([]);
      });
    });
  }
});

describe('the fonts (V29b, decision 180)', () => {
  // Every family a system lacks is a font-matching miss: on Linux they held History's first rows
  // for 850–900 ms (V29a). Only the bundled families and generic ones are named.
  const SYSTEM_NAMES =
    /system-ui|-apple-system|Segoe UI|ui-monospace|SFMono|Menlo|Consolas|Helvetica|Arial|Roboto/;
  const sources = readdirSync(new URL('../src/', import.meta.url))
    .filter((file) => /\.(css|tsx?)$/.test(file))
    .map((file) => [file, readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')]);

  it('are the bundled pair, for text and for code', () => {
    expect(base.get('--sans')).toBe("'Geist Variable', sans-serif");
    expect(base.get('--mono')).toBe("'Geist Mono Variable', monospace");
  });

  it('name no font a system may lack', () => {
    const named = sources.filter(([, text]) => SYSTEM_NAMES.test(text ?? '')).map(([f]) => f);
    expect(named).toEqual([]);
  });
});
