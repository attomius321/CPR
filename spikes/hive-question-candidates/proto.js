// Hive question candidates (prototype, never shipped): three robotic heads for the 520 x 128 art
// over "Turn on Hive mode?". Each is a pure function of time: draw(ctx, t) at any t.
window.HiveProto = (() => {
  const TAU = Math.PI * 2;
  const SQ3 = Math.sqrt(3);
  const DEG = Math.PI / 180;
  const W = 520;
  const H = 128;
  const CX = 260;
  const CY = 62;
  const R = 11;
  const JOIN = 1.6;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const outCubic = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const inOut = (x) => {
    x = clamp(x, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  };
  const outBack = (x, s = 1.4) => {
    x = clamp(x, 0, 1);
    return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
  };
  function hash(i, seed) {
    let h = Math.imul(i | 0, 374761393) ^ Math.imul((seed | 0) + 1, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const LED = '255,40,62';
  const HOT = '255,226,230';
  const GLOW = '232,28,44';
  const PINK = '255,140,152';
  const a3 = (x) => clamp(x, 0, 1).toFixed(3);

  /** 0 before t0, a fluorescent stutter, then 1. */
  const FLICK = [1, 0.15, 0.9, 0, 0.55, 1, 0.35, 1];
  function boot(t, t0, d = 0.22) {
    const u = t - t0;
    if (u <= 0) return 0;
    if (u >= d) return 1;
    return FLICK[Math.floor((u / d) * FLICK.length)];
  }

  function hexPath(x, y, r, rot = 0, path = new Path2D()) {
    for (let k = 0; k < 6; k++) {
      const a = rot + (k * 60 - 90) * DEG;
      const px = x + r * Math.cos(a);
      const py = y + r * Math.sin(a);
      if (k) path.lineTo(px, py);
      else path.moveTo(px, py);
    }
    path.closePath();
    return path;
  }

  // ---------- the machined comb: 19 plates round a core ----------

  function makeComb() {
    const cells = [];
    for (let q = -2; q <= 2; q++)
      for (let r = -2; r <= 2; r++) {
        if (Math.abs(q + r) > 2) continue;
        cells.push({
          q,
          r,
          ring: Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)),
          x: CX + R * SQ3 * (q + r / 2),
          y: CY + R * 1.5 * r,
          i: cells.length,
          events: [],
        });
      }
    const at = (q, r) => cells.find((c) => c.q === q && c.r === r);
    const core = at(0, 0);
    const toward = (c) =>
      cells
        .filter((o) => o.ring === c.ring - 1 && Math.hypot(o.x - c.x, o.y - c.y) < R * SQ3 * 1.05)
        .sort((a, b) => Math.abs(a.y - CY) - Math.abs(b.y - CY))[0];
    const kicks = [];
    /** A signal reaching `cell` at `time`: it lights, then each cell in to the core. */
    const fire = (cell, time, amp = 1) => {
      let c = cell;
      let at = time;
      let a = amp;
      while (c) {
        c.events.push([at, a]);
        if (c === core) kicks.push([at, a]);
        c = toward(c);
        at += 0.075;
        a *= 0.8;
      }
    };
    const energy = (c, t) => {
      let e = 0;
      for (const [te, a] of c.events) if (te <= t && t - te < 1.6) e += a * Math.exp(-(t - te) * 4.2);
      return e;
    };
    const breath = (t) => {
      let k = 0;
      for (const [te, a] of kicks) if (te <= t && t - te < 1.2) k += a * Math.exp(-(t - te) * 5);
      return 0.5 + 0.18 * Math.sin(t * 2.3) + 0.1 * Math.sin(t * 5.1 + 1) + 0.45 * k;
    };
    /** The port on a side cell: the middle of its outer vertical edge. */
    const port = (c, side) => [c.x + side * R * 0.866, c.y];
    return { cells, at, core, fire, energy, breath, port };
  }

  const LIGHT = [-0.55, -0.83];

  /** The comb: plates of gunmetal with bevelled edges, each chamber dark glass lit from within. */
  function drawComb(ctx, comb, t, o) {
    const breath = comb.breath(t);
    const wake = o.wake(t);
    // An aura behind it, as a lit machine has.
    const aura = ctx.createRadialGradient(CX, CY, 8, CX, CY, 70);
    aura.addColorStop(0, `rgba(${GLOW},${a3(0.28 * wake * (0.5 + 0.5 * breath))})`);
    aura.addColorStop(1, `rgba(${GLOW},0)`);
    ctx.fillStyle = aura;
    ctx.fillRect(CX - 75, CY - 75, 150, 150);
    for (const c of comb.cells) {
      const p = o.place ? o.place(c, t) : { x: c.x, y: c.y, s: 1, a: 1, rot: 0 };
      if (p.a <= 0.001) continue;
      const on = o.level(c, t);
      ctx.save();
      ctx.globalAlpha = p.a;
      const rp = (R - 1.15) * p.s;
      const plate = hexPath(p.x, p.y, rp, p.rot);
      ctx.save();
      ctx.translate(0.8, 1.6);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fill(plate);
      ctx.restore();
      const g = ctx.createLinearGradient(p.x - rp * 0.6, p.y - rp, p.x + rp * 0.6, p.y + rp);
      g.addColorStop(0, '#3b2f34');
      g.addColorStop(0.5, '#1e1619');
      g.addColorStop(1, '#0c0809');
      ctx.fillStyle = g;
      ctx.fill(plate);
      ctx.lineWidth = 1;
      const ri = rp - 0.55;
      for (let k = 0; k < 6; k++) {
        const a0 = p.rot + (k * 60 - 90) * DEG;
        const a1 = p.rot + (k * 60 - 30) * DEG;
        const na = p.rot + (k * 60 - 60) * DEG;
        const lit = Math.cos(na) * LIGHT[0] + Math.sin(na) * LIGHT[1];
        ctx.strokeStyle =
          lit > 0.05
            ? `rgba(214,186,194,${a3(0.1 + 0.5 * lit * lit)})`
            : `rgba(0,0,0,${a3(0.5 + 0.4 * -lit)})`;
        ctx.beginPath();
        ctx.moveTo(p.x + ri * Math.cos(a0), p.y + ri * Math.sin(a0));
        ctx.lineTo(p.x + ri * Math.cos(a1), p.y + ri * Math.sin(a1));
        ctx.stroke();
      }
      const isCore = c === comb.core;
      const rc = rp * (isCore ? 0.68 : 0.54);
      const chamber = hexPath(p.x, p.y, rc, p.rot);
      ctx.fillStyle = '#050102';
      ctx.fill(chamber);
      const e =
        on * Math.min(1.35, (isCore ? 0.4 + 0.6 * breath : 0.2 + 0.12 * wake) + comb.energy(c, t));
      if (e > 0.01) {
        const lg = ctx.createRadialGradient(p.x, p.y - rc * 0.1, 0, p.x, p.y, rc * 1.05);
        lg.addColorStop(0, `rgba(${isCore ? HOT : PINK},${a3(e * 0.95)})`);
        lg.addColorStop(0.45, `rgba(${LED},${a3(e * 0.8)})`);
        lg.addColorStop(1, `rgba(${GLOW},${a3(e * 0.18)})`);
        ctx.fillStyle = lg;
        ctx.fill(chamber);
      }
      ctx.strokeStyle = `rgba(${LED},${a3(0.1 + 0.75 * Math.min(1, e))})`;
      ctx.stroke(chamber);
      // The core's lens: a white-hot point and a fine ring.
      if (isCore && on > 0) {
        const hot = clamp((breath - 0.35) * 1.4, 0, 1) * on;
        const lens = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rc * 0.7);
        lens.addColorStop(0, `rgba(255,255,255,${a3(0.9 * hot)})`);
        lens.addColorStop(1, `rgba(${HOT},0)`);
        ctx.fillStyle = lens;
        ctx.fillRect(p.x - rc, p.y - rc, rc * 2, rc * 2);
      }
      ctx.restore();
    }
  }

  /** A targeting ring round the comb: drawn in from the top, ticks, two arcs turning. */
  function drawRing(ctx, t, from) {
    const show = smooth(from, from + 0.6, t);
    if (show <= 0) return;
    const r1 = 51;
    ctx.save();
    ctx.translate(CX, CY);
    const sweep = show * TAU;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${LED},0.2)`;
    ctx.beginPath();
    ctx.arc(0, 0, r1, -Math.PI / 2, -Math.PI / 2 + sweep);
    ctx.stroke();
    for (let k = 0; k < 60; k++) {
      const f = k / 60;
      if (f > show) break;
      const a = f * TAU - Math.PI / 2;
      const long = k % 5 === 0;
      const ro = r1 + (long ? 5 : 3);
      ctx.strokeStyle = `rgba(${LED},${long ? 0.42 : 0.18})`;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r1 + 1.5), Math.sin(a) * (r1 + 1.5));
      ctx.lineTo(Math.cos(a) * ro, Math.sin(a) * ro);
      ctx.stroke();
    }
    const spin = t * 0.55;
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(${LED},${a3(0.75 * show)})`;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(0, 0, r1 - 3.5, spin + (k * TAU) / 3, spin + (k * TAU) / 3 + 0.42);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${PINK},${a3(0.35 * show)})`;
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.arc(0, 0, r1 + 8, -spin * 0.7 + k * Math.PI, -spin * 0.7 + k * Math.PI + 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Darkness at both sides, where the machines come from. */
  function drawSides(ctx) {
    for (const side of [0, 1]) {
      const x0 = side ? W : 0;
      const g = ctx.createLinearGradient(x0, 0, side ? W - 60 : 60, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(side ? W - 60 : 0, 0, 60, H);
    }
  }

  // ---------- polylines ----------

  function measure(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++)
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return cum;
  }
  function pointAt(pts, cum, s) {
    s = clamp(s, 0, cum[cum.length - 1]);
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const tx = pts[i][0] - pts[i - 1][0];
    const ty = pts[i][1] - pts[i - 1][1];
    const l = Math.hypot(tx, ty) || 1;
    return [lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f), tx / l, ty / l];
  }
  /** The polyline from arc `a` to arc `b`. */
  function span(ctx, pts, cum, a, b) {
    const [x0, y0] = pointAt(pts, cum, a);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < pts.length; i++) if (cum[i] > a && cum[i] < b) ctx.lineTo(pts[i][0], pts[i][1]);
    const [x1, y1] = pointAt(pts, cum, b);
    ctx.lineTo(x1, y1);
  }

  /** Signals running along a path inward, on a seeded timetable after the join. */
  function timetable(seed, from, gap, spread, until = 40) {
    const times = [];
    let t = from + hash(seed, 3) * spread;
    for (let k = 0; t < until; k++) {
      times.push(t);
      t += gap * (0.7 + 0.8 * hash(seed * 31 + k, 5));
    }
    return times;
  }

  // ---------- A: circuit ----------

  function circuit() {
    const comb = makeComb();
    const leftCells = [
      [0, -2],
      [-1, -1],
      [-2, 0],
      [-2, 1],
      [-2, 2],
    ];
    const rightCells = [
      [2, -2],
      [2, -1],
      [2, 0],
      [1, 1],
      [0, 2],
    ];
    const L = [
      [[-4, 6], [60, 6], [74, 20], [176, 20], [187, 31]],
      [[-4, 36], [120, 36], [131.5, 47.5]],
      [[-4, 58], [40, 58], [46, 64]],
      [[-4, 92], [120, 92], [131.5, 80.5]],
      [[-4, 122], [60, 122], [74, 108], [176, 108], [187, 97]],
    ];
    const Rt = [
      [[524, 10], [452, 10], [431, 31]],
      [[524, 40], [380, 40], [372.5, 47.5]],
      [[524, 68], [470, 68], [466, 64]],
      [[524, 96], [400, 96], [384.5, 80.5]],
      [[524, 118], [452, 118], [431, 97]],
    ];
    const traces = [];
    const add = (route, cellQR, side, k) => {
      const cell = comb.at(...cellQR);
      const pts = [...route, comb.port(cell, side)];
      const cum = measure(pts);
      const len = cum[cum.length - 1];
      const start = 0.12 + k * 0.075;
      const dur = 0.62 + 0.0011 * len;
      const seed = 11 + k * 7;
      const pulses = timetable(seed, JOIN + 0.2, 2.2, 1.6);
      const orders = timetable(seed + 3, JOIN + 1.4, 6.5, 4);
      const speed = 230;
      traces.push({ pts, cum, len, start, dur, cell, pulses, orders, speed, side });
      comb.fire(cell, start + dur, 1.1);
      for (const p of pulses) comb.fire(cell, p + len / speed, 0.85);
    };
    L.forEach((r, k) => add(r, leftCells[k], -1, k * 2));
    Rt.forEach((r, k) => add(r, rightCells[k], 1, k * 2 + 1));
    const stubs = [
      [[-4, 14], [40, 14]],
      [[-4, 48], [76, 48]],
      [[-4, 78], [54, 78], [62, 70], [96, 70]],
      [[-4, 112], [36, 112]],
      [[150, 64], [160, 74], [192, 74]],
      [[524, 24], [470, 24]],
      [[524, 54], [430, 54]],
      [[524, 82], [486, 82]],
      [[524, 108], [470, 108]],
      [[360, 64], [350, 54], [328, 54]],
    ].map((pts, k) => {
      const cum = measure(pts);
      return { pts, cum, len: cum[cum.length - 1], start: 0.3 + 0.06 * k, dur: 0.45 };
    });
    // A honeycomb etched into the board, revealed from the middle.
    const lattice = new Path2D();
    const s = 13;
    for (let r = -4; r <= 4; r++)
      for (let q = -14; q <= 14; q++) hexPath(CX + s * SQ3 * (q + r / 2), CY + s * 1.5 * r, s - 0.5, 0, lattice);

    return (ctx, t) => {
      const reach = 30 + 330 * outCubic(t / 1.3);
      const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, reach);
      g.addColorStop(0, `rgba(${LED},0.09)`);
      g.addColorStop(0.6, `rgba(${LED},0.035)`);
      g.addColorStop(1, `rgba(${LED},0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1;
      ctx.stroke(lattice);
      drawSides(ctx);
      drawRing(ctx, t, 0.05);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const st of stubs) {
        const p = inOut((t - st.start) / st.dur);
        if (p <= 0) continue;
        ctx.strokeStyle = `rgba(${LED},0.26)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        span(ctx, st.pts, st.cum, 0, p * st.len);
        ctx.stroke();
        if (p >= 1) {
          const [x, y] = st.pts[st.pts.length - 1];
          ctx.fillStyle = '#0a0304';
          ctx.beginPath();
          ctx.arc(x, y, 2.4, 0, TAU);
          ctx.fill();
          ctx.stroke();
        }
      }
      for (const tr of traces) {
        const p = inOut((t - tr.start) / tr.dur);
        if (p <= 0) continue;
        const head = p * tr.len;
        ctx.beginPath();
        span(ctx, tr.pts, tr.cum, 0, head);
        ctx.strokeStyle = `rgba(${GLOW},0.12)`;
        ctx.lineWidth = 4.5;
        ctx.stroke();
        ctx.strokeStyle = `rgba(${LED},0.6)`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        // Vias at the bends.
        for (let i = 1; i < tr.pts.length - 1; i += 2) {
          if (tr.cum[i] > head) break;
          ctx.fillStyle = '#0a0304';
          ctx.beginPath();
          ctx.arc(tr.pts[i][0], tr.pts[i][1], 2.2, 0, TAU);
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (p < 1) {
          const [x, y] = pointAt(tr.pts, tr.cum, head);
          const h = ctx.createRadialGradient(x, y, 0, x, y, 9);
          h.addColorStop(0, `rgba(${HOT},0.95)`);
          h.addColorStop(0.3, `rgba(${LED},0.6)`);
          h.addColorStop(1, `rgba(${LED},0)`);
          ctx.fillStyle = h;
          ctx.fillRect(x - 9, y - 9, 18, 18);
        }
      }
      drawComb(ctx, comb, t, {
        wake: (t) => smooth(0.6, 1.5, t),
        level: (c, t) =>
          c === comb.core
            ? boot(t, 0.08, 0.3)
            : Math.max(0.0, boot(t, 0.85 + c.ring * 0.08 + hash(c.i, 4) * 0.25)),
      });
      ctx.globalCompositeOperation = 'lighter';
      for (const tr of traces) {
        const end = tr.start + tr.dur;
        // The port: a pad, a flash when the trace lands.
        const [px, py] = tr.pts[tr.pts.length - 1];
        if (t >= end) {
          const f = clamp((t - end) / 0.35, 0, 1);
          if (f < 1) {
            const b = ctx.createRadialGradient(px, py, 0, px, py, 4 + 12 * f);
            b.addColorStop(0, `rgba(${HOT},${a3(1 - f)})`);
            b.addColorStop(1, `rgba(${LED},0)`);
            ctx.fillStyle = b;
            ctx.fillRect(px - 18, py - 18, 36, 36);
          }
          ctx.fillStyle = `rgba(${LED},0.85)`;
          ctx.fillRect(px - (tr.side < 0 ? 3 : 0), py - 3, 3, 6);
        }
        for (const p0 of tr.pulses) {
          const s = (t - p0) * tr.speed;
          if (s < 0 || s > tr.len + 16) continue;
          packet(ctx, tr, s, PINK, 18);
        }
        for (const p0 of tr.orders) {
          const s = tr.len - (t - p0) * tr.speed * 0.8;
          if (s < -16 || s > tr.len) continue;
          packet(ctx, tr, s, HOT, -14, true);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    };
  }

  function packet(ctx, tr, s, colour, tail, out = false) {
    const a = clamp(s - tail, 0, tr.len);
    const b = clamp(s, 0, tr.len);
    if (Math.abs(b - a) < 0.5) return;
    const [x0, y0] = pointAt(tr.pts, tr.cum, a);
    const [x1, y1] = pointAt(tr.pts, tr.cum, b);
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(${colour},0)`);
    g.addColorStop(1, `rgba(${colour},0.95)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = out ? 1.6 : 2;
    ctx.beginPath();
    span(ctx, tr.pts, tr.cum, Math.min(a, b), Math.max(a, b));
    ctx.stroke();
    const h = ctx.createRadialGradient(x1, y1, 0, x1, y1, 6);
    h.addColorStop(0, `rgba(${HOT},0.9)`);
    h.addColorStop(1, `rgba(${colour},0)`);
    ctx.fillStyle = h;
    ctx.fillRect(x1 - 6, y1 - 6, 12, 12);
  }

  // ---------- B: conduits ----------

  function bezier(p0, p1, p2, p3, n = 90) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const v = 1 - u;
      pts.push([
        v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0],
        v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1],
      ]);
    }
    return pts;
  }

  function conduits() {
    const comb = makeComb();
    const spec = [
      // root, c1, c2 (relative to the port), cell, width
      [[118, -22], [128, 18], [-44, 0], [0, -2], 9],
      [[-24, 26], [70, 28], [-60, 0], [-1, -1], 11],
      [[-24, 70], [80, 72], [-70, 0], [-2, 0], 13],
      [[-24, 106], [70, 104], [-60, 0], [-2, 1], 11],
      [[112, 152], [122, 112], [-44, 0], [-2, 2], 9],
    ];
    const cables = [];
    const order = [2, 7, 1, 6, 3, 8, 0, 5, 4, 9];
    for (const side of [-1, 1]) {
      spec.forEach(([root, c1, c2, qr, w], k) => {
        const cell = comb.at(side < 0 ? qr[0] : -qr[0] - qr[1], side < 0 ? qr[1] : qr[1]);
        // Mirror a left cell (q, r) to the right: x -> -x is (q, r) -> (-q - r, r).
        const port = comb.port(cell, side);
        const m = (p) => (side < 0 ? p : [W - p[0], p[1]]);
        const jitter = side < 0 ? 0 : [6, -4, 5, -5, 4][k];
        const p0 = m([root[0], root[1] + jitter]);
        const p1 = m([c1[0], c1[1] + jitter]);
        const p2 = [port[0] + side * -c2[0], port[1]];
        const pts = bezier(p0, p1, p2, port);
        const cum = measure(pts);
        const len = cum[cum.length - 1];
        const idx = side < 0 ? k : k + 5;
        const start = 0.1 + order.indexOf(idx) * 0.07;
        const seed = 101 + idx * 13;
        const pulses = timetable(seed, JOIN + 0.3, 2.4, 1.8);
        const speed = 170;
        const c = { pts, cum, len, w, cell, start, side, pulses, speed };
        c.docked = start + 0.5 + 0.08 + 0.1;
        cables.push(c);
        comb.fire(cell, c.docked, 1.15);
        for (const p of pulses) comb.fire(cell, p + len / speed, 0.85);
      });
    }
    /** How far the cable has come out: fast, a pause to align, then the plug goes in. */
    const reach = (c, t) => {
      const u = t - c.start;
      if (u <= 0) return 0;
      if (u < 0.5) return 0.93 * c.len * outCubic(u / 0.5);
      if (u < 0.58) return 0.93 * c.len;
      return lerp(0.93, 1, inOut((u - 0.58) / 0.1)) * c.len;
    };
    return (ctx, t) => {
      drawRing(ctx, t, 0.05);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      const sorted = [...cables].sort((a, b) => a.w - b.w);
      for (const c of sorted) {
        const s = reach(c, t);
        if (s <= 0) continue;
        const plugLen = 9;
        const bodyEnd = Math.max(0, s - plugLen);
        const path = () => {
          ctx.beginPath();
          span(ctx, c.pts, c.cum, 0, bodyEnd);
        };
        // Shadow, then the sheath as a lit cylinder: dark, a band, a sharp highlight.
        ctx.save();
        ctx.translate(1, 2.2);
        path();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = c.w + 1.5;
        ctx.stroke();
        ctx.restore();
        path();
        ctx.strokeStyle = '#0d0809';
        ctx.lineWidth = c.w;
        ctx.stroke();
        ctx.save();
        ctx.translate(-0.08 * c.w, -0.12 * c.w);
        path();
        ctx.strokeStyle = '#2b2125';
        ctx.lineWidth = c.w * 0.62;
        ctx.stroke();
        ctx.translate(-0.08 * c.w, -0.1 * c.w);
        path();
        ctx.strokeStyle = 'rgba(190,160,168,0.55)';
        ctx.lineWidth = Math.max(1, c.w * 0.14);
        ctx.stroke();
        ctx.restore();
        // Ribs, anchored to the plug so they move with it; a signal lights the ones it passes.
        const lit = [];
        for (const p0 of c.pulses) {
          const ps = (t - p0) * c.speed;
          if (ps > -20 && ps < c.len + 20) lit.push(ps);
        }
        for (let rs = bodyEnd - 2; rs > 0; rs -= 4.2) {
          const [x, y, tx, ty] = pointAt(c.pts, c.cum, rs);
          const nx = -ty;
          const ny = tx;
          const hw = c.w / 2 - 0.3;
          let glow = 0;
          for (const ps of lit) glow = Math.max(glow, 1 - Math.abs(ps - rs) / 16);
          ctx.lineWidth = 1.2;
          ctx.strokeStyle =
            glow > 0 ? `rgba(${LED},${a3(0.35 + 0.65 * glow)})` : 'rgba(0,0,0,0.6)';
          ctx.beginPath();
          ctx.moveTo(x + nx * hw, y + ny * hw);
          ctx.lineTo(x - nx * hw, y - ny * hw);
          ctx.stroke();
          if (glow <= 0) {
            ctx.lineWidth = 0.8;
            ctx.strokeStyle = 'rgba(220,190,198,0.10)';
            ctx.beginPath();
            ctx.moveTo(x + nx * hw + tx * 1.1, y + ny * hw + ty * 1.1);
            ctx.lineTo(x - nx * hw + tx * 1.1, y - ny * hw + ty * 1.1);
            ctx.stroke();
          }
        }
        if (lit.length) {
          ctx.globalCompositeOperation = 'lighter';
          for (const ps of lit) {
            if (ps < 0 || ps > bodyEnd) continue;
            const [x, y] = pointAt(c.pts, c.cum, ps);
            const g = ctx.createRadialGradient(x, y, 0, x, y, c.w * 0.95);
            g.addColorStop(0, `rgba(${PINK},0.4)`);
            g.addColorStop(1, `rgba(${LED},0)`);
            ctx.fillStyle = g;
            ctx.fillRect(x - c.w, y - c.w, c.w * 2, c.w * 2);
          }
          ctx.globalCompositeOperation = 'source-over';
        }
        // The plug: a machined head, its band lit once seated, a pin into the cell.
        const [hx, hy, tx, ty] = pointAt(c.pts, c.cum, s);
        const nx = -ty;
        const ny = tx;
        const hw = c.w / 2 + 1.6;
        const back = [hx - tx * plugLen, hy - ty * plugLen];
        const seated = t >= c.docked;
        const quad = (a, b, w1, w2) => {
          ctx.beginPath();
          ctx.moveTo(a[0] + nx * w1, a[1] + ny * w1);
          ctx.lineTo(b[0] + nx * w2, b[1] + ny * w2);
          ctx.lineTo(b[0] - nx * w2, b[1] - ny * w2);
          ctx.lineTo(a[0] - nx * w1, a[1] - ny * w1);
          ctx.closePath();
        };
        const lightSide = nx * LIGHT[0] + ny * LIGHT[1] > 0 ? 1 : -1;
        const g = ctx.createLinearGradient(
          hx + nx * hw * lightSide,
          hy + ny * hw * lightSide,
          hx - nx * hw * lightSide,
          hy - ny * hw * lightSide,
        );
        g.addColorStop(0, '#5c4a50');
        g.addColorStop(0.35, '#2a2024');
        g.addColorStop(1, '#0b0708');
        quad(back, [hx - tx * 1.5, hy - ty * 1.5], hw, hw - 0.6);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        quad([hx - tx * 1.5, hy - ty * 1.5], [hx, hy], hw * 0.55, hw * 0.45);
        ctx.fillStyle = '#1a1316';
        ctx.fill();
        const band = [hx - tx * plugLen * 0.55, hy - ty * plugLen * 0.55];
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = seated ? `rgba(${LED},0.95)` : `rgba(${LED},0.25)`;
        ctx.beginPath();
        ctx.moveTo(band[0] + nx * (hw - 0.8), band[1] + ny * (hw - 0.8));
        ctx.lineTo(band[0] - nx * (hw - 0.8), band[1] - ny * (hw - 0.8));
        ctx.stroke();
      }
      drawComb(ctx, comb, t, {
        wake: (t) => smooth(0.6, 1.5, t),
        level: (c, t) => (c === comb.core ? boot(t, 0.1, 0.3) : boot(t, 0.75 + c.ring * 0.1 + hash(c.i, 9) * 0.3)),
      });
      // Sparks where a plug seats.
      ctx.globalCompositeOperation = 'lighter';
      for (const c of cables) {
        const f = (t - c.docked) / 0.3;
        if (f < 0 || f > 1) continue;
        const [px, py] = c.pts[c.pts.length - 1];
        for (let k = 0; k < 7; k++) {
          const a = (c.side < 0 ? Math.PI : 0) + (hash(k, c.start * 100) - 0.5) * 2.6;
          const r0 = 2 + 10 * f;
          const r1 = r0 + 5 * (1 - f);
          ctx.strokeStyle = `rgba(${HOT},${a3(1 - f)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px + Math.cos(a) * r0, py + Math.sin(a) * r0);
          ctx.lineTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1);
          ctx.stroke();
        }
        const b = ctx.createRadialGradient(px, py, 0, px, py, 10);
        b.addColorStop(0, `rgba(${HOT},${a3(0.9 * (1 - f))})`);
        b.addColorStop(1, `rgba(${LED},0)`);
        ctx.fillStyle = b;
        ctx.fillRect(px - 10, py - 10, 20, 20);
      }
      ctx.globalCompositeOperation = 'source-over';
      drawSides(ctx);
    };
  }

  // ---------- C: swarm ----------

  function swarm() {
    const comb = makeComb();
    // The drones dock on the comb's own lattice beyond it, smaller and sparser toward the edges.
    const rd = R;
    const drones = [];
    for (let r = -3; r <= 3; r++)
      for (let q = -16; q <= 16; q++) {
        const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
        if (ring <= 3) continue;
        const x = CX + rd * SQ3 * (q + r / 2);
        const y = CY + rd * 1.5 * r;
        if (x < 10 || x > W - 10) continue;
        const d = Math.hypot(x - CX, y - CY);
        const dx = Math.abs(x - CX);
        const dens = 1 - smooth(50, 250, dx);
        const keep = (ring === 4 ? 0.7 : 0.2 + 0.75 * dens) * (Math.abs(r) === 3 ? 0.6 : 1);
        const i = drones.length;
        if (hash(q * 97 + r * 13, 21) > keep) continue;
        const side = x < CX ? -1 : 1;
        const h1 = hash(i, 31);
        const h2 = hash(i, 32);
        const h3 = hash(i, 33);
        const arrive = 0.55 + 0.7 * smooth(60, 260, dx) + 0.22 * h1;
        const dur = 0.5 + 0.18 * h2;
        drones.push({
          x,
          y,
          q,
          r,
          d,
          side,
          dens,
          size: (rd - 1.4) * (0.42 + 0.48 * dens),
          arrive,
          start: Math.max(0.02, arrive - dur),
          from: [side < 0 ? -20 - 160 * h3 : W + 20 + 160 * h3, y + (h2 - 0.5) * 90],
          bend: (h1 - 0.5) * 40,
          spin: (h3 - 0.5) * 3,
          events: [],
        });
      }
    // Chains: from far drones, hop by hop toward the comb, then into an outer cell.
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < rd * SQ3 * 1.08;
    const chains = [];
    const outer = comb.cells.filter((c) => c.ring === 2);
    for (const side of [-1, 1]) {
      const far = drones
        .filter((d) => d.side === side && Math.abs(d.x - CX) > 110)
        .sort((a, b) => hash(a.q * 7 + a.r, 41 + side) - hash(b.q * 7 + b.r, 41 + side))
        .slice(0, 5);
      far.forEach((d0, k) => {
        const path = [d0];
        let at = d0;
        for (let n = 0; n < 60 && at.d > 62; n++) {
          const next = drones
            .filter((o) => o !== at && near(o, at) && o.d < at.d)
            .sort((a, b) => a.d - b.d)[0];
          if (!next) break;
          path.push(next);
          at = next;
        }
        const cell = outer
          .filter((c) => (c.x - CX) * side > 0)
          .sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))[0];
        const seed = 300 + k * 17 + (side > 0 ? 7 : 0);
        const times = timetable(seed, JOIN + 0.2, 3.2, 3);
        const hop = 0.055;
        const chain = { path, cell, times, hop };
        chains.push(chain);
        for (const t0 of times) {
          path.forEach((d, n) => d.events.push(t0 + n * hop));
          comb.fire(cell, t0 + path.length * hop, 0.9);
        }
      });
    }
    const broadcasts = timetable(9, JOIN + 1.0, 4.2, 0.5);
    const place = (d, t) => {
      const u = (t - d.start) / (d.arrive - d.start);
      if (u <= 0) return null;
      const e = outCubic(u);
      const x = lerp(d.from[0], d.x, e);
      const y = lerp(d.from[1], d.y, e) + Math.sin(Math.PI * clamp(u, 0, 1)) * d.bend;
      return { x, y, rot: d.spin * (1 - e), a: smooth(0, 0.25, u) };
    };
    const ledOf = (d, t) => {
      const on = boot(t, d.arrive, 0.18);
      let e = 0.08 + 0.16 * d.dens;
      for (const te of d.events) if (te <= t && t - te < 0.8) e += 1.1 * Math.exp(-(t - te) * 7);
      for (const b of broadcasts) {
        const front = 60 + 240 * (t - b);
        if (front > 0) e += 0.6 * Math.exp(-Math.pow((d.d - front) / 12, 2));
      }
      return on * e;
    };
    return (ctx, t) => {
      drawSides(ctx);
      drawRing(ctx, t, 0.0);
      // Faint links along the chains, once both ends are home.
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = `rgba(${LED},0.16)`;
      ctx.beginPath();
      for (const ch of chains)
        ch.path.forEach((d, n) => {
          const b = ch.path[n + 1];
          if (!b || t < Math.max(d.arrive, b.arrive)) return;
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(b.x, b.y);
        });
      ctx.stroke();
      // The drones, batched: plates, their lit edges, their lamps by brightness.
      const plates = new Path2D();
      const edges = new Path2D();
      const lamps = Array.from({ length: 8 }, () => new Path2D());
      for (const d of drones) {
        const p = place(d, t);
        if (!p) continue;
        const s = d.size;
        hexPath(p.x, p.y, s, p.rot, plates);
        const a0 = p.rot + -150 * DEG;
        const a1 = p.rot + -90 * DEG;
        const a2 = p.rot + -30 * DEG;
        edges.moveTo(p.x + s * Math.cos(a0), p.y + s * Math.sin(a0));
        edges.lineTo(p.x + s * Math.cos(a1), p.y + s * Math.sin(a1));
        edges.lineTo(p.x + s * Math.cos(a2), p.y + s * Math.sin(a2));
        const e = ledOf(d, t) * p.a;
        if (e > 0.03) {
          const b = Math.min(7, Math.floor(e * 6));
          hexPath(p.x, p.y, s * 0.5, p.rot, lamps[b]);
        }
      }
      ctx.save();
      ctx.translate(0.6, 1.2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fill(plates);
      ctx.restore();
      ctx.fillStyle = '#211a1d';
      ctx.fill(plates);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 0.8;
      ctx.stroke(plates);
      ctx.strokeStyle = 'rgba(214,186,194,0.32)';
      ctx.stroke(edges);
      lamps.forEach((path, b) => {
        const e = (b + 0.5) / 6;
        ctx.fillStyle = b >= 5 ? `rgba(${HOT},${a3(e * 0.8)})` : `rgba(${LED},${a3(0.12 + e * 0.85)})`;
        ctx.fill(path);
      });
      drawComb(ctx, comb, t, {
        wake: (t) => smooth(0.5, 1.4, t),
        level: (c, t) => (c === comb.core ? boot(t, 0.05, 0.25) : boot(t, 0.18 + c.ring * 0.16 + hash(c.i, 5) * 0.12)),
        place: (c, t) => {
          if (c === comb.core) return { x: c.x, y: c.y, s: lerp(0.5, 1, outBack((t - 0.02) / 0.3)), a: smooth(0.02, 0.1, t), rot: 0 };
          const t0 = 0.08 + c.ring * 0.14 + hash(c.i, 6) * 0.1;
          const u = outBack((t - t0) / 0.32, 1.1);
          const ang = Math.atan2(c.y - CY, c.x - CX);
          const out = 30 * (1 - u);
          return {
            x: c.x + Math.cos(ang) * out,
            y: c.y + Math.sin(ang) * out,
            s: 1,
            a: smooth(t0, t0 + 0.1, t),
            rot: (1 - clamp(u, 0, 1)) * 1.2 * (c.i % 2 ? 1 : -1),
          };
        },
      });
      // Signals hopping along the chains: a short laser between the drones, into the comb.
      ctx.globalCompositeOperation = 'lighter';
      for (const ch of chains) {
        for (const t0 of ch.times) {
          const u = (t - t0) / ch.hop;
          if (u < 0 || u > ch.path.length + 1) continue;
          const n = Math.floor(u);
          const a = ch.path[n];
          const b = ch.path[n + 1] ?? { x: ch.cell.x + (CX - ch.cell.x) * 0, y: ch.cell.y };
          if (!a) continue;
          const f = u - n;
          const x = lerp(a.x, b.x, f);
          const y = lerp(a.y, b.y, f);
          const g = ctx.createLinearGradient(a.x, a.y, x, y);
          g.addColorStop(0, `rgba(${LED},0.1)`);
          g.addColorStop(1, `rgba(${HOT},0.95)`);
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(x, y);
          ctx.stroke();
          const h = ctx.createRadialGradient(x, y, 0, x, y, 5);
          h.addColorStop(0, `rgba(${HOT},0.85)`);
          h.addColorStop(1, `rgba(${LED},0)`);
          ctx.fillStyle = h;
          ctx.fillRect(x - 5, y - 5, 10, 10);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    };
  }

  const KINDS = { circuit, conduits, swarm };

  /** Puts candidate `kind` in place of the question's art; returns draw(t). */
  function mount(kind) {
    const old = document.querySelector('.hive-joining');
    const canvas = document.createElement('canvas');
    canvas.className = 'hive-joining hive-art proto';
    canvas.setAttribute('aria-hidden', 'true');
    old.replaceWith(canvas);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    const scene = KINDS[kind]();
    const draw = (t) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
      scene(ctx, t);
    };
    return { draw, canvas };
  }

  /** Runs candidate `kind` live: 60 fps for the join, 30 after. */
  function play(kind) {
    const { draw } = mount(kind);
    const t0 = performance.now();
    let last = 0;
    const tick = (now) => {
      const t = (now - t0) / 1000;
      if (now - last >= 1000 / (t < JOIN ? 60 : 30) - 2) {
        draw(t);
        last = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  return { mount, play, KINDS, timing(kind, t) {
    const ctx = new OffscreenCanvas(W, H).getContext('2d');
    const scene = KINDS[kind]();
    const n = 120;
    const t1 = performance.now();
    for (let i = 0; i < n; i++) { ctx.clearRect(0, 0, W, H); scene(ctx, t + i / 30); }
    ctx.getImageData(0, 0, 1, 1);
    return (performance.now() - t1) / n;
  } };
})();
