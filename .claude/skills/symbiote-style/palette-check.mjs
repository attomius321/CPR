// Checks a palette against the contrast rules of packages/viewer/test/tokens.test.ts before
// the tokens (src/ui/base.css) are edited: text, muted and the accent 4.5:1 on the four backgrounds,
// states, faint and focus 3:1, a control's edge 3:1, History's lanes 3:1 on rows, region lines
// 1.2:1.
// Usage: node .claude/skills/symbiote-style/palette-check.mjs   (edit PALETTE below to try values)

const PALETTE = {
  dark: {
    '--bg': '#090b0e',
    '--side': '#0d1015',
    '--panel': '#0d1015',
    '--raised': '#171a21',
    '--line': '#1f232c',
    '--edge': '#5c6373',
    '--text': '#edf0f5',
    '--muted': '#a2abbc',
    '--accent': '#9886ff',
    '--faint': '#737a8a',
    '--focus': '#9886ff',
    '--added': '#81b88b',
    '--removed': '#c74e39',
    '--modified': '#e2c08d',
    '--moved': '#3fc5d6',
    '--context': '#737a8a',
    '--error': '#ff6568',
    '--warning': '#f5b32a',
    '--info': '#3fc5d6',
    '--lane-1': '#6aa8ff',
    '--lane-2': '#40b0a6',
    '--lane-3': '#ffb000',
    '--lane-4': '#dc267f',
    '--lane-5': '#ce9178',
    '--lane-6': '#8ccf3e',
  },
  light: {
    '--bg': '#ffffff',
    '--side': '#f6f8fc',
    '--panel': '#f6f8fc',
    '--raised': '#e9eef7',
    '--line': '#dce3ef',
    '--edge': '#7f8aa3',
    '--text': '#0b1220',
    '--muted': '#56627a',
    '--accent': '#5b3fd9',
    '--faint': '#78839c',
    '--focus': '#5b3fd9',
    '--added': '#587c0c',
    '--removed': '#ad0707',
    '--modified': '#895503',
    '--moved': '#0a7d8c',
    '--context': '#78839c',
    '--error': '#e40014',
    '--warning': '#9a6700',
    '--info': '#0a7d8c',
    '--lane-1': '#2f62cc',
    '--lane-2': '#0a7f6f',
    '--lane-3': '#bc4c00',
    '--lane-4': '#bf3989',
    '--lane-5': '#4d7a00',
    '--lane-6': '#9a6700',
  },
};

const BACKGROUNDS = ['--bg', '--side', '--panel', '--raised'];
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
const RULES = [
  [['--text', '--muted', '--accent'], BACKGROUNDS, 4.5],
  [[...STATES, '--focus', '--faint'], BACKGROUNDS, 3],
  [['--edge'], ['--bg', '--side', '--panel'], 3],
  [LANES, ['--bg', '--raised'], 3],
  [['--line'], ['--bg', '--side', '--panel'], 1.2],
];

/** WCAG 2's relative luminance of a `#rrggbb` colour. */
function luminance(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not #rrggbb: ${hex}`);
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

let failed = 0;
for (const [name, theme] of Object.entries(PALETTE)) {
  console.log(`== ${name}`);
  for (const [fronts, backs, min] of RULES) {
    for (const front of fronts) {
      const ratios = backs.map((back) => contrast(theme[front], theme[back]));
      const low = Math.min(...ratios);
      if (low < min) failed++;
      const each = backs.map((back, i) => `${back} ${ratios[i].toFixed(2)}`).join(', ');
      console.log(
        `${low < min ? 'FAIL' : 'ok  '} ${front.padEnd(10)} ${theme[front]}  lowest ${low.toFixed(2)} (min ${min}): ${each}`,
      );
    }
  }
}
process.exitCode = failed ? 1 : 0;
