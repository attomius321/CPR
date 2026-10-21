// Checks a palette against the contrast rules of packages/viewer/test/tokens.test.ts before
// styles.css is edited: text and muted 4.5:1 on the four backgrounds, states, faint and focus
// 3:1, a control's edge 3:1, History's lanes 3:1 on rows, region lines 1.2:1.
// Usage: node .claude/skills/orca-theme/palette-check.mjs   (edit PALETTE below to try values)

const PALETTE = {
  dark: {
    '--bg': '#0a0a0a',
    '--side': '#171717',
    '--panel': '#171717',
    '--raised': '#262626',
    '--line': '#2a2a2a',
    '--edge': '#737373',
    '--text': '#fafafa',
    '--muted': '#a1a1a1',
    '--faint': '#7c7c7c',
    '--focus': '#a1a1a1',
    '--added': '#81b88b',
    '--removed': '#c74e39',
    '--modified': '#e2c08d',
    '--moved': '#4493f8',
    '--context': '#7c7c7c',
    '--error': '#ff6568',
    '--warning': '#eab308',
    '--info': '#4493f8',
    '--lane-1': '#b66dff',
    '--lane-2': '#40b0a6',
    '--lane-3': '#ffb000',
    '--lane-4': '#dc267f',
    '--lane-5': '#ce9178',
    '--lane-6': '#8ccf3e',
  },
  light: {
    '--bg': '#ffffff',
    '--side': '#fafafa',
    '--panel': '#fafafa',
    '--raised': '#f0f0f0',
    '--line': '#e5e5e5',
    '--edge': '#8a8a8a',
    '--text': '#0a0a0a',
    '--muted': '#666666',
    '--faint': '#8a8a8a',
    '--focus': '#737373',
    '--added': '#587c0c',
    '--removed': '#ad0707',
    '--modified': '#895503',
    '--moved': '#0969da',
    '--context': '#8a8a8a',
    '--error': '#e40014',
    '--warning': '#9a6700',
    '--info': '#0969da',
    '--lane-1': '#8250df',
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
  [['--text', '--muted'], BACKGROUNDS, 4.5],
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
