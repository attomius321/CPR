// Hive mode's tendrils drawn on a canvas (V82, decisions 629–633): each a tube shaded across its
// width as a glossy cylinder lit from the upper left (as the pages' sheen), a crimson rim on its
// shadow side and a wet highlight that breaks and runs along it; the Hive Mind's comb; the
// arrival's blackout and boom. The colours are `hive.css`'s (`.hive-art`), read once.
import {
  ARRIVAL,
  edgeAt,
  hash,
  noise,
  Rope,
  smooth,
  Strand,
  type ArrivalScene,
  type Free,
  type Mind,
  type Plug,
  type QuestionScene,
  type SidenavScene,
} from './hive-art.js';

/** Hive's art colours, `#rrggbb`, from `hive.css`'s custom properties on the canvas. */
export interface Palette {
  ink: string;
  lit: string;
  env: string;
  rim: string;
  spec: string;
  glow: string;
  cellHot: string;
  coreHot: string;
  chamber: string;
  thought: string;
  wall: string;
  wallLit: string;
  wallDeep: string;
}

const PROPERTIES: Record<keyof Palette, string> = {
  ink: '--art-ink',
  lit: '--art-lit',
  env: '--art-env',
  rim: '--art-rim',
  spec: '--art-spec',
  glow: '--art-glow',
  cellHot: '--art-cell-hot',
  coreHot: '--art-core-hot',
  chamber: '--art-chamber',
  thought: '--art-thought',
  wall: '--art-wall',
  wallLit: '--art-wall-lit',
  wallDeep: '--art-wall-deep',
};

/** The palette `hive.css` gives `element` (black for a colour it lacks: still drawn, never thrown). */
export function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const read = (name: string) => {
    const value = style.getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  };
  return Object.fromEntries(
    Object.entries(PROPERTIES).map(([key, name]) => [key, read(name)]),
  ) as unknown as Palette;
}

/** How Carnage's surface takes the light: a dark body, a crimson rim, a sharp wet highlight. */
const SHADE = {
  litK: 0.75,
  litPow: 2.1,
  envK: 0.2,
  envPow: 12,
  rimK: 0.7,
  specK: 0.95,
  specW: 0.14,
  shin: 14,
  sheenK: 0.04,
  breakLo: 0.38,
  breakHi: 0.62,
  breakScale: 24,
  flow: 1.1,
} as const;

const TAU = Math.PI * 2;
const norm3 = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};
const LIGHT = norm3(-0.5, -0.8, 0.62);
const HALF = norm3(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
const RIM = norm3(0.6, 0.72, 0.1);
/** Directions of a tube's normal with gradient stops of their own. */
const BUCKETS = 96;
/** Across the width: the normal's side (0) to the other (1). */
const OFFS = [0, 0.08, 0.2, 0.36, 0.52, 0.68, 0.84, 0.94, 1];
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** A colour as `r,g,b`, for `rgba()`. */
const rgb = (hex: string) => channels(hex).join(',');

/** Where across the width (-1–1) the highlight sits for a normal, and how bright (0–1). */
function specAt(nx: number, ny: number): [number, number] {
  const a = nx * HALF[0] + ny * HALF[1];
  const m = Math.hypot(a, HALF[2]);
  return [a / m, m];
}

const MAXP = 640;
const NX = new Float64Array(MAXP);
const NY = new Float64Array(MAXP);
const LX = new Float64Array(MAXP);
const LY = new Float64Array(MAXP);
const RX = new Float64Array(MAXP);
const RY = new Float64Array(MAXP);
const AL = new Float64Array(MAXP);
const SU = new Float64Array(MAXP);
const ARC = new Float64Array(MAXP);
const DX = new Float64Array(MAXP);
const DY = new Float64Array(MAXP);
const DW = new Float64Array(MAXP);
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 *
  (2 * p1 +
    (p2 - p0) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);

/** The rope's points smoothed (Catmull-Rom), `k` for each segment, into DX, DY, DW. */
function densify(
  px: ArrayLike<number>,
  py: ArrayLike<number>,
  hw: ArrayLike<number>,
  n: number,
  k: number,
): number {
  let m = 0;
  for (let i = 0; i < n - 1 && m < MAXP - k - 1; i++) {
    const i0 = i > 0 ? i - 1 : 0;
    const i2 = i + 1;
    const i3 = i + 2 < n ? i + 2 : n - 1;
    for (let j = 0; j < k; j++) {
      const t = j / k;
      DX[m] = cr(px[i0]!, px[i]!, px[i2]!, px[i3]!, t);
      DY[m] = cr(py[i0]!, py[i]!, py[i2]!, py[i3]!, t);
      DW[m] = Math.max(0.2, cr(hw[i0]!, hw[i]!, hw[i2]!, hw[i3]!, t));
      m++;
    }
  }
  DX[m] = px[n - 1]!;
  DY[m] = py[n - 1]!;
  DW[m] = hw[n - 1]!;
  return m + 1;
}

/** Normals, both edges and the length along DX/DY; the outline as a path (for the shadow). */
function outline(n: number): Path2D {
  ARC[0] = 0;
  for (let i = 0; i < n; i++) {
    const i0 = i > 0 ? i - 1 : 0;
    const i1 = i < n - 1 ? i + 1 : n - 1;
    let tx = DX[i1]! - DX[i0]!;
    let ty = DY[i1]! - DY[i0]!;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    NX[i] = -ty;
    NY[i] = tx;
    LX[i] = DX[i]! - ty * DW[i]!;
    LY[i] = DY[i]! + tx * DW[i]!;
    RX[i] = DX[i]! + ty * DW[i]!;
    RY[i] = DY[i]! - tx * DW[i]!;
    if (i > 0) ARC[i] = ARC[i - 1]! + Math.hypot(DX[i]! - DX[i - 1]!, DY[i]! - DY[i - 1]!);
  }
  const path = new Path2D();
  path.moveTo(LX[0]!, LY[0]!);
  for (let i = 1; i < n; i++) path.lineTo(LX[i]!, LY[i]!);
  const e = n - 1;
  const a = Math.atan2(NY[e]!, NX[e]!);
  if (DW[e]! > 0.15) path.arc(DX[e]!, DY[e]!, DW[e]!, a, a - Math.PI, true);
  for (let i = n - 1; i >= 0; i--) path.lineTo(RX[i]!, RY[i]!);
  path.closePath();
  return path;
}

interface TubeOptions {
  t: number;
  seed: number;
  /** How bright its highlight is (1: as the palette says). */
  specK?: number;
  /** Its shadow on what is under it, this far down. */
  shadow?: number;
  /** Where along it (0–1) the highlight starts fading out; 1 for none. */
  tipFade?: number;
  /** How much larger its highlight's breaks are (a large tendril's). */
  tex?: number;
}

/**
 * Draws Hive's tendrils, its Mind and its arrival in one palette. One painter for each canvas: it
 * keeps the gradient stops it worked out, and the arrival's covered picture.
 */
export class Painter {
  private readonly palette: Palette;
  /** Gradient stops across a tube's width for each direction of its normal. */
  private readonly stops: string[][];
  private readonly spec: string;
  private readonly glow: string;
  private readonly cellHot: string;
  private readonly coreHot: string;
  private readonly thought: string;
  private readonly scratch = new Rope(16);
  private covered: HTMLCanvasElement | null = null;

  constructor(palette: Palette) {
    this.palette = palette;
    this.spec = rgb(palette.spec);
    this.glow = rgb(palette.glow);
    this.cellHot = rgb(palette.cellHot);
    this.coreHot = rgb(palette.coreHot);
    this.thought = rgb(palette.thought);
    const [ink, lit, env, rim] = [palette.ink, palette.lit, palette.env, palette.rim].map(channels);
    this.stops = Array.from({ length: BUCKETS }, (_, b) => {
      const nx = Math.cos((b / BUCKETS) * TAU);
      const ny = Math.sin((b / BUCKETS) * TAU);
      return OFFS.map((o) => {
        // A cylinder's section: the normal turns from one edge, through facing us, to the other.
        const u = 1 - 2 * o;
        const z = Math.sqrt(Math.max(0, 1 - u * u));
        const n = [u * nx, u * ny, z] as const;
        const dot = (v: readonly number[]) =>
          Math.max(0, n[0] * v[0]! + n[1] * v[1]! + n[2] * v[2]!);
        const edge = 1 - z;
        const d = dot(LIGHT);
        const diffuse = Math.pow(d, SHADE.litPow) * SHADE.litK;
        const sheen = Math.pow(dot(HALF), SHADE.envPow) * SHADE.envK;
        const rimLight = Math.pow(dot(RIM), 3) * SHADE.rimK * Math.pow(edge, 1.2);
        const deep = 1 - 0.6 * Math.pow(edge, 2.5) * (1 - d);
        const c = [0, 1, 2].map(
          (k) =>
            Math.min(
              255,
              Math.max(
                0,
                (ink![k]! + lit![k]! * diffuse) * deep + env![k]! * sheen + rim![k]! * rimLight,
              ),
            ) | 0,
        );
        return `rgb(${c[0]},${c[1]},${c[2]})`;
      });
    });
  }

  /**
   * A tendril: its shadow, its body shaded across its width a few points at a time (drawn exactly to
   * its outline, no clipping mask: a third cheaper, the same look), a soft sheen, and a highlight
   * where the curve faces the light, broken into streaks that run along it like wet tar.
   */
  tube(
    ctx: CanvasRenderingContext2D,
    px: ArrayLike<number>,
    py: ArrayLike<number>,
    hw: ArrayLike<number>,
    count: number,
    o: TubeOptions,
  ): void {
    if (count < 2) return;
    const n = densify(px, py, hw, count, 2);
    const path = outline(n);
    if (o.shadow) {
      ctx.save();
      ctx.translate(o.shadow * 0.5, o.shadow);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fill(path);
      ctx.restore();
    }
    const step = 3;
    for (let i = 0; i < n - 1; i += step) {
      const j = Math.min(i + step, n - 1);
      let mx = NX[i]! + NX[j]!;
      let my = NY[i]! + NY[j]!;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
      let angle = Math.atan2(my, mx);
      if (angle < 0) angle += TAU;
      const stops = this.stops[Math.round((angle / TAU) * BUCKETS) % BUCKETS]!;
      const g = ctx.createLinearGradient(
        (LX[i]! + LX[j]!) / 2,
        (LY[i]! + LY[j]!) / 2,
        (RX[i]! + RX[j]!) / 2,
        (RY[i]! + RY[j]!) / 2,
      );
      OFFS.forEach((off, k) => g.addColorStop(off, stops[k]!));
      ctx.fillStyle = g;
      // A little over its neighbours along the line, so no seam shows between them.
      const tx = my * 0.9;
      const ty = -mx * 0.9;
      ctx.beginPath();
      ctx.moveTo(LX[i]! - tx, LY[i]! - ty);
      for (let q = i + 1; q < j; q++) ctx.lineTo(LX[q]!, LY[q]!);
      ctx.lineTo(LX[j]! + tx, LY[j]! + ty);
      ctx.lineTo(RX[j]! + tx, RY[j]! + ty);
      for (let q = j - 1; q > i; q--) ctx.lineTo(RX[q]!, RY[q]!);
      ctx.lineTo(RX[i]! - tx, RY[i]! - ty);
      ctx.fill();
      if (j === n - 1 && DW[j]! > 0.15) {
        // The rounded tip, in the last stretch's shading.
        const a = Math.atan2(NY[j]!, NX[j]!);
        ctx.beginPath();
        ctx.arc(DX[j]!, DY[j]!, DW[j]!, a, a - Math.PI, true);
        ctx.fill();
      }
    }
    const specK = (o.specK ?? 1) * SHADE.specK;
    if (specK <= 0) return;
    const total = ARC[n - 1] || 1;
    const scale = SHADE.breakScale * (o.tex ?? 1);
    const tipFade = o.tipFade ?? 0.94;
    for (let i = 0; i < n; i++) {
      const [u, m] = specAt(NX[i]!, NY[i]!);
      const s = ARC[i]! / total;
      const broken = smooth(
        SHADE.breakLo,
        SHADE.breakHi,
        noise(ARC[i]! / scale - o.t * SHADE.flow, o.seed + 7) * 0.5 + 0.5,
      );
      const fade = smooth(0, 0.06, s) * (tipFade >= 1 ? 1 : 1 - smooth(tipFade, 1, s));
      AL[i] = Math.pow(m, SHADE.shin) * broken * fade * Math.min(1, DW[i]! / 1.2);
      SU[i] = u;
    }
    this.ribbon(ctx, 0, n, 0.36, 0.5, SHADE.sheenK * specK);
    let i = 0;
    while (i < n) {
      if (!(AL[i]! >= 0.06)) {
        i++;
        continue;
      }
      let j = i;
      let sum = 0;
      while (j < n && AL[j]! >= 0.06) sum += AL[j++]!;
      const mean = (sum / (j - i)) * specK;
      if (j - i >= 3) {
        // A soft halo, the streak, and a hot core where it is brightest.
        this.ribbon(ctx, i, j, SHADE.specW * 2.6, 0.7, mean * 0.16);
        this.ribbon(ctx, i, j, SHADE.specW, 0.78, mean * 0.6);
        if (mean > 0.55) this.ribbon(ctx, i, j, SHADE.specW * 0.38, 0.8, Math.min(1, mean * 1.1));
      }
      i = j;
    }
  }

  /** A highlight from `from` to `to` (dense points), `wk` of the half width wide, tapered. */
  private ribbon(
    ctx: CanvasRenderingContext2D,
    from: number,
    to: number,
    wk: number,
    uk: number,
    alpha: number,
  ): void {
    const len = to - from;
    if (len < 2 || alpha <= 0.002) return;
    const at = (k: number, side: number) => {
      const q = from + k;
      const w = DW[q]! * wk * Math.pow(Math.sin((Math.PI * (k + 0.5)) / len), 1.1);
      const c = SU[q]! * uk * DW[q]! + side * w;
      return [DX[q]! + NX[q]! * c, DY[q]! + NY[q]! * c] as const;
    };
    ctx.beginPath();
    for (let k = 0; k < len; k++) {
      const [x, y] = at(k, 1);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let k = len - 1; k >= 0; k--) ctx.lineTo(...at(k, -1));
    ctx.closePath();
    ctx.fillStyle = `rgba(${this.spec},${Math.min(1, alpha).toFixed(3)})`;
    ctx.fill();
  }

  private rope(ctx: CanvasRenderingContext2D, rope: Rope, n: number, o: TubeOptions): void {
    this.tube(ctx, rope.px, rope.py, rope.hw, n, o);
  }

  private free(ctx: CanvasRenderingContext2D, free: Free, t: number, specK = 1): void {
    if (!free.alive || free.len.x < 1) return;
    const o = { t, seed: free.seed, shadow: free.shadow, specK };
    if (free.branch && free.fork.x > 0.03)
      this.rope(ctx, free.branch, free.branch.n, { ...o, seed: free.seed + 50 });
    this.rope(ctx, free.rope, free.rope.n, o);
  }

  private strands(ctx: CanvasRenderingContext2D, strands: readonly Strand[], t: number): void {
    const out = this.scratch;
    for (const strand of strands) {
      if (strand.bridged)
        this.rope(ctx, out, strand.bridge(t, out), { t, seed: strand.seed, specK: 0.8 });
      for (const stub of strand.stubs)
        this.rope(ctx, out, Strand.stub(stub, out), { t, seed: strand.seed, specK: 0.6 });
    }
  }

  private plug(ctx: CanvasRenderingContext2D, plug: Plug, t: number): void {
    if (plug.alive)
      this.rope(ctx, plug.rope, plug.rope.n, { t, seed: plug.seed, shadow: 2.5, tipFade: 0.97 });
  }

  /** The grip: goo spreading round the cell's wall from the tip. */
  private foot(ctx: CanvasRenderingContext2D, plug: Plug, t: number): void {
    if (!plug.alive || plug.splay.x < 0.02) return;
    for (const side of [-1, 1] as const) {
      this.rope(ctx, this.scratch, plug.foot(side, this.scratch), {
        t,
        seed: plug.seed + side,
        specK: 0.7,
      });
    }
  }

  /** The ink at a side of the question that its tendrils come out of: uneven, swelling at their roots. */
  private edge(
    ctx: CanvasRenderingContext2D,
    x: number,
    height: number,
    roots: readonly number[],
    t: number,
    seed: number,
    flip: boolean,
  ): void {
    const n = 14;
    const out = this.scratch;
    for (let k = 0; k < n; k++) {
      const s = k / (n - 1);
      const y = -20 + (height + 40) * (flip ? 1 - s : s);
      let d = 11 * (0.75 + 0.25 * noise(s * 4 + t * 0.12, seed));
      for (const root of roots) d += 11 * 0.55 * Math.exp(-(((y - root) / 16) ** 2));
      out.px[k] = x;
      out.py[k] = y;
      out.hw[k] = d;
    }
    this.rope(ctx, out, n, { t, seed, specK: 0.7, tipFade: 1 });
  }

  /** The question's head: strands, the small tendrils, the big ones, the ink at its sides, the Mind, the grips. */
  question(ctx: CanvasRenderingContext2D, scene: QuestionScene): void {
    const t = scene.t;
    this.strands(ctx, scene.strands, t);
    for (const free of scene.frees) this.free(ctx, free, t);
    for (const plug of scene.plugs) this.plug(ctx, plug, t);
    const show = smooth(0.02, 0.3, t);
    if (show > 0) {
      ctx.save();
      ctx.globalAlpha = show;
      this.edge(ctx, -6, scene.height, scene.roots.left, t, 31, false);
      this.edge(ctx, scene.width + 6, scene.height, scene.roots.right, t, 37, true);
      ctx.restore();
    }
    this.mind(ctx, scene.mind, t);
    for (const plug of scene.plugs) this.foot(ctx, plug, t);
  }

  /** The sidenav's foot: strands, the tendrils (small ones behind), webbing between roots, the pool. */
  sidenav(ctx: CanvasRenderingContext2D, scene: SidenavScene): void {
    const t = scene.t;
    this.strands(ctx, scene.strands, t);
    // Small ones behind; highlights at half, as the words are over them.
    for (const i of [5, 6, 7, 8, 1, 3, 0, 4, 2]) {
      const free = scene.tendrils[i];
      if (free) this.free(ctx, free, t, 0.5);
    }
    const big = scene.tendrils;
    for (let i = 0; i < 4; i++) {
      const a = big[i];
      const b = big[i + 1];
      if (a && b)
        this.web(
          ctx,
          a,
          b,
          0.13 + 0.05 * ((i * 7) % 3),
          0.12 + 0.04 * ((i * 5) % 3),
          scene.height,
          t,
          i,
        );
    }
    // The pool they rise out of, along the foot.
    const out = this.scratch;
    for (let k = 0; k < 16; k++) {
      const s = k / 15;
      out.px[k] = -10 + s * (scene.width + 20);
      out.py[k] = scene.height + 8 - 6 * noise(s * 5 + t * 0.15, 61);
      out.hw[k] = 16 + 6 * noise(s * 7 + 3, 62);
    }
    this.rope(ctx, out, 16, { t, seed: 61, specK: 0.5 });
  }

  /** Goo webbing between two roots: a membrane whose free edge sags, wet along its rim. */
  private web(
    ctx: CanvasRenderingContext2D,
    a: Free,
    b: Free,
    sa: number,
    sb: number,
    height: number,
    t: number,
    k: number,
  ): void {
    if (!a.alive || !b.alive || a.len.x < 20 || b.len.x < 20) return;
    const pa = Array.from({ length: 7 }, (_, q) => edgeAt(a.rope, (sa * q) / 6, 1));
    const pb = Array.from({ length: 7 }, (_, q) => edgeAt(b.rope, (sb * q) / 6, -1));
    const [ax, ay] = pa[6]!;
    const [bx, by] = pb[6]!;
    const mx = (ax + bx) / 2;
    const my =
      Math.min(ay, by) +
      (height + 20 - Math.min(ay, by)) * (0.55 + 0.1 * noise(t * 0.3, 70 + k)) * 0.6;
    const path = new Path2D();
    path.moveTo(pa[0]![0], height + 40);
    for (const [x, y] of pa) path.lineTo(x, y);
    path.quadraticCurveTo(mx, my, bx, by);
    for (let q = 6; q >= 0; q--) path.lineTo(pb[q]![0], pb[q]![1]);
    path.lineTo(pb[0]![0], height + 40);
    path.closePath();
    const g = ctx.createLinearGradient(0, my - 30, 0, height);
    g.addColorStop(0, this.palette.wallLit);
    g.addColorStop(0.25, this.palette.ink);
    g.addColorStop(1, this.palette.ink);
    ctx.fillStyle = g;
    ctx.fill(path);
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(${this.glow},0.55)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(mx, my, bx, by);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${this.spec},0.32)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax + (mx - ax) * 0.25, ay + (my - ay) * 0.25 + 1.5);
    ctx.quadraticCurveTo(mx, my + 1.5, bx + (mx - bx) * 0.4, by + (my - by) * 0.4 + 1.5);
    ctx.stroke();
  }

  /**
   * The Hive Mind: its aura, the comb as one glossy mass, each chamber lit from within (the core
   * white-hot at the height of a beat), its outer walls catching the light, sparks of thought.
   */
  mind(ctx: CanvasRenderingContext2D, mind: Mind, t: number): void {
    const { r, cells, cx, cy } = mind;
    const breath = mind.breath * mind.wake;
    const grow = 1 + 0.03 * (breath - 0.5);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(grow, grow);
    ctx.translate(-cx, -cy);
    const aura = ctx.createRadialGradient(cx, cy, r, cx, cy, r * 6);
    aura.addColorStop(0, `rgba(${this.glow},${(0.3 * (0.3 + breath)).toFixed(3)})`);
    aura.addColorStop(1, `rgba(${this.glow},0)`);
    ctx.fillStyle = aura;
    ctx.fillRect(cx - r * 7, cy - r * 7, r * 14, r * 14);
    const body = new Path2D();
    for (const cell of cells)
      body.addPath(hexagon(cell.x, cell.y, r * (1.02 + 0.08 * hash(cell.seed, 43)), 0.38));
    ctx.save();
    ctx.translate(1.2, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill(body);
    ctx.restore();
    const wall = ctx.createLinearGradient(cx - r * 3, cy - r * 3, cx + r * 3, cy + r * 3);
    wall.addColorStop(0, this.palette.wallLit);
    wall.addColorStop(0.45, this.palette.wall);
    wall.addColorStop(1, this.palette.wallDeep);
    ctx.fillStyle = wall;
    ctx.fill(body);
    for (const cell of cells) {
      const rad = r * (cell.core ? 0.8 : 0.7) * (0.93 + 0.12 * hash(cell.seed, 41));
      const chamber = hexagon(
        cell.x,
        cell.y,
        rad,
        0.42,
        (k) => 1 + 0.04 * noise(k * 1.7 + t * 0.35, cell.seed),
      );
      const e = Math.min(
        1.5,
        cell.core ? 0.35 + 0.8 * breath : 0.1 + 0.12 * mind.wake + cell.energy * 0.85,
      );
      ctx.fillStyle = this.palette.chamber;
      ctx.fill(chamber);
      const light = ctx.createRadialGradient(
        cell.x + rad * 0.1,
        cell.y + rad * 0.25,
        0,
        cell.x,
        cell.y,
        rad * 1.1,
      );
      light.addColorStop(
        0,
        `rgba(${cell.core ? this.coreHot : this.cellHot},${Math.min(1, e).toFixed(3)})`,
      );
      light.addColorStop(0.5, `rgba(${this.glow},${Math.min(1, e * 0.7).toFixed(3)})`);
      light.addColorStop(1, `rgba(${this.glow},0)`);
      ctx.fillStyle = light;
      ctx.fill(chamber);
      const shade = ctx.createLinearGradient(cell.x, cell.y - rad, cell.x, cell.y + rad * 0.2);
      shade.addColorStop(0, 'rgba(0,0,0,0.65)');
      shade.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shade;
      ctx.fill(chamber);
      ctx.strokeStyle = `rgba(${this.glow},${Math.min(0.95, 0.3 + e * 0.5).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.stroke(chamber);
    }
    // The comb's outer walls catch the light on its upper left.
    ctx.lineCap = 'round';
    for (const cell of cells) {
      for (let k = 0; k < 6; k++) {
        const na = ((k * 60 - 60) * Math.PI) / 180;
        const nx = Math.cos(na);
        const ny = Math.sin(na);
        const ox = cell.x + nx * r * Math.sqrt(3);
        const oy = cell.y + ny * r * Math.sqrt(3);
        if (cells.some((o) => Math.hypot(o.x - ox, o.y - oy) < r * 0.3)) continue;
        const lit = Math.max(0, nx * -0.53 + ny * -0.85);
        const a0 = ((k * 60 - 90) * Math.PI) / 180;
        const a1 = ((k * 60 - 30) * Math.PI) / 180;
        ctx.strokeStyle = `rgba(${this.spec},${(0.03 + 0.24 * lit * lit).toFixed(3)})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(
          cell.x + r * 0.97 * Math.cos(a0) + nx * 0.5,
          cell.y + r * 0.97 * Math.sin(a0) + ny * 0.5,
        );
        ctx.lineTo(
          cell.x + r * 0.97 * Math.cos(a1) + nx * 0.5,
          cell.y + r * 0.97 * Math.sin(a1) + ny * 0.5,
        );
        ctx.stroke();
        ctx.strokeStyle = `rgba(${this.glow},${(0.35 * (1 - lit)).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // Sparks of thought, running between the chambers along curved threads.
    ctx.globalCompositeOperation = 'lighter';
    for (const spark of mind.sparks) {
      const seg = Math.min(Math.floor(spark.u), spark.path.length - 2);
      const f = spark.u - seg;
      const a = cells[spark.path[seg]!]!;
      const b = cells[spark.path[seg + 1]!]!;
      const bx = (a.x + b.x) / 2 + (b.y - a.y) * 0.22;
      const by = (a.y + b.y) / 2 - (b.x - a.x) * 0.22;
      const at = (u: number): [number, number] => [
        (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * bx + u * u * b.x,
        (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * by + u * u * b.y,
      ];
      const [x, y] = at(f);
      const [x0, y0] = at(Math.max(0, f - 0.7));
      const [xm, ym] = at(Math.max(0, f - 0.35));
      const trail = ctx.createLinearGradient(x0, y0, x, y);
      trail.addColorStop(0, `rgba(${this.thought},0)`);
      trail.addColorStop(1, `rgba(${this.thought},0.9)`);
      ctx.strokeStyle = trail;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(xm, ym, x, y);
      ctx.stroke();
      const head = ctx.createRadialGradient(x, y, 0, x, y, 5);
      head.addColorStop(0, `rgba(${this.spec},0.95)`);
      head.addColorStop(0.35, `rgba(${this.thought},0.55)`);
      head.addColorStop(1, `rgba(${this.thought},0)`);
      ctx.fillStyle = head;
      ctx.fillRect(x - 5, y - 5, 10, 10);
    }
    const core = cells.find((c) => c.core);
    if (core) {
      const hot = Math.min(1, Math.max(0, (breath - 0.45) * 1.5)) * mind.wake;
      const heart = ctx.createRadialGradient(core.x, core.y + r * 0.1, 0, core.x, core.y, r * 0.6);
      heart.addColorStop(0, `rgba(${this.spec},${(0.8 * hot).toFixed(3)})`);
      heart.addColorStop(0.5, `rgba(${this.coreHot},${(0.4 * hot).toFixed(3)})`);
      heart.addColorStop(1, `rgba(${this.coreHot},0)`);
      ctx.fillStyle = heart;
      ctx.fillRect(core.x - r, core.y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  /**
   * Turning on: the blackout closing on the Mind, its rim crimson and wet; covered, the window as
   * one picture taken once (pushed out by the shockwave), the Mind's heat, then the tear from it,
   * its ring of light and a flash.
   */
  arrival(ctx: CanvasRenderingContext2D, scene: ArrivalScene): void {
    const { width, height, mind } = scene;
    const [mx, my] = scene.at;
    const span = Math.max(width, height);
    const view = scene.view();
    const t = scene.t;
    const drawMind = () => {
      ctx.save();
      ctx.translate(mx, my);
      ctx.scale(scene.mindScale, scene.mindScale);
      this.mind(ctx, mind, t);
      ctx.restore();
    };
    if (t < ARRIVAL.cover) {
      const rim = blackout(mx, my, view.holeX, view.holeY, 0.16, 9, t);
      ctx.fillStyle = this.palette.ink;
      ctx.beginPath();
      ctx.rect(-10, -10, width + 20, height + 20);
      trace(ctx, rim);
      ctx.fill('evenodd');
      this.lip(ctx, rim, 0, span);
      drawMind();
      return;
    }
    if (!this.covered) {
      ctx.fillStyle = this.palette.ink;
      ctx.fillRect(-10, -10, width + 20, height + 20);
      drawMind();
      this.covered = document.createElement('canvas');
      this.covered.width = ctx.canvas.width;
      this.covered.height = ctx.canvas.height;
      this.covered.getContext('2d')?.drawImage(ctx.canvas, 0, 0);
    } else {
      const m = ctx.getTransform();
      const k = view.push;
      const dx = m.a * mx + m.e;
      const dy = m.d * my + m.f;
      ctx.save();
      ctx.setTransform(k, 0, 0, k, dx - dx * k, dy - dy * k);
      ctx.drawImage(this.covered, 0, 0);
      ctx.restore();
    }
    const reach = mind.reach * scene.mindScale;
    if (view.heat > 0) {
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, reach * 1.6);
      g.addColorStop(0, `rgba(${this.spec},${(0.85 * view.heat).toFixed(3)})`);
      g.addColorStop(0.18, `rgba(${this.cellHot},${(0.7 * view.heat).toFixed(3)})`);
      g.addColorStop(0.55, `rgba(${this.glow},${(0.35 * view.heat).toFixed(3)})`);
      g.addColorStop(1, `rgba(${this.glow},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(mx - reach * 1.7, my - reach * 1.7, reach * 3.4, reach * 3.4);
    }
    if (view.boom <= 0) return;
    const e = 1 - Math.pow(1 - view.boom, 2.6);
    const tear = blackout(mx, my, view.tear, view.tear, 0.08 + 0.24 * e, 19, t * 3);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    trace(ctx, tear);
    ctx.fill();
    ctx.restore();
    this.lip(ctx, tear, 1 - view.boom, span);
    // The shockwave: a ring of crimson light ahead of the tear, over the new look.
    const ring = view.tear * 1.08 + span * 0.02;
    const g = ctx.createRadialGradient(
      mx,
      my,
      Math.max(0, ring - span * 0.05),
      mx,
      my,
      ring + span * 0.02,
    );
    g.addColorStop(0, `rgba(${this.glow},0)`);
    g.addColorStop(0.7, `rgba(${this.cellHot},${((1 - view.boom) * 0.55).toFixed(3)})`);
    g.addColorStop(1, `rgba(${this.glow},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    const flash = Math.max(0, 1 - view.boom * 3);
    if (flash > 0) {
      const f = ctx.createRadialGradient(mx, my, 0, mx, my, view.tear * 0.9 + 1);
      f.addColorStop(0, `rgba(${this.spec},${(0.35 * flash).toFixed(3)})`);
      f.addColorStop(1, `rgba(${this.glow},0)`);
      ctx.fillStyle = f;
      ctx.fillRect(0, 0, width, height);
    }
  }

  /** The ink's rolled edge: crimson on its shadowed side, a white catch where it faces the light. */
  private lip(
    ctx: CanvasRenderingContext2D,
    points: readonly (readonly [number, number, number])[],
    hot: number,
    span: number,
  ): void {
    const w = Math.max(2, span * 0.006);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(${this.glow},${(0.45 + 0.45 * hot).toFixed(3)})`;
    ctx.lineWidth = w * (1 + hot * 2);
    ctx.beginPath();
    trace(ctx, points);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${this.spec},${(0.5 + 0.35 * hot).toFixed(3)})`;
    ctx.lineWidth = w * 0.45;
    ctx.beginPath();
    let open = false;
    for (const [x, y, a] of points) {
      // The hole's edge on its lower right faces the light from the upper left.
      const lit = Math.cos(a - Math.atan2(0.8, 0.5)) > 0.5;
      if (lit && !open) ctx.moveTo(x, y);
      else if (lit) ctx.lineTo(x, y);
      open = lit;
    }
    ctx.stroke();
  }
}

/** A rounded hexagon, a point up, its corners wobbling a little with `wobble(k)`. */
function hexagon(
  cx: number,
  cy: number,
  rad: number,
  round: number,
  wobble?: (k: number) => number,
): Path2D {
  const corners = Array.from({ length: 6 }, (_, k) => {
    const a = ((k * 60 - 90) * Math.PI) / 180;
    const r = rad * (wobble ? wobble(k) : 1);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  });
  const path = new Path2D();
  corners.forEach(([x, y], k) => {
    const [x0, y0] = corners[(k + 5) % 6]!;
    const [x1, y1] = corners[(k + 1) % 6]!;
    const ax = x + (x0 - x) * round;
    const ay = y + (y0 - y) * round;
    if (k === 0) path.moveTo(ax, ay);
    else path.lineTo(ax, ay);
    path.quadraticCurveTo(x, y, x + (x1 - x) * round, y + (y1 - y) * round);
  });
  path.closePath();
  return path;
}

/** An uneven loop of liquid edge round (cx, cy): points and their angles. */
function blackout(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  wobble: number,
  seed: number,
  t: number,
): [number, number, number][] {
  const n = 120;
  return Array.from({ length: n + 1 }, (_, j) => {
    const a = (j / n) * TAU;
    const m = j % n;
    const f =
      1 +
      wobble * (0.6 * noise(m * 0.21 + t * 0.8, seed) + 0.4 * noise(m * 0.55 - t * 1.3, seed + 1));
    return [cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f, a];
  });
}

function trace(
  ctx: CanvasRenderingContext2D,
  points: readonly (readonly [number, number, number])[],
): void {
  points.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/**
 * Draws a `width` × `height` scene on `canvas` at the device's pixel ratio times `scale`: whole and
 * centred (`contain`), or covering it from its bottom (`bottom`, the sidenav's).
 */
export function paint(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  how: 'contain' | 'bottom',
  scale: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  const box = canvas.getBoundingClientRect();
  const dpr = (window.devicePixelRatio || 1) * scale;
  const cw = Math.max(1, Math.round(box.width * dpr));
  const ch = Math.max(1, Math.round(box.height * dpr));
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;
  const k =
    how === 'contain' ? Math.min(cw / width, ch / height) : Math.max(cw / width, ch / height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(
    k,
    0,
    0,
    k,
    (cw - width * k) / 2,
    how === 'bottom' ? ch - height * k : (ch - height * k) / 2,
  );
  draw(ctx);
}
