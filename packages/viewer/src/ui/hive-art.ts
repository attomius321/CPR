// Hive mode's drawing (V82, decisions 614, 615): glossy tendrils of our own, each a centreline of
// joined cubics thinned from its root to a point, a crimson edge and a white highlight beside it
// (`HiveArt.tsx` draws them, `hive.css` colours them). Pure: paths as SVG `d` strings.

export type Point = readonly [number, number];
export type Cubic = readonly [Point, Point, Point, Point];

/** A tendril: its centreline from the root, as wide as `width` there and `tip` at its end. */
export interface Tendril {
  path: readonly Cubic[];
  width: number;
  tip?: number;
}

const round = (n: number) => Math.round(n * 10) / 10;
const xy = ([x, y]: Point) => `${round(x)} ${round(y)}`;

/** A point on a cubic at `t`, and the unit normal there (the tangent turned a quarter). */
function at([p0, p1, p2, p3]: Cubic, t: number): { point: Point; normal: Point } {
  const u = 1 - t;
  const point: Point = [
    u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
  ];
  const dx =
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const dy =
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  const length = Math.hypot(dx, dy) || 1;
  return { point, normal: [-dy / length, dx / length] };
}

/** The centreline's points, `steps` a cubic, and how far along the whole line each is (0–1). */
function along(path: readonly Cubic[], steps: number) {
  const out: { point: Point; normal: Point }[] = [];
  path.forEach((cubic, i) => {
    const last = i === path.length - 1;
    for (let k = 0; k <= (last ? steps : steps - 1); k++) out.push(at(cubic, k / steps));
  });
  return out.map((p, i) => ({ ...p, t: i / (out.length - 1) }));
}

/** The tendril's outline: a closed shape, wide at the root, thinning to its tip. */
export function taper({ path, width, tip = 0.4 }: Tendril, steps = 24): string {
  const line = along(path, steps);
  const left: Point[] = [];
  const right: Point[] = [];
  for (const { point, normal, t } of line) {
    const half = (tip + (width - tip) * (1 - t) ** 1.3) / 2;
    left.push([point[0] + normal[0] * half, point[1] + normal[1] * half]);
    right.push([point[0] - normal[0] * half, point[1] - normal[1] * half]);
  }
  return `M${[...left, ...right.reverse()].map(xy).join(' L')} Z`;
}

/** The centreline itself, for a mask that draws the tendril in along it. */
export function centreline(path: readonly Cubic[]): string {
  const first = path[0]?.[0];
  if (!first) return '';
  return `M${xy(first)}${path.map(([, a, b, c]) => `C${xy(a)} ${xy(b)} ${xy(c)}`).join('')}`;
}

/**
 * A highlight beside the line from `from` to `to` of its length, `side` of its half width off
 * the centre (negative: the other side): light caught on a wet, rounded surface.
 */
export function highlight(
  { path, width }: Tendril,
  { side, from, to }: { side: number; from: number; to: number },
  steps = 24,
): string {
  const points = along(path, steps)
    .filter(({ t }) => t >= from && t <= to)
    .map(({ point, normal, t }): Point => {
      const off = side * (width / 2) * (1 - t);
      return [point[0] + normal[0] * off, point[1] + normal[1] * off];
    });
  return points.length > 1 ? `M${points.map(xy).join(' L')}` : '';
}

/** A hexagon, a point up, round (`cx`, `cy`) at `r`. */
export function hexagon(cx: number, cy: number, r: number): string {
  const corners = [-90, -30, 30, 90, 150, 210].map((a): Point => {
    const rad = (a * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  });
  return `M${corners.map(xy).join(' L')} Z`;
}

/** The sidenav's foot (a 300 × 420 box, its bottom on the sidenav's): tendrils rising, curling. */
export const SIDENAV_TENDRILS: readonly Tendril[] = [
  {
    width: 40,
    path: [
      [
        [40, 430],
        [30, 360],
        [90, 330],
        [80, 270],
      ],
      [
        [80, 270],
        [70, 210],
        [10, 200],
        [30, 140],
      ],
    ],
  },
  {
    width: 46,
    path: [
      [
        [150, 430],
        [160, 370],
        [120, 320],
        [150, 260],
      ],
      [
        [150, 260],
        [180, 200],
        [240, 230],
        [230, 170],
      ],
      [
        [230, 170],
        [222, 120],
        [180, 110],
        [190, 80],
      ],
    ],
  },
  {
    width: 30,
    path: [
      [
        [260, 430],
        [250, 380],
        [290, 350],
        [270, 300],
      ],
      [
        [270, 300],
        [250, 250],
        [200, 270],
        [205, 230],
      ],
    ],
  },
  {
    width: 18,
    path: [
      [
        [95, 430],
        [100, 400],
        [70, 380],
        [60, 350],
      ],
    ],
  },
  {
    width: 14,
    path: [
      [
        [210, 430],
        [205, 400],
        [225, 385],
        [230, 360],
      ],
    ],
  },
];

/** The two tendrils of a side that reach the hexagon, then a short one: mirrored for the right. */
const LEFT: readonly Tendril[] = [
  {
    width: 30,
    tip: 3,
    path: [
      [
        [-10, 30],
        [60, 10],
        [120, 70],
        [180, 50],
      ],
      [
        [180, 50],
        [205, 42],
        [215, 46],
        [234, 49],
      ],
    ],
  },
  {
    width: 30,
    tip: 3,
    path: [
      [
        [-10, 110],
        [70, 130],
        [110, 70],
        [170, 88],
      ],
      [
        [170, 88],
        [200, 96],
        [215, 90],
        [234, 79],
      ],
    ],
  },
  {
    width: 16,
    path: [
      [
        [-10, 70],
        [50, 60],
        [90, 90],
        [140, 72],
      ],
    ],
  },
];

const mirror = ({ path, ...rest }: Tendril): Tendril => ({
  ...rest,
  path: path.map((cubic) => cubic.map(([x, y]): Point => [520 - x, y]) as unknown as Cubic),
});

/**
 * The Hive dialog's head (a 520 × 128 box): tendrils from both edges meet at a hexagon round
 * (260, 64), which closes once they arrive.
 */
export const JOINING = {
  width: 520,
  height: 128,
  hexagon: { cx: 260, cy: 64, r: 30 },
  tendrils: [...LEFT, ...LEFT.map(mirror)],
} as const;
