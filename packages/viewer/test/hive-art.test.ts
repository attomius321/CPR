import { describe, expect, it } from 'vitest';
import {
  ARRIVAL,
  arrivalScale,
  arrivalScene,
  JOIN_SECONDS,
  noise,
  questionScene,
  RISE_SECONDS,
  Rope,
  sidenavScene,
  Spring,
  type Plug,
} from '../src/ui/hive-art.js';

/** Steps a scene by `seconds` at `fps`, calling `each` after every step. */
function run(scene: { step(dt: number): void }, seconds: number, each?: () => void, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    scene.step(1 / fps);
    each?.();
  }
}

/** How far a plugged tendril's tip is from the wall of the cell it holds. */
const gap = (plug: Plug) =>
  Math.hypot(
    plug.rope.px[plug.rope.n - 1]! - plug.anchor[0],
    plug.rope.py[plug.rope.n - 1]! - plug.anchor[1],
  );

// Hive tentacles (decision 629): ropes of points following a living pose, springs and noise.
describe("Hive's tendrils", () => {
  it('move on noise that is smooth and bounded', () => {
    let last = noise(0, 3);
    for (let x = 0; x < 50; x += 0.001) {
      const n = noise(x, 3);
      expect(Math.abs(n)).toBeLessThanOrEqual(1);
      expect(Math.abs(n - last)).toBeLessThan(0.01);
      last = n;
    }
  });

  it('reach with springs that overshoot, then settle', () => {
    const spring = new Spring(0, 10, 0.3);
    spring.to = 1;
    let most = 0;
    run(spring, 3, () => (most = Math.max(most, spring.x)));
    expect(most).toBeGreaterThan(1.1);
    expect(Math.abs(spring.x - 1)).toBeLessThan(0.01);
  });

  it('trail at the tip: a rope follows its pose, its end last', () => {
    const rope = new Rope(10);
    for (let i = 0; i < 10; i++) {
      rope.tx[i] = 0;
      rope.ty[i] = -i * 10;
    }
    rope.step(1 / 60, 8, 0.4, 0, false);
    for (let i = 0; i < 10; i++) rope.tx[i] = i * 10;
    rope.step(1 / 60, 8, 0.4, 0, false);
    // Moved toward the new pose, the tip less than the middle.
    expect(rope.px[5]).toBeGreaterThan(0);
    expect(rope.px[9]! / 90).toBeLessThan(rope.px[5]! / 50);
    for (let k = 0; k < 180; k++) rope.step(1 / 60, 8, 0.4, 0, false);
    expect(rope.px[9]).toBeCloseTo(90, 0);
  });

  it('stay finite and near their box for minutes of the question', () => {
    const scene = questionScene();
    run(scene, 180, undefined, 30);
    for (const rope of [...scene.plugs, ...scene.frees].map((t) => t.rope)) {
      for (let i = 0; i < rope.n; i++) {
        expect(Number.isFinite(rope.px[i]) && Number.isFinite(rope.py[i])).toBe(true);
        expect(rope.px[i]).toBeGreaterThan(-200);
        expect(rope.px[i]).toBeLessThan(scene.width + 200);
        expect(rope.hw[i]).toBeGreaterThan(0);
      }
    }
  });

  it('swell and pinch along their length, and thin toward the tip', () => {
    // A plain taper bends one way all along; a swelling or a pinch turns its bend the other way.
    const turns = (widths: number[]) => {
      let count = 0;
      let last = 0;
      for (let i = 1; i < widths.length - 1; i++) {
        const bend = widths[i + 1]! - 2 * widths[i]! + widths[i - 1]!;
        if (Math.abs(bend) < 0.08) continue;
        if (last && Math.sign(bend) !== last) count++;
        last = Math.sign(bend);
      }
      return count;
    };
    for (const seconds of [1.5, 3, 8]) {
      const scene = questionScene();
      run(scene, seconds);
      for (const { rope } of [...scene.plugs, ...scene.frees]) {
        const widths = [...rope.hw];
        expect(turns(widths)).toBeGreaterThan(0);
        expect(widths.at(-1)).toBeLessThan(widths[0]!);
      }
    }
  });
});

// The question (decisions 630, 631): tendrils strike, grab the Hive Mind's cells and hold.
describe("The question's Hive Mind", () => {
  it('is a honeycomb whose every cell reaches the core', () => {
    const { mind } = questionScene();
    expect(mind.cells.length).toBeGreaterThan(12);
    for (const [i, a] of mind.cells.entries()) {
      for (const b of mind.cells.slice(i + 1)) {
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(mind.r * Math.sqrt(3) * 0.99);
      }
      const path = mind.pathToCore(i);
      expect(mind.cells[path.at(-1)!]!.core).toBe(true);
    }
  });

  it('is grabbed by every tendril within the join, and none lets go', () => {
    const scene = questionScene();
    run(scene, JOIN_SECONDS);
    expect(scene.plugs.length).toBeGreaterThan(5);
    for (const plug of scene.plugs) expect(plug.grabbed).toBe(true);
    let worst = 0;
    run(scene, 20, () => {
      for (const plug of scene.plugs) {
        expect(plug.grabbed).toBe(true);
        worst = Math.max(worst, gap(plug));
      }
    });
    // Pushed into its cell now and then, never pulled out of it.
    expect(worst).toBeLessThan(scene.mind.r * 0.6);
    for (const plug of scene.plugs) {
      const out = Math.hypot(plug.anchor[0] - scene.mind.cx, plug.anchor[1] - scene.mind.cy);
      const tip = Math.hypot(
        plug.rope.px[plug.rope.n - 1]! - scene.mind.cx,
        plug.rope.py[plug.rope.n - 1]! - scene.mind.cy,
      );
      expect(tip).toBeLessThanOrEqual(out + 0.5);
    }
  });

  it('is woken by the grabs: its cells light and sparks run to its core', () => {
    const scene = questionScene();
    expect(scene.mind.wake).toBe(0);
    let sparks = 0;
    run(scene, JOIN_SECONDS, () => (sparks = Math.max(sparks, scene.mind.sparks.length)));
    expect(scene.mind.wake).toBe(1);
    expect(sparks).toBeGreaterThan(0);
  });

  it('lives while open: goo strands form between tendrils and snap', () => {
    const scene = questionScene();
    let forms = 0;
    let snaps = 0;
    const before = scene.strands.map((s) => s.bridged);
    run(scene, 12, () =>
      scene.strands.forEach((s, i) => {
        if (s.bridged !== before[i]) {
          if (s.bridged) forms++;
          else snaps++;
          before[i] = s.bridged;
        }
      }),
    );
    expect(forms).toBeGreaterThan(3);
    expect(snaps).toBeGreaterThan(3);
  });
});

// The sidenav (decision 633): the same tendrils, rising as Hive arrives, then still.
describe("The sidenav's tendrils", () => {
  it('draw the same still frame each time', () => {
    const a = sidenavScene({ rise: false });
    const b = sidenavScene({ rise: false });
    a.settle();
    b.settle();
    expect([...a.tendrils[2]!.rope.px]).toEqual([...b.tendrils[2]!.rope.px]);
    expect(a.moving).toBe(false);
  });

  it('rise from below, overshoot, then settle within the rise', () => {
    const scene = sidenavScene({ rise: true });
    const tallest = scene.tendrils.reduce((a, b) => (b.length > a.length ? b : a));
    expect(tallest.len.x).toBeLessThan(tallest.length * 0.2);
    let most = 0;
    run(scene, RISE_SECONDS, () => (most = Math.max(most, tallest.len.x)));
    expect(most).toBeGreaterThan(tallest.length * 1.03);
    expect(Math.abs(tallest.len.x - tallest.length)).toBeLessThan(tallest.length * 0.02);
    expect(scene.moving).toBe(false);
  });
});

// Turning on (decision 632): the question's Mind grows to the middle, a blackout closes on it.
describe("Hive's arrival", () => {
  const at: [number, number] = [720, 373];

  it("grows the question's Mind to the middle of the window", () => {
    const scene = arrivalScene({ width: 1440, height: 900, at, scale: 1 });
    expect(scene.mindScale).toBeCloseTo(1, 5);
    run(scene, ARRIVAL.cover);
    const size = scene.mindScale * scene.mind.reach;
    expect(size).toBeGreaterThan(900 * 0.17);
    expect(size).toBeLessThan(900 * 0.23);
  });

  it('closes the blackout from every edge onto the Mind, and is covered by its end', () => {
    const scene = arrivalScene({ width: 1440, height: 900, at, scale: 1 });
    let last = Infinity;
    // Before the blackout closes, the window's corners and its middle are still open.
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
