// Hive mode's living tendrils (V82, decisions 629–633): ropes of points that follow a pose with
// under-damped springs and noise, goo strands between them, the Hive Mind they grab, and turning
// on as that Mind and a blackout. Pure: positions and widths, stepped in seconds; `hive-draw.ts`
// draws them on a canvas, `HiveArt.tsx` and `shell/hive-arrival.ts` run them.

export type Point = readonly [number, number];

const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0 below `a`, 1 above `b`, smooth between. */
export function smooth(a: number, b: number, x: number): number {
  if (b <= a) return x >= a ? 1 : 0;
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
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

/** Two octaves of noise: slow sway with a little faster detail. */
export const fbm = (x: number, seed: number) =>
  noise(x, seed) * 0.62 + noise(x * 2.07 + 13.1, seed + 101) * 0.38;

/** A seeded random sequence in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/** Carnage's motion (decision 629): quick and red, fluid rather than twitchy. */
export const MOTION = {
  /** Each point's spring toward its pose, and the tension between neighbours. */
  w: 10,
  z: 0.3,
  tension: 420,
  sway: 7,
  swayRate: 0.42,
  wave: 1.15,
  waveRate: 0.6,
  /** A free tendril's length, and a strike's progress. */
  reachW: 12,
  reachZ: 0.28,
  strikeW: 9,
  strikeZ: 0.27,
  twitch: 0.25,
  twitchRate: 1.1,
  taper: 1.3,
  lumps: 0.26,
  lumpCount: 3,
  lumpSpeed: 1.6,
  pulseEvery: 1.4,
  pulseK: 0.32,
  pulseSpeed: 1.3,
  forkEvery: 3.2,
  /** Goo: forms under `formGap` px apart, snaps past `snapGap`. */
  formGap: 9,
  snapGap: 19,
  strandThick: 0.5,
  strandCool: 0.7,
  breathRate: 0.42,
  beat: 0.6,
  coreKick: 1.1,
  sparkSpeed: 3.2,
  thinkEvery: 1.9,
} as const;

// ---------- ropes ----------

/**
 * A tendril's body: `n` points from its root, each following its target (the pose) with a spring,
 * softer toward the tip so the tip trails; a tension between neighbours carries waves down it.
 */
export class Rope {
  readonly n: number;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly tx: Float64Array;
  readonly ty: Float64Array;
  /** Half the width at each point. */
  readonly hw: Float64Array;
  private started = false;
  constructor(n: number) {
    this.n = n;
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.tx = new Float64Array(n);
    this.ty = new Float64Array(n);
    this.hw = new Float64Array(n).fill(0.5);
  }
  /** One step: the root (and the tip if `pinTip`) on their targets, the rest springing to them. */
  step(dt: number, w: number, z: number, tension: number, pinTip: boolean): void {
    const { n, px, py, vx, vy, tx, ty } = this;
    if (!this.started) {
      px.set(tx);
      py.set(ty);
      this.started = true;
      return;
    }
    for (let i = 0; i < n; i++) {
      if (i === 0 || (pinTip && i === n - 1)) {
        px[i] = tx[i]!;
        py[i] = ty[i]!;
        vx[i] = vy[i] = 0;
        continue;
      }
      const wi = w * (1 - (0.45 * i) / (n - 1));
      const j = i < n - 1 ? i + 1 : i;
      const ax =
        wi * wi * (tx[i]! - px[i]!) -
        2 * z * wi * vx[i]! +
        tension * (px[i - 1]! + px[j]! - 2 * px[i]!);
      const ay =
        wi * wi * (ty[i]! - py[i]!) -
        2 * z * wi * vy[i]! +
        tension * (py[i - 1]! + py[j]! - 2 * py[i]!);
      vx[i] = vx[i]! + ax * dt;
      vy[i] = vy[i]! + ay * dt;
    }
    for (let i = 1; i < n; i++) {
      if (pinTip && i === n - 1) continue;
      px[i] = px[i]! + vx[i]! * dt;
      py[i] = py[i]! + vy[i]! * dt;
    }
  }
  /** How much the segment at `i` is stretched beyond its pose (1: as posed). */
  stretch(i: number): number {
    const j = Math.min(i + 1, this.n - 1);
    const k = Math.max(j - 1, 0);
    const a = Math.hypot(this.px[j]! - this.px[k]!, this.py[j]! - this.py[k]!);
    const b = Math.hypot(this.tx[j]! - this.tx[k]!, this.ty[j]! - this.ty[k]!) || 1e-3;
    return a / b;
  }
}

/** A bulge running along a tendril toward its tip, `s` its place (0–1). */
interface Pulse {
  s: number;
  k: number;
  done?: boolean;
}

/** The width along a tendril: swelling and pinching, lumps that crawl, pulses, thinner stretched. */
function shapeWidths(
  rope: Rope,
  base: number,
  tip: number,
  t: number,
  seed: number,
  taper: number,
  pulses: readonly Pulse[],
  extra?: (s: number) => number,
): void {
  const { n } = rope;
  const m = MOTION;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    let w = tip + (base - tip) * Math.pow(1 - s, taper);
    w *=
      1 +
      m.lumps *
        Math.sin(s * m.lumpCount * Math.PI + seed * 1.7 + t * m.lumpSpeed) *
        (0.75 + 0.25 * noise(s * 3 + t * 0.2, seed + 3)) +
      m.lumps * 0.6 * noise(s * 6 - t * m.lumpSpeed * 0.6, seed + 9);
    for (const p of pulses) {
      const d = (s - p.s) / 0.075;
      w *= 1 + p.k * Math.exp(-d * d);
    }
    if (extra) w += extra(s);
    rope.hw[i] = Math.max(0.3, w / Math.sqrt(clamp(rope.stretch(i), 0.7, 1.8)) / 2);
  }
}

// ---------- the Hive Mind ----------

const SQ3 = Math.sqrt(3);

/** A cell of the comb: its centre, how lit it is, and a seed for its unevenness. */
export interface MindCell {
  x: number;
  y: number;
  core: boolean;
  energy: number;
  seed: number;
}

/** A spark of thought running from cell to cell along `path`, `u` how far (in cells). */
export interface Spark {
  path: number[];
  u: number;
  speed: number;
}

/** The comb's cells, by axial place (a point up), and the outer ones the tendrils grab. */
const CELLS: readonly Point[] = [
  [0, 0],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
  [-2, 0],
  [-2, 1],
  [-1, -1],
  [2, 0],
  [1, 1],
  [2, -1],
  [0, -2],
  [-1, 2],
  [2, -2],
];
const GRABBED = {
  left: [
    [-1, -1],
    [-2, 0],
    [-2, 1],
    [-1, 2],
  ],
  right: [
    [2, -2],
    [2, -1],
    [2, 0],
    [1, 1],
  ],
} as const;

/**
 * The Hive Mind (decision 630): a honeycomb round a core that breathes and beats; a cell grabbed or
 * fed lights up and may send a spark of thought to the core, which kicks.
 */
export class Mind {
  readonly cx: number;
  readonly cy: number;
  /** A cell's circumradius. */
  readonly r: number;
  readonly cells: MindCell[];
  readonly links: [number, number][] = [];
  sparks: Spark[] = [];
  /** 0 asleep, 1 awake: the grabs wake it. */
  wake = 0;
  breath = 0;
  private readonly coreKick = new Spring(0, 9, 0.35);
  private readonly rand = rng(77);
  private nextThought = 1.2;
  constructor(cx: number, cy: number, r = 11.5) {
    this.cx = cx;
    this.cy = cy;
    this.r = r;
    this.cells = CELLS.map(([q, s], i) => ({
      x: cx + r * SQ3 * (q + s / 2),
      y: cy + r * 1.5 * s,
      core: q === 0 && s === 0,
      energy: 0,
      seed: i * 13 + 5,
    }));
    this.cells.forEach((a, i) =>
      this.cells.forEach((b, j) => {
        if (j > i && Math.hypot(a.x - b.x, a.y - b.y) < r * SQ3 * 1.05) this.links.push([i, j]);
      }),
    );
  }
  /** How far its outermost cell's wall is from its centre. */
  get reach(): number {
    return Math.max(...this.cells.map((c) => Math.hypot(c.x - this.cx, c.y - this.cy))) + this.r;
  }
  cellAt(q: number, s: number): number {
    return CELLS.findIndex(([a, b]) => a === q && b === s);
  }
  neighbours(i: number): number[] {
    return this.links.filter(([a, b]) => a === i || b === i).map(([a, b]) => (a === i ? b : a));
  }
  /** The cells from `from` to the core, each a neighbour nearer to it. */
  pathToCore(from: number): number[] {
    const path = [from];
    const far = (i: number) => {
      const c = this.cells[i]!;
      return Math.hypot(c.x - this.cx, c.y - this.cy);
    };
    let at = from;
    for (let k = 0; k < 6 && !this.cells[at]!.core; k++) {
      const next = this.neighbours(at).sort((a, b) => far(a) - far(b))[0];
      if (next === undefined) break;
      path.push(next);
      at = next;
    }
    return path;
  }
  /** Lights a cell; `to`: a spark to the core, to a neighbour, or none. */
  fire(cell: number, to: 'core' | 'near' | 'none' = 'core'): void {
    const c = this.cells[cell];
    if (!c) return;
    c.energy = Math.min(1.4, c.energy + 0.9);
    if (to === 'none') return;
    const near = this.neighbours(cell);
    const path =
      to === 'core'
        ? this.pathToCore(cell)
        : [cell, near[Math.floor(this.rand() * near.length)] ?? cell];
    if (path.length > 1 && path[0] !== path[1]) {
      this.sparks.push({ path, u: 0, speed: MOTION.sparkSpeed * (0.8 + 0.4 * this.rand()) });
    }
  }
  step(dt: number, t: number): void {
    const m = MOTION;
    for (const c of this.cells) c.energy *= Math.exp(-dt * 2.2);
    this.coreKick.step(dt);
    // Breathing, uneven, and a beat twice like a heart's.
    const slow = fbm(t * m.breathRate, 5) * 0.5 + 0.5;
    const beat = Math.pow(
      Math.max(0, Math.sin(t * m.breathRate * TAU * 1.13 + fbm(t * 0.3, 8) * 2)),
      3,
    );
    this.breath = clamp(0.35 + 0.4 * slow + 0.35 * beat * m.beat + this.coreKick.x, 0, 1.6);
    for (const s of this.sparks) {
      s.u += dt * s.speed;
      if (s.u >= s.path.length - 1) {
        const end = this.cells[s.path.at(-1)!]!;
        end.energy = Math.min(1.4, end.energy + 0.5);
        if (end.core) this.coreKick.v += m.coreKick;
      }
    }
    this.sparks = this.sparks.filter((s) => s.u < s.path.length - 1);
    // Thoughts of its own, now and then.
    if (this.wake > 0.6 && t > this.nextThought) {
      this.nextThought = t + m.thinkEvery * (0.4 + this.rand());
      this.fire(Math.floor(this.rand() * this.cells.length), this.rand() < 0.5 ? 'core' : 'near');
    }
  }
}

// ---------- tendrils ----------

interface PlugSpec {
  root: Point;
  /** The way it leaves its root. */
  dir: Point;
  anchor: Point;
  /** Into the cell, from outside. */
  inward: Point;
  cell: number;
  width: number;
  tipW: number;
  taper: number;
  /** When it strikes; it comes out 0.42 s before. */
  start: number;
  cock: number;
  swing: Point;
  s1: number;
  s2: number;
  seed: number;
}

/**
 * A tendril that grabs a cell (decision 630): it comes out of the ink, draws back, strikes in an
 * arc, pushes into its cell and grabs, its foot spreading round the wall; then it holds, swaying,
 * with pulses running down it into the Mind.
 */
export class Plug {
  readonly rope = new Rope(24);
  readonly root: Point;
  readonly dir: Point;
  readonly anchor: Point;
  readonly inward: Point;
  readonly cell: number;
  readonly width: number;
  readonly tipW: number;
  readonly seed: number;
  /** The strike's progress: 0 its start, 1 at the cell. */
  readonly q = new Spring(-0.35, MOTION.strikeW, MOTION.strikeZ);
  /** The foot, spread once it grabs. */
  readonly splay = new Spring(0, 15, 0.3);
  grabbed = false;
  alive = false;
  pulses: Pulse[] = [];
  private nextPulse: number;
  private readonly spec: PlugSpec;
  constructor(spec: PlugSpec) {
    this.spec = spec;
    this.root = spec.root;
    this.dir = spec.dir;
    this.anchor = spec.anchor;
    this.inward = spec.inward;
    this.cell = spec.cell;
    this.width = spec.width;
    this.tipW = spec.tipW;
    this.seed = spec.seed;
    this.nextPulse = spec.start + 1.2 + spec.seed * 0.137;
  }
  private tipTarget(q: number): Point {
    const { root, dir, anchor, inward, cock, swing } = this.spec;
    const q0x = root[0] + dir[0] * 40;
    const q0y = root[1] + dir[1] * 40 + cock;
    if (q < 0) return [q0x + dir[0] * q * 130, q0y + dir[1] * q * 130 + cock * q * 1.2];
    if (q <= 1) {
      // The tip swings in out of line: a strike, not a line drawn.
      const sx = (q0x + anchor[0]) / 2 + swing[0];
      const sy = (q0y + anchor[1]) / 2 + swing[1];
      const u = 1 - q;
      return [
        u * u * q0x + 2 * u * q * sx + q * q * anchor[0],
        u * u * q0y + 2 * u * q * sy + q * q * anchor[1],
      ];
    }
    const into =
      0.075 * Math.tanh((q - 1) / 0.075) * Math.hypot(anchor[0] - q0x, anchor[1] - q0y) * 0.35;
    return [anchor[0] + inward[0] * into, anchor[1] + inward[1] * into];
  }
  step(dt: number, t: number, mind: Mind): void {
    const m = MOTION;
    const { start } = this.spec;
    // Out of the ink, drawn back, then the strike; once it has hold it keeps it.
    if (t >= start - 0.42 && t < start - 0.12) this.q.to = 0;
    else if (t >= start - 0.12 && t < start) this.q.to = -0.08;
    else if (t >= start) this.q.to = 1;
    this.q.w = t < start - 0.12 ? 9 : m.strikeW;
    this.q.step(dt);
    if (this.grabbed && this.q.x < 1) {
      this.q.x = 1;
      this.q.v = Math.max(0, this.q.v);
    }
    this.splay.step(dt);
    this.alive = t >= start - 0.42;
    if (!this.grabbed && this.q.x > 0.985) {
      this.grabbed = true;
      this.q.x = Math.max(this.q.x, 1);
      this.splay.v += 9;
      mind.fire(this.cell);
      mind.wake = Math.min(1, mind.wake + 0.22);
    }
    // Pulses run down it into the Mind.
    if (this.grabbed && t > this.nextPulse) {
      this.nextPulse = t + m.pulseEvery * (0.45 + 1.1 * hash(Math.floor(t * 7), this.seed + 2));
      this.pulses.push({ s: 0, k: m.pulseK * (0.7 + 0.6 * hash(Math.floor(t * 3), this.seed)) });
    }
    for (const p of this.pulses) {
      p.s += dt * m.pulseSpeed;
      if (p.s >= 1 && !p.done) {
        p.done = true;
        mind.fire(this.cell, hash(Math.floor(t * 13), this.seed) < 0.45 ? 'core' : 'none');
      }
    }
    this.pulses = this.pulses.filter((p) => p.s < 1.15);
    this.pose(t);
    // While it strikes the whole arm moves with its tip; once it holds, it softens and lives.
    const striking = !this.grabbed && t >= start - 0.12;
    this.rope.step(dt, m.w * (striking ? 3.2 : 1.4), striking ? 0.6 : m.z, m.tension, true);
    const foot = this.splay.x;
    shapeWidths(
      this.rope,
      this.width,
      this.tipW,
      t,
      this.seed,
      this.spec.taper,
      this.pulses,
      (s) => Math.pow(smooth(0.82, 1, s), 2) * foot * this.tipW * 1.6,
    );
  }
  /** Its pose: a curve from the root to the tip, swaying, a ripple running down it. */
  private pose(t: number): void {
    const m = MOTION;
    const { root, dir, inward, s1, s2 } = this.spec;
    const [tipx, tipy] = this.tipTarget(this.q.x);
    const [rx, ry] = root;
    const [ix, iy] = inward;
    const d = Math.hypot(tipx - rx, tipy - ry);
    const bow1 = m.sway * 2.2 * fbm(t * m.swayRate + this.seed, this.seed);
    const bow2 = m.sway * 1.6 * fbm(t * m.swayRate * 1.3 + 4 + this.seed, this.seed + 5);
    const twitch =
      m.twitch *
      m.sway *
      2 *
      noise(t * m.twitchRate * 6, this.seed + 9) *
      smooth(0.55, 0.85, noise(t * m.twitchRate, this.seed + 11));
    // A short stub is a plain hook; the S of a long one fades in as it grows.
    const grown = smooth(40, 170, d);
    const bend = (bow1 + twitch + s1) * grown;
    const c1x = rx + dir[0] * d * 0.42 - dir[1] * bend;
    const c1y = ry + dir[1] * d * 0.42 + dir[0] * bend;
    const c2x = tipx - ix * d * 0.36 - iy * (bow2 + s2) * grown;
    const c2y = tipy - iy * d * 0.36 + ix * (bow2 + s2) * grown;
    const { rope } = this;
    for (let j = 0; j < rope.n; j++) {
      const s = j / (rope.n - 1);
      const u = 1 - s;
      const wave =
        m.wave *
        m.sway *
        fbm(t * m.waveRate * 3 - s * 2.4, this.seed + 21) *
        Math.sin(Math.PI * s) *
        (this.grabbed ? 1 : 0.4);
      rope.tx[j] =
        u * u * u * rx +
        3 * u * u * s * c1x +
        3 * u * s * s * c2x +
        s * s * s * tipx -
        iy * wave * 0.3;
      rope.ty[j] =
        u * u * u * ry + 3 * u * u * s * c1y + 3 * u * s * s * c2y + s * s * s * tipy + wave;
    }
  }
  /** One side of the grip: goo spreading round the cell's wall from the tip, into `out`. */
  foot(side: -1 | 1, out: Rope): number {
    const n = 7;
    const last = this.rope.n - 1;
    const x = this.rope.px[last]!;
    const y = this.rope.py[last]!;
    const [ix, iy] = this.inward;
    const f = clamp(this.splay.x, 0, 1.4);
    for (let k = 0; k < n; k++) {
      const s = k / (n - 1);
      const a = side * (0.9 + 1.4 * s);
      const dx = -(ix * Math.cos(a) - iy * Math.sin(a));
      const dy = -(ix * Math.sin(a) + iy * Math.cos(a));
      const len = s * this.tipW * 1.5 * f;
      out.px[k] = x + ix * this.tipW * 0.2 + dx * len;
      out.py[k] = y + iy * this.tipW * 0.2 + dy * len;
      out.hw[k] = Math.max(0.35, this.tipW * 0.42 * (1 - s * 0.8) * Math.min(1, f));
    }
    return n;
  }
}

interface FreeSpec {
  root: Point;
  /** The angle it leaves its root at, in radians. */
  angle: number;
  length: number;
  /** Its length to begin with; 0 by default. */
  len0?: number;
  width: number;
  tip?: number;
  bend?: number;
  /** Its curl now, and once it has reached. */
  curl: number;
  curlRest: number;
  /** An S along it: its size in radians and its phase. */
  sAmp?: number;
  sPhase?: number;
  start: number;
  /** How late it follows the noise: the small ones trail the big ones. */
  delay: number;
  seed: number;
  /** Reaches and forks of its own now and then. */
  events: boolean;
  forks?: boolean;
  n?: number;
  shadow?: number;
}

/** A free tendril (decision 629): it grows from its root, reaches, curls, forks and joins again. */
export class Free {
  readonly rope: Rope;
  /** Its second branch, when it forks. */
  readonly branch: Rope | null;
  readonly root: Point;
  readonly length: number;
  readonly width: number;
  readonly seed: number;
  readonly shadow: number;
  readonly len: Spring;
  readonly curl: Spring;
  readonly fork = new Spring(0, 7, 0.45);
  alive = false;
  private reached = false;
  private curlAt = 0;
  private backAt = 0;
  private joinAt = 0;
  private nextReach: number;
  private nextFork: number;
  private readonly spec: FreeSpec;
  constructor(spec: FreeSpec) {
    this.spec = spec;
    const n = spec.n ?? 22;
    this.rope = new Rope(n);
    this.branch = spec.forks ? new Rope(n) : null;
    this.root = spec.root;
    this.length = spec.length;
    this.width = spec.width;
    this.seed = spec.seed;
    this.shadow = spec.shadow ?? 2.5;
    this.len = new Spring(spec.len0 ?? 0, MOTION.reachW, MOTION.reachZ);
    this.curl = new Spring(spec.curl, 6, 0.5);
    this.nextReach = spec.start + 1.5 + (spec.seed % 5) * 0.6;
    this.nextFork = spec.start + MOTION.forkEvery * (0.5 + (spec.seed % 3) / 3);
  }
  /** Its pose along its length: an angle that bends, curls to the tip and ripples. */
  private pose(rope: Rope, t: number, side: number): void {
    const m = MOTION;
    const { spec } = this;
    const n = rope.n;
    const seg = Math.max(0.5, this.len.x) / (n - 1);
    const tt = t - spec.delay;
    let a = spec.angle + m.sway * 0.018 * fbm(tt * m.swayRate + this.seed, this.seed);
    let x = spec.root[0];
    let y = spec.root[1];
    const twitch =
      m.twitch *
      0.9 *
      noise(tt * m.twitchRate * 5, this.seed + 9) *
      smooth(0.5, 0.85, noise(tt * m.twitchRate, this.seed + 11));
    const fk = this.fork.x;
    for (let k = 0; k < n; k++) {
      const s = k / (n - 1);
      rope.tx[k] = x;
      rope.ty[k] = y;
      a +=
        ((spec.bend ?? 0) +
          this.curl.x * 3 * s * s +
          m.wave * 1.1 * fbm(tt * m.waveRate * 2.2 - s * 2.1, this.seed + 21) * (0.3 + s) * 1.6 +
          twitch * s * 3) /
        (n - 1);
      // Forked: each branch turns away past the fork and back toward the other at the tip.
      const f = side ? side * fk * (0.6 * smooth(0.45, 0.59, s) - 0.42 * smooth(0.68, 1, s)) : 0;
      const g =
        (spec.sAmp ?? 0) * Math.sin(Math.PI * 1.4 * s + (spec.sPhase ?? 0)) * smooth(0, 0.3, s);
      x += Math.cos(a + f + g) * seg;
      y += Math.sin(a + f + g) * seg;
    }
  }
  step(dt: number, t: number): void {
    const { spec } = this;
    this.alive = t >= spec.start;
    if (!this.alive) return;
    if (!this.reached) {
      this.len.to = this.length;
      this.reached = true;
      this.curlAt = t + 0.25;
    }
    if (this.curlAt && t > this.curlAt) {
      this.curl.to = spec.curlRest;
      this.curlAt = 0;
    }
    if (spec.events && t > this.nextReach) {
      // A reach: it lunges a little further, straightening, then comes back.
      this.nextReach = t + (2 + 3.5 * hash(Math.floor(t * 9), this.seed)) * 0.55;
      this.len.to = this.length * (1.12 + 0.18 * hash(Math.floor(t * 5), this.seed + 1));
      this.backAt = t + 0.28;
      this.curl.to = spec.curlRest * 0.6;
    }
    if (this.backAt && t > this.backAt) {
      this.len.to = this.length;
      this.curl.to = spec.curlRest;
      this.backAt = 0;
    }
    if (this.branch && spec.events && t > this.nextFork) {
      this.nextFork = t + MOTION.forkEvery * (0.6 + 0.8 * hash(Math.floor(t * 4), this.seed + 3));
      this.fork.to = 1;
      this.joinAt = t + 1.4 + 1.2 * hash(Math.floor(t * 6), this.seed + 4);
    }
    if (this.joinAt && t > this.joinAt) {
      this.fork.to = 0;
      this.joinAt = 0;
    }
    this.len.step(dt);
    this.curl.step(dt);
    this.fork.step(dt);
    const m = MOTION;
    const tip = spec.tip ?? 0.7;
    this.pose(this.rope, t, this.branch ? -1 : 0);
    this.rope.step(dt, m.w, m.z, m.tension, false);
    shapeWidths(this.rope, this.width, tip, t, this.seed, m.taper, []);
    if (this.branch) {
      this.pose(this.branch, t, 1);
      this.branch.step(dt, m.w, m.z, m.tension, false);
      shapeWidths(this.branch, this.width, tip, t, this.seed + 1, m.taper, []);
      // Forked, each branch is thinner beyond the fork.
      const fk = clamp(this.fork.x, 0, 1);
      for (const r of [this.rope, this.branch]) {
        for (let i = 0; i < r.n; i++)
          r.hw[i] = r.hw[i]! * (1 - 0.32 * fk * smooth(0.4, 0.6, i / (r.n - 1)));
      }
    }
  }
}

/** Something with a rope that a strand can hang from. */
interface Holder {
  readonly rope: Rope;
  readonly alive: boolean;
}

/** One half of a snapped strand, pulling back into its tendril. */
export interface Stub {
  rope: Rope;
  s: number;
  spring: Spring;
  dx: number;
  dy: number;
  w: number;
}

/**
 * Goo between two tendrils (decision 629): it forms where they come close, thins as they part,
 * snaps, and each half pulls back into its tendril.
 */
export class Strand {
  readonly a: Holder;
  readonly b: Holder;
  readonly sa: number;
  readonly sb: number;
  readonly seed: number;
  bridged = false;
  /** The gap it formed across, and how thick it was then. */
  len0 = 0;
  thick = 0;
  stubs: Stub[] = [];
  private cool = 0;
  constructor(a: Holder, sa: number, b: Holder, sb: number, seed: number) {
    this.a = a;
    this.sa = sa;
    this.b = b;
    this.sb = sb;
    this.seed = seed;
  }
  /** Where it hangs on each tendril: the points and their half widths. */
  ends(): [number, number, number, number, number, number] {
    const ra = this.a.rope;
    const rb = this.b.rope;
    const ia = Math.round(this.sa * (ra.n - 1));
    const ib = Math.round(this.sb * (rb.n - 1));
    return [ra.px[ia]!, ra.py[ia]!, ra.hw[ia]!, rb.px[ib]!, rb.py[ib]!, rb.hw[ib]!];
  }
  step(dt: number): void {
    const m = MOTION;
    const [ax, ay, ah, bx, by, bh] = this.ends();
    const d = Math.hypot(bx - ax, by - ay) || 1;
    const gap = d - ah - bh;
    this.cool -= dt;
    const alive = this.a.alive && this.b.alive;
    if (!this.bridged) {
      if (this.cool <= 0 && gap < m.formGap && alive) {
        this.bridged = true;
        this.len0 = Math.max(gap, 1);
        this.thick = Math.min(ah, bh) * m.strandThick;
      }
    } else if (gap > m.snapGap || !alive) {
      this.bridged = false;
      this.cool = m.strandCool * (0.6 + 0.8 * hash(Math.floor(this.seed + gap), this.seed));
      for (const [x, y, ox, oy, holder, s] of [
        [ax, ay, bx, by, this.a, this.sa],
        [bx, by, ax, ay, this.b, this.sb],
      ] as const) {
        const spring = new Spring(gap / 2 + 4, 16, 0.32);
        spring.to = 0;
        this.stubs.push({
          rope: holder.rope,
          s,
          spring,
          dx: (ox - x) / d,
          dy: (oy - y) / d,
          w: this.thick * 0.7,
        });
      }
    }
    for (const stub of this.stubs) stub.spring.step(dt);
    this.stubs = this.stubs.filter((s) => s.spring.x > 0.4 || Math.abs(s.spring.v) > 2);
  }
  /** The bridge as a rope into `out` (thick at its feet, thin in the middle), its points' count. */
  bridge(t: number, out: Rope): number {
    const [ax, ay, ah, bx, by, bh] = this.ends();
    const d = Math.hypot(bx - ax, by - ay) || 1;
    const gap = Math.max(d - ah - bh, 0.1);
    const thin = clamp(Math.pow(this.len0 / gap, 0.9), 0.08, 1.2);
    const n = 11;
    const sag = (gap * 0.18 + 2) * (0.6 + 0.4 * noise(t * 0.7, this.seed));
    const nx = -(by - ay) / d;
    const ny = (bx - ax) / d;
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      const bow = Math.sin(s * Math.PI) * sag;
      out.px[i] = lerp(ax, bx, s) + nx * bow * 0.4;
      out.py[i] = lerp(ay, by, s) + ny * bow * 0.4 + bow * 0.6;
      out.hw[i] = Math.max(
        0.35,
        this.thick * (thin * 0.55 + Math.pow(Math.abs(2 * s - 1), 2.2) * 0.85),
      );
    }
    return n;
  }
  /** A snapped half as a rope into `out`, its points' count. */
  static stub(stub: Stub, out: Rope): number {
    const r = stub.rope;
    const i = Math.round(stub.s * (r.n - 1));
    const len = Math.max(0, stub.spring.x) + r.hw[i]!;
    const n = 6;
    for (let k = 0; k < n; k++) {
      const s = k / (n - 1);
      out.px[k] = r.px[i]! + stub.dx * len * s;
      out.py[k] = r.py[i]! + stub.dy * len * s + s * s * 2;
      out.hw[k] = Math.max(0.35, lerp(stub.w * 1.6, stub.w * 0.8, s));
    }
    return n;
  }
}

// ---------- the question ----------

/** How long the question's join takes: drawn at 60 frames a second until then, 30 after. */
export const JOIN_SECONDS = 1.6;
/** The moment its still frame shows, with reduced motion: joined and settled. */
export const STILL_AT = 3;

export interface QuestionScene {
  readonly width: number;
  readonly height: number;
  readonly mind: Mind;
  readonly plugs: Plug[];
  readonly frees: Free[];
  readonly strands: Strand[];
  /** Where the tendrils leave each side's ink, for the ink at the edges. */
  readonly roots: { left: number[]; right: number[] };
  readonly t: number;
  step(dt: number): void;
}

/**
 * The question's head (a 520 × 128 box, decisions 630–631): tendrils from both sides and over the
 * top corners grab the Hive Mind's outer cells and hold; smaller ones trail them, curl and fork;
 * goo between neighbours.
 */
export function questionScene(): QuestionScene {
  const width = 520;
  const height = 128;
  const cx = 260;
  const cy = 64;
  const mind = new Mind(cx, cy);
  const plugs: Plug[] = [];
  const frees: Free[] = [];
  const strands: Strand[] = [];
  const roots = { left: [] as number[], right: [] as number[] };
  const plugW = [30, 18, 34, 20];
  for (const side of ['left', 'right'] as const) {
    const sgn = side === 'left' ? 1 : -1;
    const cells = GRABBED[side]
      .map(([q, s]) => mind.cellAt(q, s))
      .sort((a, b) => mind.cells[a]!.y - mind.cells[b]!.y);
    cells.forEach((cell, k) => {
      const m = mind.cells[cell]!;
      const ox0 = m.x - cx;
      const oy0 = m.y - cy;
      const ol = Math.hypot(ox0, oy0) || 1;
      // Into the cell from outside, a little more from the side it is reached from.
      let ox = ox0 / ol - sgn * 0.6;
      let oy = oy0 / ol;
      const l2 = Math.hypot(ox, oy) || 1;
      ox /= l2;
      oy /= l2;
      // The first comes over the top edge near the corner, the rest from the side, uneven.
      const fromTop = k === 0;
      const y = fromTop
        ? -10
        : lerp(40, 116, (k - 1) / (cells.length - 2)) +
          (side === 'right' ? 7 : -5) * (k % 2 ? 1 : -1);
      const x = fromTop ? (side === 'left' ? 46 : width - 46) : side === 'left' ? -4 : width + 4;
      if (!fromTop) roots[side].push(y);
      const mid = k - (cells.length - 1) / 2;
      const dl = Math.hypot(0.55, 0.83);
      const w = plugW[k % plugW.length]!;
      plugs.push(
        new Plug({
          root: [x, y],
          dir: fromTop ? [(sgn * 0.55) / dl, 0.83 / dl] : [sgn, 0],
          anchor: [m.x + (ox0 / ol) * mind.r * 1.12, m.y + (oy0 / ol) * mind.r * 1.12],
          inward: [-ox, -oy],
          cell,
          width: w,
          tipW: w * 0.32,
          taper: 1.05,
          start: 0.5 + [0.12, 0, 0.24, 0.3][k % 4]! + (side === 'right' ? 0.07 : 0),
          cock: (mid === 0 ? -sgn : Math.sign(mid)) * 16,
          swing: [0, (mid === 0 ? -sgn : Math.sign(mid)) * 46],
          s1: (k % 2 ? -1 : 1) * (28 + 8 * (k % 3)),
          s2: (k % 2 ? 1 : -1) * (14 + 5 * (k % 2)) * sgn,
          seed: (side === 'left' ? 10 : 40) + k * 3,
        }),
      );
    });
    // Smaller ones trail the big ones, never plugged: they reach, curl and fork.
    for (let k = 0; k < 2; k++) {
      const low = k === 1;
      const y = low ? 90 : 38;
      roots[side].push(y);
      frees.push(
        new Free({
          root: [side === 'left' ? -2 : width + 2, y],
          angle: side === 'left' ? (low ? 0.22 : -0.22) : Math.PI + (low ? -0.22 : 0.22),
          length: 118,
          width: 11,
          curl: 0.3 * sgn * (low ? 1 : -1),
          curlRest: 3.6 * sgn * (low ? -1 : 1),
          start: 0.78 + k * 0.14,
          delay: 0.35,
          seed: (side === 'left' ? 70 : 90) + k,
          events: true,
          forks: k === 0,
          n: 22,
          tip: 0.5,
        }),
      );
    }
  }
  // Goo between neighbouring plugs where they crowd, and from the small ones to the big.
  for (const left of [true, false]) {
    const group = plugs.filter((p) => p.root[0] < cx === left);
    for (let k = 0; k < group.length - 1; k++) {
      for (const [sa, sb, seed] of [
        [0.8, 0.82, 200],
        [0.55, 0.58, 220],
        [0.3, 0.32, 240],
      ] as const) {
        strands.push(new Strand(group[k]!, sa, group[k + 1]!, sb, seed + k));
      }
    }
  }
  for (const free of frees) {
    const near = plugs
      .filter((p) => p.root[0] < cx === free.root[0] < cx && p.root[1] > 0)
      .sort((a, b) => Math.abs(a.root[1] - free.root[1]) - Math.abs(b.root[1] - free.root[1]))[0];
    if (near) strands.push(new Strand(free, 0.4, near, 0.3, 260 + free.seed));
  }
  let t = 0;
  return {
    width,
    height,
    mind,
    plugs,
    frees,
    strands,
    roots,
    get t() {
      return t;
    },
    step(dt) {
      const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / sub;
      for (let i = 0; i < sub; i++) {
        t += h;
        for (const p of plugs) p.step(h, t, mind);
        for (const f of frees) f.step(h, t);
        for (const s of strands) s.step(h);
        mind.step(h, t);
      }
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
 * Turning on: the question's Hive Mind (at `at`, `scale` its size there) grows to the middle of a
 * `width` × `height` window while a blackout closes on it from every edge; covered, it flares, and
 * a boom from it tears the ink back to the edges. No tentacles.
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
  mind.wake = 1;
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
        mind.step(h, t);
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
