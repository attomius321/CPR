import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../src/', import.meta.url);

/** Every file under src/, in its folders too, whose path matches: [path, text]. */
function sources(path: RegExp): [string, string][] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => path.test(file))
    .sort()
    .map((file) => [file, readFileSync(new URL(file, SRC), 'utf8')]);
}

// The look's colours (V29b): tokens on <html>, dark by default, light chosen or the system's.
// Every stylesheet is read: a rule in any of them is held to the guards below.
const css = sources(/\.css$/)
  .map(([, text]) => text)
  .join('\n');

/** The custom properties declared in the first block whose selector is `selector`. */
function tokens(selector: string): Map<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(at, css.indexOf('}', at));
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

/** What both themes share: the fonts. */
const base = tokens(':root');
// V82: light Hive's sidenav and Hive's dialog take the whole dark set, Hive's over it.
const dark = tokens(":root,\n:root[data-theme='dark'],\n:root[data-hive] .sidenav,\n.hive-ink");
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
// V42: the accent marks a link under the pointer and the current page's name: read as text.
const TEXT = ['--text', '--muted', '--accent'];
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
/** V74: the Activity tab's kinds of work, a colour each (decisions 528, 530). */
const PHASES = [
  '--phase-explore',
  '--phase-implement',
  '--phase-docs',
  '--phase-test',
  '--phase-visual',
  '--phase-debug',
  '--phase-git',
  // NU2: Nucleus's web and Symbiote's tools.
  '--phase-web',
  '--phase-symbiote',
];

/** V81 (decision 601): Settings' groups' tints, `section[data-tint=…] { --tint: var(…) }`. */
const SETTINGS_TINTS = Object.fromEntries(
  [...css.matchAll(/\[data-tint='([\w-]+)'\]\s*\{\s*--tint:\s*var\((--[\w-]+)\);/g)].map((m) => [
    m[1]!,
    m[2]!,
  ]),
);

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

/**
 * A wash token (`color-mix(in srgb, var(--x) n%, transparent)`) laid over `back`, as `#rrggbb`:
 * what a hovered or selected row shows.
 */
function washed(theme: Map<string, string>, token: string, back: string): string {
  const match = /var\((--[\w-]+)\) (\d+)%, transparent/.exec(theme.get(token) ?? '');
  if (!match) throw new Error(`${token} is not a wash: ${theme.get(token)}`);
  const [front, under] = [theme.get(match[1]!) ?? '', theme.get(back) ?? ''].map((hex) =>
    Number.parseInt(hex.slice(1), 16),
  ) as [number, number];
  const share = Number(match[2]) / 100;
  const channel = (shift: number) =>
    Math.round(((front >> shift) & 255) * share + ((under >> shift) & 255) * (1 - share));
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

/** `front` laid over `back` at `share` (0–1), as `#rrggbb`: `color-mix(in srgb, …)`. */
function mixed(front: string, share: number, back: string): string {
  const [f, b] = [front, back].map((hex) => Number.parseInt(hex.slice(1), 16)) as [number, number];
  const channel = (shift: number) =>
    Math.round(((f >> shift) & 255) * share + ((b >> shift) & 255) * (1 - share));
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

describe('the tokens (V29b)', () => {
  it('are the same names in both themes, and the system light is the light theme', () => {
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort());
    expect(systemLight).toEqual(light);
  });

  // V31: Symbiote's style (the symbiote-style skill's tokens.md): the content darkest, the chrome
  // lifted. V61: the person's mockup, near-black neutrals in place of V42's navy water.
  it('are the mockup’s near blacks in the dark theme, a step lighter for the chrome', () => {
    expect(Object.fromEntries(BACKGROUNDS.map((t) => [t, dark.get(t)]))).toEqual({
      '--bg': '#090b0e',
      '--side': '#0d1015',
      '--panel': '#0d1015',
      '--raised': '#171a21',
    });
    expect(dark.get('--text')).toBe('#edf0f5');
    expect(dark.get('--muted')).toBe('#a2abbc');
    expect(dark.get('--line')).toBe('#1f232c');
    // V54: the terminal's link hint's light, now every tip's in the dark theme.
    expect(dark.get('--tip-bg')).toBe('#e6e9ef');
    // The mockup's step from the content to the chrome: smaller than V31's 1.1, the cards' hairline
    // carries the edge.
    expect(contrast(dark.get('--bg')!, dark.get('--side')!)).toBeGreaterThanOrEqual(1.03);
  });

  it('are the koi’s in the light theme: a white page, cool chrome, navy text', () => {
    expect(Object.fromEntries(BACKGROUNDS.map((t) => [t, light.get(t)]))).toEqual({
      '--bg': '#ffffff',
      '--side': '#f6f8fc',
      '--panel': '#f6f8fc',
      '--raised': '#e9eef7',
    });
    expect(light.get('--text')).toBe('#0b1220');
    expect(light.get('--tip-bg')).toBe('#0b1220');
  });

  // V42 (decision 281): the moved kind and info in cyan. V61 (decisions 437, 440): the mockup's
  // violet for the primary and the accent in both themes; dark text on the dark theme's primary,
  // where white is 4.01:1.
  it('take the mockup’s violet for the primary and the accent, and cyan for moved and info', () => {
    const pick = (theme: Map<string, string>) =>
      Object.fromEntries(
        ['--primary', '--primary-text', '--accent', '--focus', '--moved', '--info'].map((t) => [
          t,
          theme.get(t),
        ]),
      );
    expect(pick(dark)).toEqual({
      '--primary': '#7c68fc',
      '--primary-text': '#0b0a1a',
      '--accent': '#9886ff',
      '--focus': '#9886ff',
      '--moved': '#3fc5d6',
      '--info': '#3fc5d6',
    });
    expect(pick(light)).toEqual({
      '--primary': '#5b3fd9',
      '--primary-text': '#ffffff',
      '--accent': '#5b3fd9',
      '--focus': '#5b3fd9',
      '--moved': '#0a7d8c',
      '--info': '#0a7d8c',
    });
  });

  // V74 (decisions 528, 530): a kind of work's colour keeps its hue in both themes, which
  // History's lanes 5 and 6 do not (tan and olive, lime and brown).
  it('give each kind of work on the Activity tab its colour, one hue in both themes', () => {
    const pick = (theme: Map<string, string>) =>
      Object.fromEntries([...PHASES, '--phase-wash'].map((t) => [t, theme.get(t)]));
    expect(pick(dark)).toEqual({
      '--phase-explore': '#40b0a6',
      '--phase-implement': '#6aa8ff',
      '--phase-docs': '#e0a548',
      '--phase-test': '#8ccf3e',
      '--phase-visual': '#ec6fae',
      '--phase-debug': '#f2815a',
      '--phase-git': '#c08cff',
      '--phase-web': '#d4c84a',
      '--phase-symbiote': '#dc7cf0',
      '--phase-wash': '16%',
    });
    expect(pick(light)).toEqual({
      '--phase-explore': '#0a7f6f',
      '--phase-implement': '#2f62cc',
      '--phase-docs': '#9a5b00',
      '--phase-test': '#4d7a00',
      '--phase-visual': '#bf3989',
      '--phase-debug': '#c2410c',
      '--phase-git': '#8a3fd1',
      '--phase-web': '#6f6a00',
      '--phase-symbiote': '#9c2fb8',
      '--phase-wash': '12%',
    });
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
      // V37: a text field's quiet edge at rest (decision 246) and the ring of a focused field.
      '--field-line',
      '--ring',
      // V42: the secondary colour, the koi's blue light (decision 280).
      '--accent',
    ]) {
      expect([name, dark.has(name), light.has(name)]).toEqual([name, true, true]);
    }
  });

  for (const [name, theme] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    describe(`${name}`, () => {
      // V37 (decision 250): at 8 and 10 % a hovered row looked like the current page. V42: the
      // hover a wash of the text, the selection one of the accent; on every chrome the selection
      // stands further from its ground than the hover.
      it('draws a hover lighter than the selection, which is a wash of the accent', () => {
        expect(theme.get('--hover')).toMatch(/var\(--text\) \d+%, transparent/);
        expect(theme.get('--selected')).toMatch(/var\(--accent\) \d+%, transparent/);
        const close = ['--bg', '--side'].flatMap((back) => {
          const ground = theme.get(back)!;
          const hover = contrast(washed(theme, '--hover', back), ground);
          const selected = contrast(washed(theme, '--selected', back), ground);
          return selected - hover < 0.05
            ? [`on ${back}: ${hover.toFixed(2)}, ${selected.toFixed(2)}`]
            : [];
        });
        expect(close).toEqual([]);
      });

      it('writes its text on the primary at 4.5:1 at least, under the pointer too', () => {
        expect(under(theme, ['--primary-text'], ['--primary', '--primary-hover'], 4.5)).toEqual([]);
      });

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

      // V74: a phase's icon on its tile, a wash of its colour over the timeline's ground.
      it('draws a kind of work at least 3:1 on every background and on its own tile', () => {
        expect(under(theme, PHASES, BACKGROUNDS, 3)).toEqual([]);
        const share = Number.parseFloat(theme.get('--phase-wash')!) / 100;
        const low = PHASES.flatMap((phase) => {
          const tile = mixed(theme.get(phase)!, share, theme.get('--bg')!);
          const ratio = contrast(theme.get(phase)!, tile);
          return ratio < 3 ? [`${phase} on its tile: ${ratio.toFixed(2)}`] : [];
        });
        expect(low).toEqual([]);
      });

      // V81 (decisions 601, 602): an entry's icon on its group's tile, a wash of the group's
      // colour over the list card's ground; the open entry's icon in the accent.
      it("draws Settings' icons at least 3:1 on their group's tile, the open one's accent too", () => {
        expect(SETTINGS_TINTS).toEqual({
          workspaces: '--phase-implement',
          reviews: '--phase-test',
          agents: '--phase-visual',
          machine: '--phase-docs',
          browser: '--phase-explore',
        });
        const share = Number.parseFloat(theme.get('--phase-wash')!) / 100;
        const low = Object.values(SETTINGS_TINTS).flatMap((tint) => {
          const tile = mixed(theme.get(tint)!, share, theme.get('--side')!);
          return [tint, '--accent'].flatMap((front) => {
            const ratio = contrast(theme.get(front)!, tile);
            return ratio < 3 ? [`${front} on ${tint}'s tile: ${ratio.toFixed(2)}`] : [];
          });
        });
        expect(low).toEqual([]);
      });

      // RM2 (decision 332): the Monitor's long files, yellow, orange, red; their lines are
      // written in the text colour, each step standing further from a file's usual fill.
      it("writes text at 4.5:1 on the Monitor's heat, each step further from the usual fill", () => {
        const HEAT = ['--heat-1', '--heat-2', '--heat-3'];
        expect(under(theme, ['--text'], HEAT, 4.5)).toEqual([]);
        const apart = HEAT.map((t) => contrast(theme.get(t)!, theme.get('--raised')!));
        expect(apart).toEqual([...apart].sort((a, b) => a - b));
      });

      // V54 (decision 398): the style's inverted tip, light in the dark theme and navy in the
      // light one; its state dots in the other theme's colours, which keep 3:1 on it.
      it('draws tooltips inverted: words and keys at 4.5:1, state dots at 3:1', () => {
        expect(contrast(theme.get('--tip-bg')!, theme.get('--bg')!)).toBeGreaterThan(10);
        expect(under(theme, ['--tip-text', '--tip-muted'], ['--tip-bg'], 4.5)).toEqual([]);
        expect(under(theme, ['--tip-key-text'], ['--tip-key'], 4.5)).toEqual([]);
        expect(
          under(theme, ['--tip-ok', '--tip-bad', '--tip-warn', '--tip-info'], ['--tip-bg'], 3),
        ).toEqual([]);
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
  // Colour is for state, and one accent (V42). Cyan is the moved kind and the states that share
  // its hue: an agent working, "since", the current lane (blue until V42, decision 281).
  const STATE_RULES =
    /tone-moved|minimap-moved|since|review-new|working|starting|merging|merge-tone-wait|lane-0/;

  it('uses --moved only for the moved kind and states', () => {
    const accent = rules
      .filter((rule) => rule.body.includes('var(--moved)') && !STATE_RULES.test(rule.selector))
      .map((rule) => rule.selector);
    expect(accent).toEqual([]);
  });

  // V42 (decision 280): one accent, the koi's blue, for what a person acts with: the current
  // page (its icon in its head too, V62), what is selected or checked (a picked kind's tab, V63),
  // focus, a link under the pointer, selected text; the start page's card icons (V63, the
  // person's mockup); a Skills pane's icon and the headings in a skill's text (V64, its mockup);
  // the kind of the workspace picked in History (V77), as an open workspace's in its head.
  // Never a state, a lane or a diff kind: those keep their colours.
  const ACCENT_ROLES =
    /aria-current|aria-selected|aria-pressed|aria-checked|\.selected|\.current|\.page-icon|\.start-card-icon|\.skills-tile|\.history-tile|\.md-heading|:checked|focus|::selection|\.link|a:hover/;

  it('uses --accent only for its roles', () => {
    const elsewhere = rules
      .filter((rule) => rule.body.includes('var(--accent)') && !ACCENT_ROLES.test(rule.selector))
      .filter((rule) => !rule.selector.startsWith(':root'))
      .map((rule) => rule.selector);
    expect(elsewhere).toEqual([]);
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
  // V29b's dense 13 px body, with 10–11 px captions, was too small to read: one step up (V32).
  // V61: still too small for the person's eyes, another pixel each; nothing under 13 px but
  // uppercase labels and one-glyph marks.
  it('is two steps above V29b’s, 15 px for the body', () => {
    expect(Object.fromEntries([...base].filter(([name]) => name.startsWith('--size-')))).toEqual({
      '--size-caps': '12px',
      '--size-caption': '13px',
      '--size-small': '14px',
      '--size-body': '15px',
      '--size-title': '17px',
    });
  });

  // V61 (decision 438): the graph keeps V32's sizes. A node's width is estimated from its
  // characters (flow.ts's nodeWidth, 9.4 px a character at 13 px), so a bigger font would cut its
  // labels or move every layout; the graph zooms instead.
  it("keeps V32's sizes on the graph", () => {
    const blocks = [...css.matchAll(/(?:^|\n)\.react-flow \{([^}]*)\}/g)];
    const scale = blocks.flatMap((block) =>
      [...block[1]!.matchAll(/(--size-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
    );
    expect(Object.fromEntries(scale)).toEqual({
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
  const files = sources(/\.(css|tsx?)$/);

  it('are the bundled pair, for text and for code', () => {
    // monospace after Geist, not sans-serif: Chromium on Linux matched sans-serif as a name, 283
    // ms a time; monospace in a millisecond, with the symbols Geist lacks.
    expect(base.get('--sans')).toBe("'Geist Variable', monospace");
    expect(base.get('--mono')).toBe("'Geist Mono Variable', monospace");
  });

  it('name no font a system may lack', () => {
    const named = files.filter(([, text]) => SYSTEM_NAMES.test(text ?? '')).map(([f]) => f);
    expect(named).toEqual([]);
  });

  it('put no sans-serif after Geist, anywhere', () => {
    const declared = /(font(-family)?|--sans):[^;{}]*sans-serif/;
    expect(files.filter(([, text]) => declared.test(text ?? '')).map(([f]) => f)).toEqual([]);
  });
});

// V82 (decisions 614, 615): Hive mode's ink and crimson, over each theme while it is on. Its blocks
// name only what changes; light Hive's sidenav and the Hive dialog take dark Hive's.
describe('Hive mode (V82)', () => {
  const hiveDark = tokens(
    ":root[data-hive]:not([data-theme='light']),\n:root[data-hive] .sidenav,\n.hive-ink",
  );
  const hiveLight = tokens(":root[data-hive][data-theme='light']");
  const hiveSystemLight = tokens("  :root[data-hive][data-theme='system']");
  const hive = {
    dark: new Map([...dark, ...hiveDark]),
    light: new Map([...light, ...hiveLight]),
  };

  it('names the same tokens in both themes, and the system light is its light', () => {
    expect([...hiveLight.keys()].sort()).toEqual([...hiveDark.keys()].sort());
    expect(hiveSystemLight).toEqual(hiveLight);
  });

  it('is ink with a breath of red, words near white, the primary crimson', () => {
    const pick = (theme: Map<string, string>) =>
      Object.fromEntries(
        [...BACKGROUNDS, '--text', '--accent', '--primary', '--primary-text'].map((t) => [
          t,
          theme.get(t),
        ]),
      );
    expect(pick(hive.dark)).toEqual({
      '--bg': '#070506',
      '--side': '#0d090a',
      '--panel': '#0d090a',
      '--raised': '#1b1214',
      '--text': '#f7f2f2',
      '--accent': '#ffc4cc',
      '--primary': '#c8102e',
      '--primary-text': '#ffffff',
    });
    expect(pick(hive.light)).toEqual({
      '--bg': '#ffffff',
      '--side': '#f7f4f4',
      '--panel': '#f7f4f4',
      '--raised': '#ece5e6',
      '--text': '#120a0c',
      '--accent': '#9b1230',
      '--primary': '#b0102b',
      '--primary-text': '#ffffff',
    });
  });

  it('keeps the states, lanes, kinds of work and type: only surfaces, words and accents change', () => {
    const kept = [...STATES, ...LANES, ...PHASES, '--phase-wash'].filter((t) => hiveDark.has(t));
    expect(kept).toEqual([]);
    expect([...hiveDark.keys()].filter((t) => t.startsWith('--size-'))).toEqual([]);
  });

  for (const [name, theme] of Object.entries(hive)) {
    describe(name, () => {
      it('gives text 4.5:1 on every background, and on the primary', () => {
        expect(under(theme, TEXT, BACKGROUNDS, 4.5)).toEqual([]);
        expect(under(theme, ['--primary-text'], ['--primary', '--primary-hover'], 4.5)).toEqual([]);
      });

      it("gives states, kinds of work, a control's edge and the focus ring 3:1", () => {
        expect(under(theme, [...STATES, ...PHASES, '--focus', '--faint'], BACKGROUNDS, 3)).toEqual(
          [],
        );
        expect(under(theme, ['--edge'], ['--bg', '--side', '--panel'], 3)).toEqual([]);
        expect(under(theme, LANES, ['--bg', '--raised'], 3)).toEqual([]);
      });

      it('separates regions with lines that show', () => {
        expect(under(theme, ['--line'], ['--bg', '--side', '--panel'], 1.2)).toEqual([]);
      });

      it('draws the selection, a crimson wash, further from its ground than the hover', () => {
        expect(theme.get('--selected')).toMatch(/var\(--hive-red\) \d+%, transparent/);
        const close = ['--bg', '--side'].flatMap((back) => {
          const ground = theme.get(back)!;
          const hover = contrast(washed(theme, '--hover', back), ground);
          const selected = contrast(washed(theme, '--selected', back), ground);
          return selected - hover < 0.05 ? [`on ${back}`] : [];
        });
        expect(close).toEqual([]);
      });

      // Settings' tiles one ink in Hive (the groups' five colours fight the crimson), Hive mode's
      // own in the error's red.
      it("draws Settings' icons 3:1 on their tiles: ink, Hive mode's red, the open one's", () => {
        const share = Number.parseFloat(theme.get('--phase-wash')!) / 100;
        const low = ['--muted', '--error'].flatMap((tint) => {
          const tile = mixed(theme.get(tint)!, share, theme.get('--side')!);
          return [tint, '--accent'].flatMap((front) => {
            const ratio = contrast(theme.get(front)!, tile);
            return ratio < 3 ? [`${front} on ${tint}'s tile: ${ratio.toFixed(2)}`] : [];
          });
        });
        expect(low).toEqual([]);
      });
    });
  }

  // Off, Hive mode's entry is the only red tile in the list.
  it("draws Hive mode's icon 3:1 on its red tile in both themes", () => {
    const low = Object.entries({ dark, light }).flatMap(([name, theme]) => {
      const share = Number.parseFloat(theme.get('--phase-wash')!) / 100;
      const tile = mixed(theme.get('--error')!, share, theme.get('--side')!);
      const ratio = contrast(theme.get('--error')!, tile);
      return ratio < 3 ? [`${name}: ${ratio.toFixed(2)}`] : [];
    });
    expect(low).toEqual([]);
  });
});
