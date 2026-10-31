// Hive mode's art drawn on a canvas (V82; decisions 632, 665–666): the machined Hive Mind, its
// plates lit from the upper left like the pages' sheen and its chambers lit crimson from within;
// the question's circuit board; the arrival's blackout and boom. The colours are `hive.css`'s
// (`.hive-art`), read once.
import {
  ARRIVAL,
  noise,
  pointAt,
  TAIL,
  type ArrivalScene,
  type Line,
  type Mind,
  type QuestionScene,
  type Trace,
} from './hive-art.js';

/** Hive's art colours, `#rrggbb`, from `hive.css`'s custom properties on the canvas. */
export interface Palette {
  ink: string;
  glow: string;
  lamp: string;
  lampHot: string;
  spec: string;
  heat: string;
  metalLit: string;
  metal: string;
  metalDeep: string;
  bevel: string;
  glass: string;
  board: string;
}

const PROPERTIES: Record<keyof Palette, string> = {
  ink: '--art-ink',
  glow: '--art-glow',
  lamp: '--art-lamp',
  lampHot: '--art-lamp-hot',
  spec: '--art-spec',
  heat: '--art-heat',
  metalLit: '--art-metal-lit',
  metal: '--art-metal',
  metalDeep: '--art-metal-deep',
  bevel: '--art-bevel',
  glass: '--art-glass',
  board: '--art-board',
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

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** Where the light comes from: the upper left, as the pages' sheen. */
const LIGHT = [-0.55, -0.83] as const;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
/** An alpha for `rgba()`, clamped to 0–1. */
const alpha = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x).toFixed(3);
const outCubic = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/** A hexagon, a point up (turned by `turn`), added to `path`. */
function hexagon(x: number, y: number, r: number, path = new Path2D(), turn = 0): Path2D {
  for (let k = 0; k < 6; k++) {
    const a = turn + (k * 60 - 90) * DEG;
    if (k) path.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    else path.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  path.closePath();
  return path;
}

/** The part of a line from arc length `a` to `b`, added to the current path. */
function span(ctx: CanvasRenderingContext2D, line: Line, a: number, b: number): void {
  const [x0, y0] = pointAt(line.points, line.arcs, a);
  ctx.moveTo(x0, y0);
  line.points.forEach(([x, y], i) => {
    if (line.arcs[i]! > a && line.arcs[i]! < b) ctx.lineTo(x, y);
  });
  const [x1, y1] = pointAt(line.points, line.arcs, b);
  ctx.lineTo(x1, y1);
}

/** How Hive's machine takes the light: gunmetal, bevelled; crimson lamps; white-hot at the core. */
export class Painter {
  private readonly palette: Palette;
  private readonly glow: string;
  private readonly lamp: string;
  private readonly lampHot: string;
  private readonly spec: string;
  private readonly heat: string;
  private readonly bevel: string;
  private covered: HTMLCanvasElement | null = null;
  /** The board's etched honeycomb, made once for its scene. */
  private etched: { scene: QuestionScene; path: Path2D } | null = null;

  constructor(palette: Palette) {
    this.palette = palette;
    this.glow = rgb(palette.glow);
    this.lamp = rgb(palette.lamp);
    this.lampHot = rgb(palette.lampHot);
    this.spec = rgb(palette.spec);
    this.heat = rgb(palette.heat);
    this.bevel = rgb(palette.bevel);
  }

  /**
   * The question's head (decision 665): the etched board lit from the middle out, its sides in
   * shadow, the targeting ring, the stubs and the traces drawn in from the edges, the Mind, then
   * the light: pads where traces landed, packets running in and orders running out.
   */
  question(ctx: CanvasRenderingContext2D, scene: QuestionScene, t: number): void {
    const { mind, width, height } = scene;
    const { cx, cy } = mind;
    if (this.etched?.scene !== scene) {
      const path = new Path2D();
      for (const [x, y] of scene.etch.centres) hexagon(x, y, scene.etch.r, path);
      this.etched = { scene, path };
    }
    const reach = 30 + 330 * outCubic(t / 1.3);
    const etch = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    etch.addColorStop(0, `rgba(${this.lamp},0.09)`);
    etch.addColorStop(0.6, `rgba(${this.lamp},0.035)`);
    etch.addColorStop(1, `rgba(${this.lamp},0)`);
    ctx.strokeStyle = etch;
    ctx.lineWidth = 1;
    ctx.stroke(this.etched.path);
    for (const right of [false, true]) {
      const shade = ctx.createLinearGradient(right ? width : 0, 0, right ? width - 60 : 60, 0);
      shade.addColorStop(0, 'rgba(0,0,0,0.55)');
      shade.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shade;
      ctx.fillRect(right ? width - 60 : 0, 0, 60, height);
    }
    this.ring(ctx, cx, cy, scene.ring, t, Math.min(1, Math.max(0, (t - 0.05) / 0.6)));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stub of scene.stubs) {
      const drawn = scene.drawn(stub, t);
      if (drawn <= 0) continue;
      ctx.strokeStyle = `rgba(${this.lamp},0.26)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      span(ctx, stub, 0, drawn * stub.length);
      ctx.stroke();
      if (drawn >= 1) this.via(ctx, stub.points.at(-1)!);
    }
    for (const trace of scene.traces) {
      const drawn = scene.drawn(trace, t);
      if (drawn <= 0) continue;
      const head = drawn * trace.length;
      ctx.beginPath();
      span(ctx, trace, 0, head);
      ctx.strokeStyle = `rgba(${this.glow},0.12)`;
      ctx.lineWidth = 4.5;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${this.lamp},0.6)`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      for (let i = 1; i < trace.points.length - 1 && trace.arcs[i]! <= head; i += 2) {
        this.via(ctx, trace.points[i]!);
      }
      if (drawn < 1) {
        const [x, y] = pointAt(trace.points, trace.arcs, head);
        this.spot(ctx, x, y, 9, this.spec, 0.95, this.lamp, 0.6);
      }
    }
    this.mind(ctx, mind, t);
    ctx.globalCompositeOperation = 'lighter';
    for (const trace of scene.traces) {
      if (t < trace.landed) continue;
      const [px, py] = trace.points.at(-1)!;
      const flash = (t - trace.landed) / 0.35;
      if (flash < 1) {
        this.spot(ctx, px, py, 4 + 12 * flash, this.spec, 1 - flash, this.lamp, 0.5 * (1 - flash));
      }
      ctx.fillStyle = `rgba(${this.lamp},0.85)`;
      ctx.fillRect(px - (trace.side < 0 ? 3 : 0), py - 3, 3, 6);
      for (const s of scene.packets(trace, t)) this.packet(ctx, trace, s, s - TAIL, this.lampHot);
      for (const s of scene.orders(trace, t)) this.packet(ctx, trace, s, s + 14, this.spec);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * The Hive Mind (decision 666): its aura, then each cell a gunmetal plate (lit from the upper
   * left, its edges bevelled) round a chamber of dark glass lit crimson from within; the core's
   * chamber white-hot at its lens.
   */
  mind(ctx: CanvasRenderingContext2D, mind: Mind, t: number): void {
    const { cx, cy, r } = mind;
    const breath = mind.breath(t);
    const awake = mind.awake(t);
    const aura = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 6.4);
    aura.addColorStop(0, `rgba(${this.glow},${alpha(0.28 * awake * (0.5 + 0.5 * breath))})`);
    aura.addColorStop(1, `rgba(${this.glow},0)`);
    ctx.fillStyle = aura;
    ctx.fillRect(cx - r * 6.8, cy - r * 6.8, r * 13.6, r * 13.6);
    ctx.lineWidth = 1;
    for (const [i, cell] of mind.cells.entries()) {
      const { x, y } = cell;
      const plateR = r - 1.15;
      const plate = hexagon(x, y, plateR);
      ctx.save();
      ctx.translate(0.8, 1.6);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fill(plate);
      ctx.restore();
      const metal = ctx.createLinearGradient(
        x - plateR * 0.6,
        y - plateR,
        x + plateR * 0.6,
        y + plateR,
      );
      metal.addColorStop(0, this.palette.metalLit);
      metal.addColorStop(0.5, this.palette.metal);
      metal.addColorStop(1, this.palette.metalDeep);
      ctx.fillStyle = metal;
      ctx.fill(plate);
      // The bevel: the edges facing the light catch it, the others fall into shadow.
      const edgeR = plateR - 0.55;
      for (let k = 0; k < 6; k++) {
        const a0 = (k * 60 - 90) * DEG;
        const a1 = (k * 60 - 30) * DEG;
        const normal = (k * 60 - 60) * DEG;
        const lit = Math.cos(normal) * LIGHT[0] + Math.sin(normal) * LIGHT[1];
        ctx.strokeStyle =
          lit > 0.05
            ? `rgba(${this.bevel},${alpha(0.1 + 0.5 * lit * lit)})`
            : `rgba(0,0,0,${alpha(0.5 - 0.4 * lit)})`;
        ctx.beginPath();
        ctx.moveTo(x + edgeR * Math.cos(a0), y + edgeR * Math.sin(a0));
        ctx.lineTo(x + edgeR * Math.cos(a1), y + edgeR * Math.sin(a1));
        ctx.stroke();
      }
      const core = i === mind.core;
      const chamberR = plateR * (core ? 0.68 : 0.54);
      const chamber = hexagon(x, y, chamberR);
      ctx.fillStyle = this.palette.glass;
      ctx.fill(chamber);
      const on = mind.on(i, t);
      const e =
        on * Math.min(1.35, (core ? 0.4 + 0.6 * breath : 0.2 + 0.12 * awake) + mind.energy(i, t));
      if (e > 0.01) {
        const light = ctx.createRadialGradient(x, y - chamberR * 0.1, 0, x, y, chamberR * 1.05);
        light.addColorStop(0, `rgba(${core ? this.spec : this.lampHot},${alpha(e * 0.95)})`);
        light.addColorStop(0.45, `rgba(${this.lamp},${alpha(e * 0.8)})`);
        light.addColorStop(1, `rgba(${this.glow},${alpha(e * 0.18)})`);
        ctx.fillStyle = light;
        ctx.fill(chamber);
      }
      ctx.strokeStyle = `rgba(${this.lamp},${alpha(0.1 + 0.75 * Math.min(1, e))})`;
      ctx.stroke(chamber);
      if (core && on > 0) {
        const hot = Math.min(1, Math.max(0, (breath - 0.35) * 1.4)) * on;
        this.spot(ctx, x, y, chamberR * 0.7, '255,255,255', 0.9 * hot, this.spec, 0.45 * hot);
      }
    }
  }

  /** A targeting ring round the Mind, drawn in from the top (`shown`, 0–1): ticks, arcs turning. */
  ring(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    t: number,
    shown: number,
  ): void {
    const show = shown * shown * (3 - 2 * shown);
    if (show <= 0) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${this.lamp},0.2)`;
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + show * TAU);
    ctx.stroke();
    for (let k = 0; k < 60 && k / 60 <= show; k++) {
      const a = (k / 60) * TAU - Math.PI / 2;
      const long = k % 5 === 0;
      ctx.strokeStyle = `rgba(${this.lamp},${long ? 0.42 : 0.18})`;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r + 1.5), Math.sin(a) * (r + 1.5));
      ctx.lineTo(Math.cos(a) * (r + (long ? 5 : 3)), Math.sin(a) * (r + (long ? 5 : 3)));
      ctx.stroke();
    }
    const turn = t * 0.55;
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(${this.lamp},${alpha(0.75 * show)})`;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(0, 0, r - 3.5, turn + (k * TAU) / 3, turn + (k * TAU) / 3 + 0.42);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${this.lampHot},${alpha(0.35 * show)})`;
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 8, -turn * 0.7 + k * Math.PI, -turn * 0.7 + k * Math.PI + 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A via: a ring of copper-dark board round a hole. */
  private via(ctx: CanvasRenderingContext2D, [x, y]: readonly [number, number]): void {
    ctx.fillStyle = this.palette.board;
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** A soft round light at (x, y): `inner` at its middle, fading through `outer`. */
  private spot(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    inner: string,
    innerAlpha: number,
    outer: string,
    outerAlpha: number,
  ): void {
    if (innerAlpha <= 0 || radius <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(${inner},${alpha(innerAlpha)})`);
    g.addColorStop(0.3, `rgba(${outer},${alpha(outerAlpha)})`);
    g.addColorStop(1, `rgba(${outer},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  /** A signal on a trace: its head at `s`, its tail fading back to `from`. */
  private packet(
    ctx: CanvasRenderingContext2D,
    trace: Trace,
    s: number,
    from: number,
    colour: string,
  ): void {
    const a = Math.min(Math.max(from, 0), trace.length);
    const b = Math.min(Math.max(s, 0), trace.length);
    if (Math.abs(b - a) < 0.5) return;
    const [x0, y0] = pointAt(trace.points, trace.arcs, a);
    const [x1, y1] = pointAt(trace.points, trace.arcs, b);
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(${colour},0)`);
    g.addColorStop(1, `rgba(${colour},0.95)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = from > s ? 1.6 : 2;
    ctx.beginPath();
    span(ctx, trace, Math.min(a, b), Math.max(a, b));
    ctx.stroke();
    this.spot(ctx, x1, y1, 6, this.spec, 0.9, colour, 0.3);
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
      g.addColorStop(0.18, `rgba(${this.heat},${(0.7 * view.heat).toFixed(3)})`);
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
    g.addColorStop(0.7, `rgba(${this.heat},${((1 - view.boom) * 0.55).toFixed(3)})`);
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
 * Draws a `width` × `height` scene on `canvas` at the device's pixel ratio times `scale`, whole and
 * centred.
 */
export function paint(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  const box = canvas.getBoundingClientRect();
  const dpr = (window.devicePixelRatio || 1) * scale;
  const cw = Math.max(1, Math.round(box.width * dpr));
  const ch = Math.max(1, Math.round(box.height * dpr));
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;
  const k = Math.min(cw / width, ch / height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(k, 0, 0, k, (cw - width * k) / 2, (ch - height * k) / 2);
  draw(ctx);
}
