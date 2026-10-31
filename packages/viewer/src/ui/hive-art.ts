// Hive mode's art (V82; decisions 632, 665–666): a machined Hive Mind, the question's circuit
// board whose traces route into it, and turning on as that Mind and a blackout. Pure: the
// question's every state is a function of the time since it opened; the arrival is stepped.
// `hive-draw.ts` draws them on a canvas, `HiveArt.tsx` and `shell/hive-arrival.ts` run them.

export type Point = readonly [number, number];

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const SQ3 = Math.sqrt(3);

/** 0 below `a`, 1 above `b`, smooth between. */
export function smooth(a: number, b: number, x: number): number {
  if (b <= a) return x >= a ? 1 : 0;
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Slow, then fast, then slow: 0 to 1 over [0, 1]. */
export function easeInOut(x: number): number {
  const t = clamp(x, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** A number in [0, 1) for an integer and a seed. */
export function hash(i: number, seed: number): number {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul((seed | 0) + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]: the same `x` and `seed` give the same value. */
export function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hash(i, seed);
  return (a + (hash(i + 1, seed) - a) * u) * 2 - 1;
}

/** A damped spring toward `to`: under-damped (`z` < 1), it overshoots and settles. */
export class Spring {
  x: number;
  v = 0;
  to: number;
  w: number;
  z: number;
  constructor(x: number, w: number, z: number) {
    this.x = x;
    this.to = x;
    this.w = w;
    this.z = z;
  }
  step(dt: number): void {
    this.v += (this.w * this.w * (this.to - this.x) - 2 * this.z * this.w * this.v) * dt;
    this.x += this.v * dt;
  }
}

/** Departures on a seeded timetable: one in each `gap` from `from`, at a seeded place in it. */
export interface Timetable {
  /** When the `k`-th leaves (from 0). */
  at(k: number): number;
  /** Every departure in [a, b], earliest first. */
  between(a: number, b: number): number[];
}

/** A timetable with no end: an hour on is as cheap to read as a second. */
export function timetable(seed: number, from: number, gap: number): Timetable {
  // Each in the middle 70 % of its slot: never two at once, never more than 1.7 gaps apart.
  const at = (k: number) => from + (k + 0.15 + 0.7 * hash(k, seed)) * gap;
  return {
    at,
    between(a, b) {
      const out: number[] = [];
      for (let k = Math.max(0, Math.floor((a - from) / gap) - 1); ; k++) {
        const t = at(k);
        if (t > b) return out;
        if (t >= a) out.push(t);
      }
    },
  };
}

// ---------- the Hive Mind ----------

/** A signal's step from a cell to the next one in, in seconds. */
export const HOP = 0.075;
/** How long a cell glows after a signal, in seconds. */
const GLOW_FOR = 1.6;
/** A cell switching on: a fluorescent stutter, then on. */
const FLICKER = [1, 0.15, 0.9, 0, 0.55, 1, 0.35, 1];

export interface MindCell {
  /** Its axial place (a point up). */
  readonly q: number;
  readonly r: number;
  /** 0 the core, 1 round it, 2 the outer ring. */
  readonly ring: number;
  readonly x: number;
  readonly y: number;
  /** When it switches on, and how long its flicker lasts. */
  boot: number;
  flicker: number;
}

/** Signals reaching a cell: how strongly, and when they arrive between `a` and `b`. */
export interface Feed {
  readonly cell: number;
  readonly strength: number;
  arrivals(a: number, b: number): number[];
}

/**
 * The Hive Mind (decision 666): 19 machined cells in a honeycomb round a core. Each switches on at
 * its moment; a signal reaching a cell lights it, then each cell in to the core, `HOP` apart.
 */
export class Mind {
  readonly cx: number;
  readonly cy: number;
  /** A cell's circumradius. */
  readonly r: number;
  readonly cells: MindCell[] = [];
  /** The core's index. */
  readonly core: number;
  /** When it wakes, from and to: the chambers' glow at rest, from none to full. */
  wake: readonly [number, number] = [-2, -1];
  private readonly feeds: { feed: Feed; path: number[] }[] = [];
  constructor(cx: number, cy: number, r = 11) {
    this.cx = cx;
    this.cy = cy;
    this.r = r;
    for (let q = -2; q <= 2; q++) {
      for (let s = -2; s <= 2; s++) {
        if (Math.abs(q + s) > 2) continue;
        this.cells.push({
          q,
          r: s,
          ring: Math.max(Math.abs(q), Math.abs(s), Math.abs(q + s)),
          x: cx + r * SQ3 * (q + s / 2),
          y: cy + r * 1.5 * s,
          boot: -Infinity,
          flicker: 0.22,
        });
      }
    }
    this.core = this.cellAt(0, 0);
  }
  /** How far its outermost cell's wall is from its centre. */
  get reach(): number {
    return Math.max(...this.cells.map((c) => Math.hypot(c.x - this.cx, c.y - this.cy))) + this.r;
  }
  cellAt(q: number, r: number): number {
    return this.cells.findIndex((c) => c.q === q && c.r === r);
  }
  /** The cells from `from` to the core, each a neighbour one ring in (nearer the middle row). */
  pathToCore(from: number): number[] {
    const path = [from];
    let at = this.cells[from];
    while (at && at.ring > 0) {
      const here = at;
      const next = this.cells
        .map((cell, i) => ({ cell, i }))
        .filter(
          ({ cell }) =>
            cell.ring === here.ring - 1 &&
            Math.hypot(cell.x - here.x, cell.y - here.y) < this.r * SQ3 * 1.05,
        )
        .sort(
          (a, b) => Math.abs(a.cell.y - this.cy) - Math.abs(b.cell.y - this.cy) || a.i - b.i,
        )[0];
      if (!next) break;
      path.push(next.i);
      at = next.cell;
    }
    return path;
  }
  /** Signals from now on: each lights its cell, then the cells in to the core. */
  feed(feed: Feed): void {
    this.feeds.push({ feed, path: this.pathToCore(feed.cell) });
  }
  /** How lit cell `i` is at `t` by the signals that reached it: 0 when none, about 1 at one's peak. */
  energy(i: number, t: number): number {
    let e = 0;
    for (const { feed, path } of this.feeds) {
      const depth = path.indexOf(i);
      if (depth < 0) continue;
      const delay = depth * HOP;
      const strength = feed.strength * 0.8 ** depth;
      for (const at of feed.arrivals(t - delay - GLOW_FOR, t - delay)) {
        e += strength * Math.exp(-(t - at - delay) * 4.2);
      }
    }
    return e;
  }
  /** Whether cell `i` is on at `t`: 0 before it boots, a flicker, then 1. */
  on(i: number, t: number): number {
    const cell = this.cells[i];
    if (!cell) return 0;
    const u = t - cell.boot;
    if (u <= 0) return 0;
    if (u >= cell.flicker) return 1;
    return FLICKER[Math.floor((u / cell.flicker) * FLICKER.length)] ?? 1;
  }
  /** How awake it is at `t`, 0–1: its chambers' glow at rest. */
  awake(t: number): number {
    return smooth(this.wake[0], this.wake[1], t);
  }
  /** The core's light at `t`: a slow breath, uneven, kicked by the signals that reach it. */
  breath(t: number): number {
    return (
      0.5 +
      0.18 * Math.sin(t * 2.3) +
      0.1 * Math.sin(t * 5.1 + 1) +
      0.45 * this.energy(this.core, t)
    );
  }
}

// ---------- the question: a circuit board ----------

/** How long the question's join takes: drawn at 60 frames a second until then, 30 after. */
export const JOIN_SECONDS = 2;
/** The moment its still frame shows, with reduced motion: joined and settled. */
export const STILL_AT = 3;
/** A packet's lit tail, in px. */
export const TAIL = 18;
/** When packets start running in, and orders out. */
const PACKETS_FROM = 1.8;
const ORDERS_FROM = 3;

/** A line on the board: its corners, the arc length at each, and when it is drawn in. */
export interface Line {
  readonly points: readonly Point[];
  readonly arcs: readonly number[];
  readonly length: number;
  readonly start: number;
  /** When it is whole: a trace lands on its cell then. */
  readonly landed: number;
}

/** A trace from the board's edge to a cell of the Mind, and the signals it carries. */
export interface Trace extends Line {
  readonly side: -1 | 1;
  readonly cell: number;
  /** Packets in to the Mind and orders out from it, by when each leaves. */
  readonly packets: Timetable;
  readonly orders: Timetable;
  /** A packet's speed in px a second (orders go at 0.8 of it). */
  readonly speed: number;
}

export interface QuestionScene {
  readonly width: number;
  readonly height: number;
  readonly mind: Mind;
  readonly traces: readonly Trace[];
  /** Thin lines that end in a via, between the traces. */
  readonly stubs: readonly Line[];
  /** The honeycomb etched into the board: its cells' centres and their radius. */
  readonly etch: { readonly centres: readonly Point[]; readonly r: number };
  /** The targeting ring's radius round the Mind. */
  readonly ring: number;
  /** How much of `line` is drawn at `t`, 0–1. */
  drawn(line: Line, t: number): number;
  /** The packets on `trace` at `t`: their heads' arc lengths from its edge. */
  packets(trace: Trace, t: number): number[];
  /** The orders on `trace` at `t`, running out: their heads' arc lengths from its edge. */
  orders(trace: Trace, t: number): number[];
}

/**
 * The traces' corners, the edge first, to the Mind's outer cells (axial places) on each side; each
 * ends at its cell's port. Every run is at 0° or 45°.
 */
const ROUTES: readonly { side: -1 | 1; cell: Point; route: Point[] }[] = [
  {
    side: -1,
    cell: [0, -2],
    route: [
      [-4, 6],
      [60, 6],
      [74, 20],
      [176, 20],
      [187, 31],
    ],
  },
  {
    side: -1,
    cell: [-1, -1],
    route: [
      [-4, 36],
      [120, 36],
      [131.5, 47.5],
    ],
  },
  {
    side: -1,
    cell: [-2, 0],
    route: [
      [-4, 58],
      [40, 58],
      [46, 64],
    ],
  },
  {
    side: -1,
    cell: [-2, 1],
    route: [
      [-4, 92],
      [120, 92],
      [131.5, 80.5],
    ],
  },
  {
    side: -1,
    cell: [-2, 2],
    route: [
      [-4, 122],
      [60, 122],
      [74, 108],
      [176, 108],
      [187, 97],
    ],
  },
  {
    side: 1,
    cell: [2, -2],
    route: [
      [524, 10],
      [452, 10],
      [431, 31],
    ],
  },
  {
    side: 1,
    cell: [2, -1],
    route: [
      [524, 40],
      [380, 40],
      [372.5, 47.5],
    ],
  },
  {
    side: 1,
    cell: [2, 0],
    route: [
      [524, 68],
      [470, 68],
      [466, 64],
    ],
  },
  {
    side: 1,
    cell: [1, 1],
    route: [
      [524, 96],
      [400, 96],
      [384.5, 80.5],
    ],
  },
  {
    side: 1,
    cell: [0, 2],
    route: [
      [524, 118],
      [452, 118],
      [431, 97],
    ],
  },
];

const STUBS: readonly Point[][] = [
  [
    [-4, 14],
    [40, 14],
  ],
  [
    [-4, 48],
    [76, 48],
  ],
  [
    [-4, 78],
    [54, 78],
    [62, 70],
    [96, 70],
  ],
  [
    [-4, 112],
    [36, 112],
  ],
  [
    [150, 64],
    [160, 74],
    [192, 74],
  ],
  [
    [524, 24],
    [470, 24],
  ],
  [
    [524, 54],
    [430, 54],
  ],
  [
    [524, 82],
    [486, 82],
  ],
  [
    [524, 108],
    [470, 108],
  ],
  [
    [360, 64],
    [350, 54],
    [328, 54],
  ],
];

/** The arc length at each of `points`. */
function arcsOf(points: readonly Point[]): number[] {
  const arcs = [0];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    arcs.push(arcs[i - 1]! + Math.hypot(x1 - x0, y1 - y0));
  }
  return arcs;
}

/** The point at arc length `s` along a line and its direction: [x, y, dx, dy]. */
export function pointAt(
  points: readonly Point[],
  arcs: readonly number[],
  s: number,
): [number, number, number, number] {
  const length = arcs.at(-1) ?? 0;
  const at = clamp(s, 0, length);
  let i = 1;
  while (i < points.length - 1 && arcs[i]! < at) i++;
  const [x0, y0] = points[i - 1] ?? [0, 0];
  const [x1, y1] = points[i] ?? [x0, y0];
  const span = arcs[i]! - arcs[i - 1]! || 1;
  const f = (at - arcs[i - 1]!) / span;
  const d = Math.hypot(x1 - x0, y1 - y0) || 1;
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, (x1 - x0) / d, (y1 - y0) / d];
}

/**
 * The question's head (a 520 × 128 box, decision 665): a circuit board whose ten traces route in
 * from both edges and land on the Hive Mind's outer cells, which boot round the core; then packets
 * run in and orders run out while it is open.
 */
export function questionScene(): QuestionScene {
  const width = 520;
  const height = 128;
  const mind = new Mind(260, 64);
  mind.wake = [0.6, 1.5];
  for (const [i, cell] of mind.cells.entries()) {
    if (i === mind.core) {
      cell.boot = 0.08;
      cell.flicker = 0.3;
    } else cell.boot = 0.85 + cell.ring * 0.08 + hash(i, 4) * 0.25;
  }
  // Drawn in from the edges in turn, left and right alternating.
  const order = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9];
  const traces = ROUTES.map(({ side, cell: [q, r], route }, k): Trace => {
    const cell = mind.cellAt(q, r);
    const c = mind.cells[cell]!;
    const points: Point[] = [...route, [c.x + (side * mind.r * SQ3) / 2, c.y]];
    const arcs = arcsOf(points);
    const length = arcs.at(-1)!;
    const start = 0.12 + order.indexOf(k) * 0.075;
    const seed = 11 + k * 7;
    return {
      points,
      arcs,
      length,
      start,
      landed: start + 0.62 + 0.0011 * length,
      side,
      cell,
      packets: timetable(seed, PACKETS_FROM, 2.2),
      orders: timetable(seed + 3, ORDERS_FROM, 6.5),
      speed: 230,
    };
  });
  for (const trace of traces) {
    const { landed, packets, length, speed } = trace;
    const travel = length / speed;
    mind.feed({
      cell: trace.cell,
      strength: 1.1,
      arrivals: (a, b) => (a <= landed && landed <= b ? [landed] : []),
    });
    mind.feed({
      cell: trace.cell,
      strength: 0.85,
      arrivals: (a, b) => packets.between(a - travel, b - travel).map((t) => t + travel),
    });
  }
  const stubs = STUBS.map((points, k): Line => {
    const arcs = arcsOf(points);
    const start = 0.3 + 0.06 * k;
    return { points, arcs, length: arcs.at(-1)!, start, landed: start + 0.45 };
  });
  const etchR = 13;
  const centres: Point[] = [];
  for (let r = -4; r <= 4; r++) {
    for (let q = -14; q <= 14; q++) {
      centres.push([mind.cx + etchR * SQ3 * (q + r / 2), mind.cy + etchR * 1.5 * r]);
    }
  }
  return {
    width,
    height,
    mind,
    traces,
    stubs,
    etch: { centres, r: etchR - 0.5 },
    ring: 51,
    drawn: (line, t) => easeInOut((t - line.start) / (line.landed - line.start)),
    packets(trace, t) {
      const { speed, length } = trace;
      return trace.packets.between(t - (length + TAIL) / speed, t).map((t0) => (t - t0) * speed);
    },
    orders(trace, t) {
      const speed = trace.speed * 0.8;
      const { length } = trace;
      return trace.orders
        .between(t - (length + TAIL) / speed, t)
        .map((t0) => length - (t - t0) * speed);
    },
  };
}

// ---------- the arrival ----------

/** Turning on (decision 632), in seconds: covered, held, the boom, still. */
export const ARRIVAL = { cover: 1.0, hold: 0.16, boom: 0.62, end: 1.9 } as const;

/** What the arrival shows at its moment, for the drawing. */
export interface ArrivalView {
  /** The blackout's open middle round the Mind, its two radii; 0 once covered. */
  holeX: number;
  holeY: number;
  /** The Mind flaring, 0–1. */
  heat: number;
  /** The boom: 0 before, 1 done; the tear's radius from the Mind; the ink pushed out. */
  boom: number;
  tear: number;
  push: number;
}

export interface ArrivalScene {
  readonly width: number;
  readonly height: number;
  readonly at: Point;
  readonly mind: Mind;
  /** The Mind's size: the question's at first, a fifth of the window once grown. */
  readonly mindScale: number;
  readonly t: number;
  /** A frame drawn now covers the whole window: the look may change under it. */
  readonly covered: boolean;
  readonly done: boolean;
  view(): ArrivalView;
  step(dt: number): void;
}

/**
 * Turning on: the question's Hive Mind (at `at`, `scale` its size there), awake and thinking,
 * grows to the middle of a `width` × `height` window while a blackout closes on it from every
 * edge; covered, it flares, and a boom from it tears the ink back to the edges.
 */
export function arrivalScene({
  width,
  height,
  at,
  scale,
}: {
  width: number;
  height: number;
  at: Point;
  scale: number;
}): ArrivalScene {
  const [mx, my] = at;
  const mind = new Mind(0, 0);
  // Thoughts of its own as it grows: signals from its outer cells in to the core.
  mind.cells.forEach((cell, i) => {
    if (cell.ring !== 2 || i % 3) return;
    const times = timetable(500 + i, 0, 0.6);
    mind.feed({ cell: i, strength: 0.9, arrivals: (a, b) => times.between(a, b) });
  });
  const grown = Math.max(scale, (0.2 * Math.min(width, height)) / mind.reach);
  const grow = new Spring(scale, 7.5, 0.48);
  const farthest = Math.max(
    Math.hypot(mx, my),
    Math.hypot(width - mx, my),
    Math.hypot(mx, height - my),
    Math.hypot(width - mx, height - my),
  );
  const T = ARRIVAL;
  let t = 0;
  const boomAt = () => clamp((t - T.cover - T.hold) / T.boom, 0, 1);
  return {
    width,
    height,
    at,
    mind,
    get mindScale() {
      return grow.x;
    },
    get t() {
      return t;
    },
    get covered() {
      return t >= T.cover && boomAt() === 0;
    },
    get done() {
      return t >= T.end;
    },
    view() {
      const p = clamp(t / T.cover, 0, 1);
      // Even from the first moment, closing to the Mind's middle by the cover.
      const close = 1 - Math.pow(1 - Math.pow(p, 1.35), 1.6);
      const end = mind.reach * grow.x * 0.55;
      const holeX =
        t >= T.cover ? 0 : end + (Math.max(mx, width - mx) * 1.5 + 40 - end) * (1 - close);
      const holeY =
        t >= T.cover ? 0 : end + (Math.max(my, height - my) * 1.5 + 40 - end) * (1 - close);
      const b = boomAt();
      const e = 1 - Math.pow(1 - b, 2.6);
      return {
        holeX,
        holeY,
        heat: smooth(T.cover, T.cover + T.hold, t) * (1 - smooth(0, 0.4, b)),
        boom: b,
        tear: b > 0 ? farthest * 1.25 * e + 2 : 0,
        push:
          1 + 0.22 * e + 0.012 * Math.sin((t - T.cover) * 18) * (1 - b) * (t >= T.cover ? 1 : 0),
      };
    },
    step(dt) {
      const sub = Math.max(1, Math.ceil(dt / (1 / 90)));
      const h = dt / sub;
      for (let i = 0; i < sub; i++) {
        t += h;
        if (t > T.cover + 0.05) continue;
        if (t > 0.04) grow.to = grown;
        grow.step(h);
      }
    },
  };
}

/**
 * The arrival's canvas resolution for a `width` × `height` window at `dpr`: at most 0.9 megapixels
 * (decision 632), half at 2560 × 1440. Measured in software: 61 fps there, 55 at full size.
 */
export function arrivalScale(width: number, height: number, dpr: number): number {
  return Math.min(1, Math.sqrt(0.9e6 / (width * dpr * height * dpr)));
}
