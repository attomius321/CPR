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

  // V31: Symbiote's style (the symbiote-style skill's tokens.md): the content darkest, the chrome
  // lifted.
  it('are the style’s in the dark theme', () => {
    expect(Object.fromEntries(BACKGROUNDS.map((t) => [t, dark.get(t)]))).toEqual({
      '--bg': '#0a0a0a',
      '--side': '#171717',
      '--panel': '#171717',
      '--raised': '#262626',
    });
    expect(dark.get('--text')).toBe('#fafafa');
    expect(dark.get('--muted')).toBe('#a1a1a1');
    expect(dark.get('--line')).toBe('#2a2a2a');
  });

  it('are the style’s in the light theme: a white page, grey chrome', () => {
    expect(Object.fromEntries(BACKGROUNDS.map((t) => [t, light.get(t)]))).toEqual({
      '--bg': '#ffffff',
      '--side': '#fafafa',
      '--panel': '#fafafa',
      '--raised': '#f0f0f0',
    });
    expect(light.get('--text')).toBe('#0a0a0a');
  });

  it('name the neutral states every control shares, in both themes', () => {
    for (const name of [
      '--hover',
      '--selected',
      '--selected-line',
      '--primary',
      '--primary-text',
      '--input-bg',
      '--shadow-lift',
      '--shadow-floating',
    ]) {
      expect([name, dark.has(name), light.has(name)]).toEqual([name, true, true]);
    }
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

/** Every innermost rule of the stylesheet (inside @media too): its selector and its body. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
  body: m[2]!,
}));

describe('colour is for state (V31, decision 214)', () => {
  // Colour is for state; selection, links and pressed controls are neutral. Blue is the
  // moved kind and the states that share its hue: an agent working, "since", the current lane.
  const STATE_RULES =
    /tone-moved|minimap-moved|since|review-new|working|merging|merge-tone-wait|lane-0/;

  it('uses --moved only for the moved kind and states', () => {
    const accent = rules
      .filter((rule) => rule.body.includes('var(--moved)') && !STATE_RULES.test(rule.selector))
      .map((rule) => rule.selector);
    expect(accent).toEqual([]);
  });

  it('marks no row with a coloured side bar (a blockquote keeps its line)', () => {
    const bars = rules
      .filter((rule) =>
        /border-left:\s*[2-4]px solid(?! var\(--line\))|inset [2-4]px 0 0/.test(rule.body),
      )
      .map((rule) => rule.selector);
    expect(bars).toEqual([]);
  });

  it('draws its checkboxes: no browser accent colour', () => {
    expect(
      rules.filter((rule) => rule.body.includes('accent-color')).map((r) => r.selector),
    ).toEqual([]);
  });
});

describe('the geometry is the style’s (V31c)', () => {
  // The radii: 4 px chips and keys, 8 px controls and rows, 10 px dialogs and popovers, 11 px
  // menus, 14 px cards, round badges and dots; `inherit` takes its parent's.
  const SCALE = new Set(['0', '4px', '8px', '10px', '11px', '14px', '9999px', '50%', 'inherit']);

  it('rounds every corner on its scale', () => {
    const off = rules.flatMap((rule) =>
      [...rule.body.matchAll(/border-radius:\s*([^;]+);/g)]
        .filter((m) =>
          m[1]!
            .trim()
            .split(/\s+/)
            .some((r) => !SCALE.has(r)),
        )
        .map((m) => `${rule.selector.split('\n')[0]}: ${m[1]}`),
    );
    expect(off).toEqual([]);
  });
});

describe('the type scale (V32)', () => {
  // V29b's dense 13 px body, with 10–11 px captions, was too small to read: one step up, and
  // nothing under 12 px but uppercase labels and one-glyph marks; titles stay at 16 px.
  it('is one step above V29b’s, 14 px for the body', () => {
    expect(Object.fromEntries([...base].filter(([name]) => name.startsWith('--size-')))).toEqual({
      '--size-caps': '11px',
      '--size-caption': '12px',
      '--size-small': '13px',
      '--size-body': '14px',
      '--size-title': '16px',
    });
  });

  it('sizes every text from the scale', () => {
    // A token, a multiple of one (calc), the parent's (inherit) or relative to it (em).
    const SIZE = /^(inherit|[\d.]+em|var\(--size-[a-z]+\)|calc\([^;]*var\(--size-[a-z]+\)[^;]*\))$/;
    // In the shorthand, a size in px is the one before a line height or a family.
    const RAW = /(^|\s)[\d.]+px(?=\s*\/|\s+[\w'"])/;
    const off = rules.flatMap((rule) => [
      ...[...rule.body.matchAll(/font-size:\s*([^;]+);/g)]
        .filter((m) => !SIZE.test(m[1]!.trim()))
        .map((m) => `${rule.selector.split('\n')[0]}: ${m[1]}`),
      ...[...rule.body.matchAll(/(?:^|[\s;])font:\s*([^;]+);/g)]
        .filter((m) => m[1]!.trim() !== 'inherit' && RAW.test(m[1]!.replace(/\s+/g, ' ').trim()))
        .map((m) => `${rule.selector.split('\n')[0]}: font: ${m[1]}`),
    ]);
    expect(off).toEqual([]);
  });

  it('names only sizes it has', () => {
    const used = new Set([...css.matchAll(/var\((--size-[a-z]+)\)/g)].map((m) => m[1]!));
    expect([...used].filter((name) => !base.has(name))).toEqual([]);
  });
});

describe('the fonts (V29b, decision 180)', () => {
  // Every family a system lacks is a font-matching miss: on Linux they held History's first rows
  // for 850–900 ms (V29a). Only the bundled families are named, and monospace after them.
  const SYSTEM_NAMES =
    /system-ui|-apple-system|Segoe UI|ui-monospace|SFMono|Menlo|Consolas|Helvetica|Arial|Roboto/;
  const sources = readdirSync(new URL('../src/', import.meta.url))
    .filter((file) => /\.(css|tsx?)$/.test(file))
    .map((file) => [file, readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')]);

  it('are the bundled pair, for text and for code', () => {
    // monospace after Geist, not sans-serif: Chromium on Linux matched sans-serif as a name, 283
    // ms a time; monospace in a millisecond, with the symbols Geist lacks.
    expect(base.get('--sans')).toBe("'Geist Variable', monospace");
    expect(base.get('--mono')).toBe("'Geist Mono Variable', monospace");
  });

  it('name no font a system may lack', () => {
    const named = sources.filter(([, text]) => SYSTEM_NAMES.test(text ?? '')).map(([f]) => f);
    expect(named).toEqual([]);
  });

  it('put no sans-serif after Geist, anywhere', () => {
    const declared = /(font(-family)?|--sans):[^;{}]*sans-serif/;
    expect(sources.filter(([, text]) => declared.test(text ?? '')).map(([f]) => f)).toEqual([]);
  });
});
