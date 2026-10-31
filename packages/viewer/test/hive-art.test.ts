import { describe, expect, it } from 'vitest';
import {
  ARRIVAL,
  arrivalScale,
  arrivalScene,
  JOIN_SECONDS,
  Mind,
  questionScene,
  type QuestionScene,
  type Trace,
} from '../src/ui/hive-art.js';

/** Steps a scene by `seconds` at `fps`, calling `each` after every step. */
function run(scene: { step(dt: number): void }, seconds: number, each?: () => void, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    scene.step(1 / fps);
    each?.();
  }
}

/** Times from `a` to `b`, `fps` a second. */
const times = (a: number, b: number, fps = 30) =>
  Array.from({ length: Math.round((b - a) * fps) + 1 }, (_, i) => a + i / fps);

/** Whether a segment runs at a multiple of 45°. */
const octilinear = ([x0, y0]: readonly number[], [x1, y1]: readonly number[]) => {
  const dx = Math.abs(x1! - x0!);
  const dy = Math.abs(y1! - y0!);
  return dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6;
};

// The machined Hive Mind (decision 666): plates in a honeycomb round a core.
describe("Hive's Mind", () => {
  it('is a honeycomb of 19 cells round its core, each with a way in to it', () => {
    const mind = new Mind(260, 64);
    expect(mind.cells).toHaveLength(19);
    const core = mind.cells[mind.core]!;
    expect([core.x, core.y]).toEqual([260, 64]);
    for (const [i, a] of mind.cells.entries()) {
      for (const b of mind.cells.slice(i + 1)) {
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(mind.r * Math.sqrt(3) * 0.99);
      }
      const path = mind.pathToCore(i);
      expect(path.at(-1)).toBe(mind.core);
      path.slice(1).forEach((cell, k) => {
        const from = mind.cells[path[k]!]!;
        const to = mind.cells[cell]!;
        expect(to.ring).toBe(from.ring - 1);
        expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeCloseTo(mind.r * Math.sqrt(3), 6);
      });
    }
  });

  it('boots each cell with a flicker, the core first, every one on by the end of the join', () => {
    const { mind } = questionScene();
    const core = mind.cells[mind.core]!;
    for (const [i, cell] of mind.cells.entries()) {
      if (i !== mind.core) expect(cell.boot).toBeGreaterThan(core.boot);
      expect(mind.on(i, cell.boot - 0.01)).toBe(0);
      const first = times(cell.boot, cell.boot + 0.2, 240).map((t) => mind.on(i, t));
      // It goes dark again before it holds.
      expect(Math.min(...first.slice(first.indexOf(1)))).toBeLessThan(0.2);
      expect(cell.boot + 0.3).toBeLessThan(JOIN_SECONDS);
      for (const t of times(JOIN_SECONDS, 60, 4)) expect(mind.on(i, t)).toBe(1);
    }
  });

  it('lights the cell a signal reaches, then each cell in to the core, the core last', () => {
    const mind = new Mind(0, 0);
    const outer = mind.cells.findIndex((c) => c.ring === 2);
    mind.feed({ cell: outer, strength: 1, arrivals: (a, b) => (a <= 1 && 1 <= b ? [1] : []) });
    for (const i of mind.cells.keys()) expect(mind.energy(i, 0.99)).toBe(0);
    const path = mind.pathToCore(outer);
    // Each lights at its moment, later the farther in: its brightest moment, in steps of 1 ms.
    const peaks = path.map((cell) => {
      let best = 0;
      let when = 0;
      for (const t of times(0.95, 1.6, 1000)) {
        const e = mind.energy(cell, t);
        if (e > best) [best, when] = [e, t];
      }
      expect(best).toBeGreaterThan(0.4);
      return when;
    });
    for (let k = 1; k < peaks.length; k++) expect(peaks[k]).toBeGreaterThan(peaks[k - 1]!);
    expect(path.at(-1)).toBe(mind.core);
    // Cells off the signal's way stay dark.
    const off = mind.cells.findIndex((_, i) => !path.includes(i));
    expect(mind.energy(off, 1.2)).toBe(0);
  });
});

// The question's circuit board (decision 665).
describe("The question's circuit", () => {
  const port = (scene: QuestionScene, trace: Trace) => {
    const cell = scene.mind.cells[trace.cell]!;
    return [cell.x + (trace.side * scene.mind.r * Math.sqrt(3)) / 2, cell.y] as const;
  };

  it('routes ten traces, five a side, at 0° and 45° only, from beyond its side to its own cell', () => {
    const scene = questionScene();
    expect(scene.traces).toHaveLength(10);
    for (const side of [-1, 1]) expect(scene.traces.filter((t) => t.side === side)).toHaveLength(5);
    expect(new Set(scene.traces.map((t) => t.cell)).size).toBe(10);
    for (const trace of [...scene.traces, ...scene.stubs]) {
      trace.points.slice(1).forEach((p, k) => expect(octilinear(trace.points[k]!, p)).toBe(true));
      for (const [, y] of trace.points) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(scene.height);
      }
      expect(trace.arcs.at(-1)).toBeCloseTo(trace.length, 9);
    }
    for (const trace of scene.traces) {
      const [x0] = trace.points[0]!;
      expect(trace.side < 0 ? x0 <= 0 : x0 >= scene.width).toBe(true);
      const cell = scene.mind.cells[trace.cell]!;
      expect(cell.ring).toBe(2);
      expect((cell.x - scene.mind.cx) * trace.side).toBeGreaterThan(0);
      const [px, py] = trace.points.at(-1)!;
      const [ex, ey] = port(scene, trace);
      expect(Math.hypot(px - ex, py - ey)).toBeLessThan(1e-6);
    }
  });

  it('draws each line from its edge, whole by the end of the join, and never undraws it', () => {
    const scene = questionScene();
    for (const line of [...scene.traces, ...scene.stubs]) {
      expect(scene.drawn(line, 0)).toBe(0);
      let last = 0;
      for (const t of times(0, 30)) {
        const drawn = scene.drawn(line, t);
        expect(drawn).toBeGreaterThanOrEqual(last);
        last = drawn;
      }
      expect(scene.drawn(line, JOIN_SECONDS)).toBe(1);
    }
  });

  it('lights the cell each trace lands on', () => {
    const scene = questionScene();
    for (const trace of scene.traces) {
      const before = scene.mind.energy(trace.cell, trace.landed - 0.02);
      expect(scene.mind.energy(trace.cell, trace.landed + 0.02)).toBeGreaterThan(before + 0.5);
    }
  });

  it('runs packets in and orders out once joined, none before, still an hour later', () => {
    const scene = questionScene();
    for (const t of times(0, JOIN_SECONDS)) {
      for (const trace of scene.traces) {
        expect(scene.packets(trace, t)).toEqual([]);
        expect(scene.orders(trace, t)).toEqual([]);
      }
    }
    for (const trace of scene.traces) {
      let packets = 0;
      let orders = 0;
      for (const t of times(JOIN_SECONDS, JOIN_SECONDS + 60)) {
        const now = scene.packets(trace, t);
        const later = scene.packets(trace, t + 1 / 30);
        // A packet starts at the edge (its head) and moves in, one at a time per trace here.
        if (now.length === 0 && later.length > 0 && later[0]! < 20) packets++;
        if (scene.orders(trace, t).length === 0 && scene.orders(trace, t + 1 / 30).length > 0)
          orders++;
        for (const s of [...now, ...scene.orders(trace, t)]) {
          expect(s).toBeGreaterThan(-30);
          expect(s).toBeLessThan(trace.length + 30);
        }
      }
      expect(packets).toBeGreaterThan(15);
      expect(orders).toBeGreaterThan(3);
      // A packet arriving lights the cell.
      const arrive = trace.packets.at(0) + trace.length / trace.speed;
      expect(scene.mind.energy(trace.cell, arrive + 0.02)).toBeGreaterThan(
        scene.mind.energy(trace.cell, arrive - 0.02) + 0.4,
      );
    }
    // An hour open: still running.
    const hour = times(3600, 3610).flatMap((t) =>
      scene.traces.flatMap((tr) => scene.packets(tr, t)),
    );
    expect(hour.length).toBeGreaterThan(50);
    expect(hour.every(Number.isFinite)).toBe(true);
  });

  it('gives the same state at the same time, whatever came before', () => {
    const scene = questionScene();
    const state = (t: number) =>
      JSON.stringify([
        scene.mind.cells.map((_, i) => [scene.mind.energy(i, t), scene.mind.on(i, t)]),
        scene.mind.breath(t),
        scene.traces.map((tr) => [scene.drawn(tr, t), scene.packets(tr, t), scene.orders(tr, t)]),
      ]);
    const a = state(30.5);
    state(1.2);
    state(400);
    expect(state(30.5)).toBe(a);
    expect(questionScene().traces.map((tr) => questionScene().packets(tr, 30.5))).toEqual(
      scene.traces.map((tr) => scene.packets(tr, 30.5)),
    );
  });
});

// Turning on (decisions 632, 673): the question's Mind grows to the middle while a honeycomb
// shutter closes on it and traces route into it; covered, it flares; the shutter opens from it.
describe("Hive's arrival", () => {
  const at: [number, number] = [720, 373];
  const windows = [
    [1440, 900],
    [2560, 1440],
    [800, 600],
    [700, 1000],
  ] as const;

  it("grows the question's Mind, awake, to the middle of the window", () => {
    const scene = arrivalScene({ width: 1440, height: 900, at, scale: 1 });
    expect(scene.mindScale).toBeCloseTo(1, 5);
    expect(scene.mind.cells).toHaveLength(19);
    for (const i of scene.mind.cells.keys()) expect(scene.mind.on(i, 0)).toBe(1);
    run(scene, ARRIVAL.cover);
    const size = scene.mindScale * scene.mind.reach;
    expect(size).toBeGreaterThan(900 * 0.17);
    expect(size).toBeLessThan(900 * 0.23);
  });

  it('closes from every edge onto the Mind, and is covered by its end', () => {
    const scene = arrivalScene({ width: 1440, height: 900, at, scale: 1 });
    let last = Infinity;
    // Before it closes, the window's corners and its middle are still open.
    const first = scene.view();
    expect(first.holeX).toBeGreaterThan(Math.hypot(720, 450));
    run(scene, ARRIVAL.cover - 0.02, () => {
      const { holeX, holeY } = scene.view();
      expect(holeX).toBeLessThanOrEqual(last + 1e-6);
      last = holeX;
      expect(holeY).toBeGreaterThan(0);
      expect(scene.covered).toBe(false);
    });
    expect(last).toBeLessThan(scene.mindScale * scene.mind.reach);
    run(scene, 0.04);
    expect(scene.covered).toBe(true);
    // Covered until the boom; then it tears open from the Mind and is done.
    run(scene, ARRIVAL.hold);
    expect(scene.covered).toBe(false);
    expect(scene.view().tear).toBeGreaterThan(0);
    run(scene, ARRIVAL.end);
    expect(scene.done).toBe(true);
  });

  it('has a shutter of hex tiles that covers the whole window', () => {
    for (const [width, height] of windows) {
      const scene = arrivalScene({ width, height, at: [width / 2, height / 2.4], scale: 1 });
      const { centres, r } = scene.tiles;
      expect(centres.length).toBeLessThan(800);
      for (let x = 0; x <= width; x += width / 40) {
        for (let y = 0; y <= height; y += height / 40) {
          const nearest = Math.min(...centres.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
          // Every point of the window in a tile: within r of its nearest tile's centre.
          expect(nearest).toBeLessThanOrEqual(r + 1e-6);
        }
      }
    }
  });

  it('shuts its tiles from the edges in, never one back open, all shut once covered', () => {
    const scene = arrivalScene({ width: 1440, height: 900, at, scale: 1 });
    const { centres } = scene.tiles;
    let last = centres.map((_, i) => scene.shut(i));
    expect(Math.max(...last)).toBe(0);
    const firstShut = centres.map(() => Infinity);
    run(scene, ARRIVAL.cover - 0.02, () => {
      const now = centres.map((_, i) => scene.shut(i));
      now.forEach((s, i) => {
        expect(s).toBeGreaterThanOrEqual(last[i]! - 1e-9);
        if (s > 0 && firstShut[i] === Infinity) firstShut[i] = scene.t;
      });
      last = now;
    });
    // A corner's tile before the one under the Mind.
    const corner = centres.findIndex(([x, y]) => Math.hypot(x, y) < scene.tiles.r * 2);
    const middle = centres.findIndex(([x, y]) => Math.hypot(x - at[0], y - at[1]) < scene.tiles.r);
    expect(firstShut[corner]).toBeLessThan(firstShut[middle]!);
    run(scene, 0.04);
    expect(scene.covered).toBe(true);
    for (const i of centres.keys()) expect(scene.shut(i)).toBe(1);
  });

  it('opens its tiles from the Mind out at the boom, and none is left by its end', () => {
    const scene = arrivalScene({ width: 1440, height: 900, at, scale: 1 });
    run(scene, ARRIVAL.cover + ARRIVAL.hold);
    const { centres } = scene.tiles;
    let last = centres.map((_, i) => scene.shut(i));
    const firstOpen = centres.map(() => Infinity);
    run(scene, ARRIVAL.boom + 0.1, () => {
      const now = centres.map((_, i) => scene.shut(i));
      now.forEach((s, i) => {
        expect(s).toBeLessThanOrEqual(last[i]! + 1e-9);
        if (s < 1 && firstOpen[i] === Infinity) firstOpen[i] = scene.t;
      });
      last = now;
    });
    const far = (i: number) => Math.hypot(centres[i]![0] - at[0], centres[i]![1] - at[1]);
    const order = [...centres.keys()].sort((a, b) => far(a) - far(b));
    expect(firstOpen[order[0]!]).toBeLessThan(firstOpen[order.at(-1)!]!);
    run(scene, ARRIVAL.end);
    expect(scene.done).toBe(true);
    for (const i of centres.keys()) expect(scene.shut(i)).toBe(0);
  });

  it('routes traces at 0° and 45° from every edge onto the grown ring, drawn as the shutter closes', () => {
    for (const [width, height] of windows) {
      const mid: [number, number] = [width / 2, height / 2.4];
      const scene = arrivalScene({ width, height, at: mid, scale: 1 });
      expect(scene.traces.length).toBeGreaterThanOrEqual(16);
      const edges = new Set<string>();
      for (const trace of scene.traces) {
        trace.points.slice(1).forEach((p, k) => expect(octilinear(trace.points[k]!, p)).toBe(true));
        const [x0, y0] = trace.points[0]!;
        if (x0 <= 0) edges.add('left');
        if (x0 >= width) edges.add('right');
        if (y0 <= 0) edges.add('top');
        if (y0 >= height) edges.add('bottom');
        expect(x0 <= 0 || x0 >= width || y0 <= 0 || y0 >= height).toBe(true);
        const [x1, y1] = trace.points.at(-1)!;
        expect(Math.hypot(x1 - mid[0], y1 - mid[1])).toBeCloseTo(scene.ringRadius, 6);
      }
      expect([...edges].sort()).toEqual(['bottom', 'left', 'right', 'top']);
      let last = scene.traces.map((tr) => scene.reached(tr));
      expect(Math.max(...last)).toBe(0);
      run(scene, ARRIVAL.cover - 0.02, () => {
        const now = scene.traces.map((tr) => scene.reached(tr));
        now.forEach((r, i) => expect(r).toBeGreaterThanOrEqual(last[i]! - 1e-9));
        last = now;
      });
      run(scene, 0.04);
      for (const trace of scene.traces) expect(scene.reached(trace)).toBe(1);
    }
  });

  it('keeps its canvas under 0.9 megapixels', () => {
    for (const [w, h, dpr] of [
      [2560, 1440, 1],
      [1440, 900, 1],
      [1440, 900, 2],
      [800, 600, 1],
    ] as const) {
      const scale = arrivalScale(w, h, dpr);
      expect(w * dpr * scale * (h * dpr * scale)).toBeLessThanOrEqual(0.9e6 + 1);
      expect(scale).toBeLessThanOrEqual(1);
    }
    expect(arrivalScale(800, 600, 1)).toBe(1);
  });
});
