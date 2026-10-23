// The koi intro's engine (V39) as the person delivered it in koi-intro.zip (2026-10-22): only
// Prettier, non-null reads of its typed arrays (`noUncheckedIndexedAccess`) and one `Promise.all`
// written as a tuple differ; the JavaScript emitted is otherwise the same.
/**
 * koi-intro — two koi rise out of deep water, swim in from the top and lock into the S.
 *
 * Fish: textured ribbon meshes laid along each koi's trajectory head-first; each path merges into
 * the koi's rest spine and the trailing body curls home, so both settle exactly into the final art.
 * Water: a CPU height-field (wave equation) driven by the moving bodies refracts the whole
 * scene, throws specular glints and focuses caustic light; soft shadows fall on the bottom.
 */

export interface KoiFishRig {
  name: 'white' | 'black';
  /** Flattened x,y (source px), sampled every `KoiRig.step` px of arc length. */
  points: number[];
  uStart: number;
  uEnd: number;
  length: number;
  halfWidth: number;
  /** Start delay as a fraction of the swim duration. */
  delay: number;
  /** Rest pose, flattened x,y from sigma = -eHead every `step` px (sigma 0 = nose). */
  rest: number[];
  /** The path merges into the rest spine here; the body behind it curls into place at the end. */
  joinSigma: number;
}

export interface KoiRig {
  size: number;
  step: number;
  eHead: number;
  eTail: number;
  center: [number, number];
  /** Water grid: per row, wet cells are [x0, x1). */
  sim: { n: number; spans: [number, number][] };
  fish: KoiFishRig[];
}

export interface KoiIntroAssets {
  bg: string;
  white: string;
  black: string;
  aux: string;
  caustics: string;
}

export interface KoiIntroOptions {
  /** ms from start until the S is assembled. */
  duration?: number;
  /**
   * After assembly. "none" (default): the drop's ring spreads, then the pond goes flat and
   * static and rendering stops. "water": a calm, living surface keeps moving.
   */
  idle?: 'water' | 'none';
  maxPixelRatio?: number;
  /** Skip the swim when the user prefers reduced motion. */
  respectReducedMotion?: boolean;
  onError?: (err: KoiIntroError) => void;
  /**
   * Procedural water sound (off by default). Browsers keep audio locked until a user gesture,
   * so turn it on with `setSound(true)` from a tap/click handler; with `sound: true` here it
   * starts on the first tap or key press.
   */
  sound?: boolean | KoiSoundOptions;
}

export type KoiIntroErrorCode =
  | 'webgl-unavailable'
  | 'asset-load-failed'
  | 'shader-compile-failed'
  | 'context-lost'
  | 'audio-unavailable'
  | 'destroyed';

export class KoiIntroError extends Error {
  constructor(
    public readonly code: KoiIntroErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KoiIntroError';
  }
}

// ---------- tuning ----------
const COLS = { white: 170, black: 170 } as const;
const ROWS = 24;
const SIGMA_TOL_PX = 70;
const WAVE_AMP = 24; // px, lateral body wave at cruising speed
const WAVE_K = (2 * Math.PI) / 520; // body wavelength
const SLIP = 1.15; // body-wave speed / swim speed (no-slip ≈ 1)
const SURGE = 5; // px, per-stroke speed pulse
const FIN_FLUTTER = 9; // px, tangential drift of far fin texels
const SETTLE_P0 = 0.66; // swim progress where the trailing body starts curling home
const SETTLE_LAG = 0.12; // tail tip starts that much later than the join
const SHADOW_RES = 128;
const SHADOW_OFFSET: [number, number] = [0.011, 0.017];
const SIM_HZ = 60;
const SIM_DAMP = 0.994;
const WAKE = 0.02; // height per px of body travel
const UNION_DROP = 5.5; // height of the pulse when the S locks
const SETTLE_MS = 1800; // ambient water eases to its idle level
const CALM_DELAY_MS = 450; // the drop's ring travels this long before the water stills
const CALM_MS = 1100; // ...then the surface goes flat over this long
const CALM_DAMP = 0.95; // per-step damping once calming (vs SIM_DAMP)
const IDLE_AMBIENT = 0.42;
const CALM_EPS = 0.02; // below this the surface reads as flat

const GLSL_PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/** Ambient swell (analytic gradient) + caustic light from a tileable photon-mapped texture. */
const GLSL_WATER = `
const float TAU = 6.2831853;
uniform sampler2D uCaus;
uniform sampler2D uAux; // three panels: [white | black | masks]
vec4 auxAt(vec2 uv, float panel) { return texture2D(uAux, vec2((clamp(uv.x, 0.0, 1.0) + panel) / 3.0, uv.y)); }
void swell(vec2 p, float t, float ang, float cyc, float w, float wt, inout vec2 g) {
  vec2 k = vec2(cos(ang), sin(ang));
  g += wt * cos(TAU * cyc * dot(k, p) - w * t + ang * 7.0) * k / cyc;
}
vec2 ambient(vec2 p, float t) {
  vec2 g = vec2(0.0);
  swell(p, t, 0.30, 5.0, 0.9, 1.0, g);
  swell(p, t, 1.90, 6.3, 1.2, 0.9, g);
  swell(p, t, 3.60, 4.4, 0.7, 0.8, g);
  swell(p, t, 4.90, 7.7, 1.5, 0.6, g);
  swell(p, t, 2.70, 9.1, 1.8, 0.5, g);
  return g;
}
// Two drifting layers of the caustic net, each bent by the swell so the web keeps re-forming.
float causticAt(vec2 p, float t, vec2 warp) {
  vec2 q = p + warp;
  vec2 g = ambient(p * 0.6, t * 0.5);
  float a = texture2D(uCaus, q * 1.6 + g * 0.05 + vec2(0.012, 0.007) * t).r;
  float b = texture2D(uCaus, mat2(0.8, -0.6, 0.6, 0.8) * q * 1.15 - g * 0.04 + vec2(-0.009, 0.011) * t).r;
  return a * 0.75 + b * 0.45;
}
`;

const VS_QUAD = `
attribute vec2 aP; varying vec2 vS;
void main(){ vS = aP; gl_Position = vec4(aP.x*2.0-1.0, 1.0-aP.y*2.0, 0.0, 1.0); }`;

/** Pond floor: koi-free tile + caustic light, dimmed under the fish shadows. */
const FS_BG = `${GLSL_PRECISION}${GLSL_WATER}
uniform sampler2D uTex; uniform sampler2D uWater; uniform sampler2D uShadow;
uniform float uTime; uniform float uAmb; uniform float uCaustic; uniform float uShadowOn; uniform vec2 uC;
varying vec2 vS;
void main(){
  vec4 bg = texture2D(uTex, vS);
  float m = auxAt(vS, 2.0).r;
  vec4 w = texture2D(uWater, vS);
  vec2 gs = (w.rg - 0.5) * 2.0;
  float lap = (w.b - 0.5) * 2.0;
  float c = causticAt(vS, uTime, gs * 0.025 + ambient(vS, uTime) * 0.005 * uAmb) + max(-lap, 0.0) * 0.45;
  float sh = texture2D(uShadow, vec2(vS.x, 1.0 - vS.y)).a * uShadowOn;
  float pool = 1.0 - 0.55 * smoothstep(0.18, 0.5, length(vS - uC));
  vec3 light = vec3(0.32, 0.55, 1.0) * c * uCaustic * 0.12 * pool * (1.0 - 0.85 * sh);
  gl_FragColor = vec4((bg.rgb * (1.0 - 0.45 * sh * m) + light * m) * bg.a, bg.a);
}`;

const VS_FISH = `
attribute vec2 aPos; attribute vec2 aUV; attribute float aSig;
uniform vec2 uOffset;
varying vec2 vUV; varying vec2 vScr; varying float vSig;
void main(){
  vec2 p = aPos + uOffset;
  vUV = aUV; vScr = p; vSig = aSig;
  gl_Position = vec4(p.x*2.0-1.0, 1.0-p.y*2.0, 0.0, 1.0);
}`;

const FS_FISH = `${GLSL_PRECISION}${GLSL_WATER}
uniform sampler2D uTex;
uniform float uPanel; uniform float uTol; uniform float uSoft;
uniform float uDepth; uniform float uShadowPass; uniform float uOpacity;
uniform float uTime; uniform float uAmb; uniform float uCaustic;
varying vec2 vUV; varying vec2 vScr; varying float vSig;
void main(){
  // Deep fish are soft (mip bias), hazed toward the water colour and a little transparent.
  vec4 c = texture2D(uTex, vUV, uDepth * 3.2 + uShadowPass * 2.5);
  // Which part of the body owns this texel. Where two turns of the S lie close, moving bodies
  // share the texels across the medial line with a soft fade instead of a hard cut.
  vec3 a = auxAt(vUV, uPanel).rgb;
  float k1 = 1.0 - smoothstep(uTol * 0.6, uTol, abs(a.r - vSig));
  float k2 = 1.0 - smoothstep(uTol * 0.6, uTol, abs(a.g - vSig));
  float side = smoothstep(0.0, 0.45, a.b);           // 0 on the medial line, 1 ~29 px away
  float k = k1 * mix(1.0, 0.5 + 0.5 * side, uSoft) + k2 * uSoft * (0.5 - 0.5 * side);
  k *= auxAt(vScr, 2.0).g;
  if (uShadowPass > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, c.a * k * (0.35 + 0.65 * (1.0 - uDepth))); return; }
  vec3 lit = c.rgb + vec3(0.40, 0.60, 1.0) * causticAt(vScr, uTime, vec2(0.0)) * uCaustic * 0.05 * c.a;
  vec3 hazed = mix(lit, vec3(0.018, 0.035, 0.075) * c.a, 0.62 * uDepth);
  gl_FragColor = vec4(hazed, c.a) * k * (1.0 - 0.3 * uDepth) * uOpacity;
}`;

/** Surface: refract the scene through the height field and add sun glints. */
const FS_COMP = `${GLSL_PRECISION}${GLSL_WATER}
uniform sampler2D uScene; uniform sampler2D uWater;
uniform float uTime; uniform float uAmb;
varying vec2 vS;
void main(){
  float m = auxAt(vS, 2.0).r;
  vec2 gs = (texture2D(uWater, vS).rg - 0.5) * 2.0;
  vec2 ga = ambient(vS, uTime) * uAmb;
  vec2 uv = vS + m * (gs * 0.009 + ga * 0.0016);
  vec4 col = texture2D(uScene, vec2(uv.x, 1.0 - uv.y));
  // Ripples read by the sky they reflect: light on slopes facing the light, shade behind.
  float facing = dot(gs + ga * 0.08, vec2(-0.57, -0.82));
  col.rgb = col.rgb * (1.0 - 0.2 * max(-facing, 0.0) * m) + vec3(0.55, 0.70, 1.0) * max(facing, 0.0) * 0.2 * m * col.a;
  gl_FragColor = col;
}`;

// ---------- water ----------
class WaterSim {
  readonly n: number;
  readonly pixels: Uint8Array;
  private cur: Float32Array;
  private prev: Float32Array;
  private readonly vis: Float32Array;
  private readonly wet: Uint8Array;
  /** Per-step energy kept; lowered when the water is told to calm. */
  damp = SIM_DAMP;

  constructor(n: number, spans: [number, number][]) {
    this.n = n;
    this.cur = new Float32Array(n * n);
    this.prev = new Float32Array(n * n);
    this.vis = new Float32Array(n * n);
    this.pixels = new Uint8Array(n * n * 4);
    this.wet = new Uint8Array(n * n);
    spans.forEach(([x0, x1], y) => {
      if (y <= 0 || y >= n - 1) return;
      for (let x = Math.max(x0, 1); x < Math.min(x1, n - 1); x++) this.wet[y * n + x] = 1;
    });
    this.encode();
  }

  reset(): void {
    this.cur.fill(0);
    this.prev.fill(0);
  }

  /** Adds a gaussian bump at normalised (x, y); radius in cells. */
  splat(x: number, y: number, amount: number, radius: number): void {
    const { n, cur, wet } = this;
    const cx = x * n - 0.5;
    const cy = y * n - 0.5;
    const r = Math.ceil(radius * 2);
    const inv = 1 / (radius * radius);
    const x0 = Math.max(1, Math.floor(cx - r));
    const x1 = Math.min(n - 2, Math.ceil(cx + r));
    const y0 = Math.max(1, Math.floor(cy - r));
    const y1 = Math.min(n - 2, Math.ceil(cy + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const i = yy * n + xx;
        if (wet[i]) cur[i]! += amount * Math.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) * inv);
      }
    }
  }

  step(): void {
    const { n, cur, prev, wet, damp } = this;
    for (let y = 1; y < n - 1; y++) {
      let i = y * n + 1;
      for (let x = 1; x < n - 1; x++, i++) {
        prev[i] = wet[i]
          ? ((cur[i - 1]! + cur[i + 1]! + cur[i - n]! + cur[i + n]!) * 0.5 - prev[i]!) * damp
          : 0;
      }
    }
    this.cur = prev;
    this.prev = cur;
  }

  /**
   * Packs gradient (RG) and laplacian (B) into RGBA8; returns peak |height|. `frac` (0..1) is how
   * far real time has moved past the last fixed step: the field is interpolated between the last
   * two steps so ripples glide at any refresh rate (60/90/120 Hz) instead of stepping.
   */
  encode(frac = 1): number {
    const { n, pixels, vis, cur: b, prev: a } = this;
    for (let i = 0; i < n * n; i++) vis[i] = a[i]! + (b[i]! - a[i]!) * frac;
    const cur = vis;
    let peak = 0;
    const q = (v: number, s: number): number => Math.max(0, Math.min(255, Math.round(128 + v * s)));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const o = i * 4;
        if (x === 0 || y === 0 || x === n - 1 || y === n - 1) {
          pixels[o] = pixels[o + 1] = pixels[o + 2] = 128;
          pixels[o + 3] = 255;
          continue;
        }
        const h = cur[i]!;
        const a = Math.abs(h);
        if (a > peak) peak = a;
        pixels[o] = q((cur[i + 1]! - cur[i - 1]!) * 0.5, 254);
        pixels[o + 1] = q((cur[i + n]! - cur[i - n]!) * 0.5, 254);
        pixels[o + 2] = q(cur[i - 1]! + cur[i + 1]! + cur[i - n]! + cur[i + n]! - 4 * h, 127);
        pixels[o + 3] = 255;
      }
    }
    return peak;
  }
}

// ---------- sound ----------
export interface KoiSoundOptions {
  /** Master volume 0..1, default 0.7. */
  volume?: number;
  /** Level of the soft water background, 0 (off) .. 2, default 1. */
  background?: number;
}

type AudioCtor = typeof AudioContext;

/**
 * Procedural water sound (Web Audio, no assets): a barely-there water background (soft, airy
 * lapping, no rumble) and one deep water drop when the S locks.
 */
class KoiSound {
  readonly ctx: BaseAudioContext;
  private readonly bus: GainNode;
  private readonly master: GainNode;
  private readonly noise: AudioBuffer;
  private readonly bed: GainNode;
  private readonly loops: AudioScheduledSourceNode[] = [];
  private enabled = false;
  private readonly volume: number;
  private readonly bedLevel: number;

  static create(volume: number, background: number): KoiSound | null {
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    return Ctor ? new KoiSound(new Ctor({ latencyHint: 'interactive' }), volume, background) : null;
  }

  constructor(ctx: BaseAudioContext, volume: number, background = 1) {
    this.ctx = ctx;
    this.volume = Math.min(Math.max(volume, 0), 1);
    this.bedLevel = 0.022 * Math.min(Math.max(background, 0), 2);
    const rate = ctx.sampleRate;

    this.noise = ctx.createBuffer(1, rate * 2, rate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    comp.connect(this.master).connect(ctx.destination);

    // small, soft room: generated stereo impulse response
    const verb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, Math.floor(rate * 2.6), rate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++)
        d[i] = (Math.random() * 2 - 1) * Math.exp((-3.2 * i) / rate);
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.bus = ctx.createGain();
    this.bus.gain.value = 1.9; // ~+5.5 dB into the compressor; phone speakers need it
    this.bus.connect(comp);
    this.bus.connect(wet).connect(verb).connect(comp);

    // background: two slowly breathing bands of soft water texture, left and right
    this.bed = ctx.createGain();
    this.bed.gain.value = 0;
    this.bed.connect(comp);
    for (const [side, rates] of [
      [-0.55, [0.07, 0.19]],
      [0.55, [0.09, 0.23]],
    ] as [number, number[]][]) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 220;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;
      lp.Q.value = 0.5;
      const g = ctx.createGain();
      g.gain.value = 0.6;
      for (const r of rates) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = r;
        const depth = ctx.createGain();
        depth.gain.value = 0.22;
        lfo.connect(depth).connect(g.gain);
        lfo.start();
        this.loops.push(lfo);
      }
      src.connect(hp).connect(lp).connect(g);
      this.out(g, side, this.bed);
      src.start(0, Math.random() * 2);
      this.loops.push(src);
    }
  }

  private panner(value = 0): StereoPannerNode | null {
    if (typeof this.ctx.createStereoPanner !== 'function') return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = value;
    return p;
  }

  private out(node: AudioNode, pan: number, to: AudioNode = this.bus): void {
    const p = this.panner(Math.max(-0.9, Math.min(0.9, pan)));
    (p ? node.connect(p) : node).connect(to);
  }

  get running(): boolean {
    return this.enabled;
  }

  /** Call from a user gesture the first time: browsers keep audio locked until then. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    const t = this.ctx.currentTime;
    const ctx = this.ctx as AudioContext;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? this.volume : 0, t, on ? 0.15 : 0.08);
    this.bed.gain.cancelScheduledValues(t);
    this.bed.gain.setTargetAtTime(on ? this.bedLevel : 0, t, on ? 1.2 : 0.08); // eases in over ~3 s
    if (on && typeof ctx.resume === 'function' && ctx.state !== 'running')
      void ctx.resume().catch(() => undefined);
  }

  /** Visibility / lifecycle: pause the graph without touching the user's setting. */
  pause(paused: boolean): void {
    const ctx = this.ctx as AudioContext;
    if (typeof ctx.suspend !== 'function') return;
    if (paused) void ctx.suspend().catch(() => undefined);
    else if (this.enabled) void ctx.resume().catch(() => undefined);
  }

  /** The S locks: one deep water drop (with a little room). */
  union(at = this.ctx.currentTime): void {
    const ctx = this.ctx;
    const drop = ctx.createOscillator();
    drop.frequency.setValueAtTime(170, at);
    drop.frequency.exponentialRampToValueAtTime(430, at + 0.09);
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0.0001, at);
    dg.gain.exponentialRampToValueAtTime(0.2, at + 0.006);
    dg.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    drop.connect(dg).connect(this.bus);
    drop.start(at);
    drop.stop(at + 0.5);
  }

  dispose(): void {
    this.loops.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    const ctx = this.ctx as AudioContext;
    if (typeof ctx.close === 'function') void ctx.close().catch(() => undefined);
  }
}

// ---------- internals ----------
interface FishState {
  rig: KoiFishRig;
  pts: Float32Array;
  n: number;
  cols: number;
  sigmas: Float32Array;
  offsets: Float32Array;
  spine: Float32Array;
  normals: Float32Array;
  pos: Float32Array;
  uv: Float32Array;
  sigNorm: Float32Array;
  panel: number;
  tol: number;
  depth: number;
  progress: number;
  phase: number;
  /** Head speed, source px / s (for sound). */
  speed: number;
  rest: Float32Array;
  restN: number;
  headCol: number;
  restSpine: Float32Array;
  restAng: Float32Array;
  restLen: Float32Array;
  pathAng: Float32Array;
  pathLen: Float32Array;
  settleW0: Float32Array; // per chord: 0 = on the shared path, 1 = must curl home
  settleX: Float32Array; // per chord: 0 at the join, 1 at the tail tip
  /** Columns that push water, their weights, and last-frame positions (source px). */
  wakeCols: number[];
  wakeW: number[];
  wakePrev: Float32Array;
}

interface FishBuffers {
  posBuf: WebGLBuffer;
  uvBuf: WebGLBuffer;
  sigBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
  count: number;
}

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

interface GLRes {
  bgProg: WebGLProgram;
  fishProg: WebGLProgram;
  compProg: WebGLProgram;
  quadBuf: WebGLBuffer;
  tex: Record<keyof KoiIntroAssets | 'water', WebGLTexture>;
  fish: FishBuffers[];
  shadow: Target | null;
  scene: Target | null;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'; // WebGL needs CORS for remote assets
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new KoiIntroError('asset-load-failed', `Failed to load ${src.slice(0, 64)}`));
    img.src = src;
  });
}

export class KoiIntro {
  private readonly gl: WebGLRenderingContext;
  private res: GLRes | null = null;
  private readonly fish: FishState[];
  private readonly sim: WaterSim;
  private readonly uniforms = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private raf = 0;
  private last = 0;
  private elapsed = 0;
  private simAcc = 0;
  private peak = 0;
  private dropped = false;
  private dropAt = Infinity;
  private havePrev = false;
  private running = false;
  private destroyed = false;
  private assembled: { resolve: () => void; reject: (e: KoiIntroError) => void } | null = null;
  private readonly ro: ResizeObserver;
  private readonly opts: Required<Omit<KoiIntroOptions, 'onError' | 'sound'>> &
    Pick<KoiIntroOptions, 'onError'>;
  private sound: KoiSound | null = null;
  private soundOn = false;
  private readonly soundVolume: number;
  private readonly soundBackground: number;

  /** Loads assets and draws the empty pond. Throws KoiIntroError; fall back to a static <img>. */
  static async create(
    canvas: HTMLCanvasElement,
    rig: KoiRig,
    assets: KoiIntroAssets,
    options: KoiIntroOptions = {},
  ): Promise<KoiIntro> {
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    if (!gl) throw new KoiIntroError('webgl-unavailable', 'WebGL is not available');
    const [bg, white, black, aux, caustics] = await Promise.all([
      loadImage(assets.bg),
      loadImage(assets.white),
      loadImage(assets.black),
      loadImage(assets.aux),
      loadImage(assets.caustics),
    ]);
    return new KoiIntro(canvas, gl, rig, { bg, white, black, aux, caustics }, options);
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
    private readonly rig: KoiRig,
    private readonly images: Record<keyof KoiIntroAssets, HTMLImageElement>,
    options: KoiIntroOptions,
  ) {
    this.gl = gl;
    this.opts = {
      duration: options.duration ?? 4200,
      idle: options.idle ?? 'none',
      maxPixelRatio: options.maxPixelRatio ?? 2,
      respectReducedMotion: options.respectReducedMotion ?? true,
      onError: options.onError,
    };
    const snd = options.sound;
    this.soundVolume = typeof snd === 'object' ? (snd.volume ?? 0.7) : 0.7;
    this.soundBackground = typeof snd === 'object' ? (snd.background ?? 1) : 1;
    if (snd) {
      // Autoplay policy: arm sound now, unlock it on the first gesture.
      const unlock = (): void => {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        if (!this.destroyed) this.setSound(true);
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      this.disarm = unlock;
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    this.sim = new WaterSim(rig.sim.n, rig.sim.spans);
    this.fish = rig.fish.map((f) => this.buildFish(f));
    this.initGL();
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.updatePoses();
    this.resize();
  }

  /**
   * Turns the procedural water sound on or off. Call it from a click/tap handler the first time:
   * browsers only start audio after a user gesture. Safe to call repeatedly.
   */
  setSound(on: boolean): void {
    if (this.destroyed) return;
    if (on && !this.sound) {
      this.sound = KoiSound.create(this.soundVolume, this.soundBackground);
      if (!this.sound) {
        this.opts.onError?.(new KoiIntroError('audio-unavailable', 'Web Audio is not available'));
        return;
      }
    }
    this.soundOn = on;
    this.sound?.setEnabled(on);
  }

  get soundEnabled(): boolean {
    return this.soundOn;
  }

  /** Plays the swim. Resolves when the koi have locked into the S. */
  play(): Promise<void> {
    if (this.destroyed)
      return Promise.reject(new KoiIntroError('destroyed', 'KoiIntro was destroyed'));
    this.assembled?.reject(new KoiIntroError('destroyed', 'Superseded by a new play()'));
    const done = new Promise<void>((resolve, reject) => (this.assembled = { resolve, reject }));
    this.sim.reset();
    this.sim.damp = SIM_DAMP;
    this.dropAt = Infinity;
    this.dropped = false;
    this.havePrev = false;
    this.simAcc = 0;
    const reduce =
      this.opts.respectReducedMotion && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      this.stop();
      this.elapsed = this.opts.duration + SETTLE_MS;
      this.dropped = true;
      this.dropAt = -Infinity;
      this.updatePoses();
      this.peak = this.sim.encode();
      this.render();
      if (this.soundOn) this.sound?.union();
      this.settle();
      return done;
    }
    this.elapsed = 0;
    this.start();
    return done;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    this.ro.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.assembled?.reject(new KoiIntroError('destroyed', 'KoiIntro was destroyed'));
    this.assembled = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.disarm) {
      window.removeEventListener('pointerdown', this.disarm);
      window.removeEventListener('keydown', this.disarm);
    }
    this.sound?.dispose();
    this.sound = null;
    this.freeGL();
  }

  private disarm: (() => void) | null = null;

  private onVisibility = (): void => {
    this.sound?.pause(document.hidden);
  };

  // ---------- fish geometry ----------

  private buildFish(rig: KoiFishRig): FishState {
    const cols = COLS[rig.name];
    const { eHead, eTail } = this.rig;
    const span = rig.length + eHead + eTail;
    const sigmas = new Float32Array(cols);
    const sigNorm = new Float32Array(cols * ROWS);
    for (let c = 0; c < cols; c++) {
      sigmas[c] = -eHead + (span * c) / (cols - 1);
      sigNorm.fill((sigmas[c]! + eHead) / span, c * ROWS, (c + 1) * ROWS);
    }
    const offsets = new Float32Array(ROWS);
    for (let r = 0; r < ROWS; r++)
      offsets[r] = -rig.halfWidth + (2 * rig.halfWidth * r) / (ROWS - 1);
    const colAt = (s: number): number => Math.round(((s + eHead) / span) * (cols - 1));
    const wakeAt = [0, 0.3, 0.6, 1, 1 + (0.5 * eTail) / rig.length];
    const fs: FishState = {
      rig,
      pts: Float32Array.from(rig.points),
      n: rig.points.length / 2,
      cols,
      sigmas,
      offsets,
      spine: new Float32Array(cols * 2),
      normals: new Float32Array(cols * 2),
      pos: new Float32Array(cols * ROWS * 2),
      uv: new Float32Array(cols * ROWS * 2),
      sigNorm,
      panel: rig.name === 'white' ? 0 : 1,
      tol: SIGMA_TOL_PX / span,
      depth: 1,
      progress: 0,
      phase: 0,
      speed: 0,
      rest: Float32Array.from(rig.rest),
      restN: rig.rest.length / 2,
      headCol: colAt(0),
      restSpine: new Float32Array(cols * 2),
      restAng: new Float32Array(cols - 1),
      restLen: new Float32Array(cols - 1),
      pathAng: new Float32Array(cols - 1),
      pathLen: new Float32Array(cols - 1),
      settleW0: new Float32Array(cols - 1),
      settleX: new Float32Array(cols - 1),
      wakeCols: wakeAt.map((f) => colAt(f * rig.length)),
      wakeW: [1, 0.35, 0.3, 0.4, 0.8],
      wakePrev: new Float32Array(wakeAt.length * 2),
    };
    for (let c = 0; c < cols; c++) this.restAt(fs, sigmas[c]!, fs.restSpine, 2 * c);
    const tailSpan = Math.max(rig.length + eTail - rig.joinSigma, 1);
    for (let c = 0; c < cols - 1; c++) {
      const dx = fs.restSpine[2 * c + 2]! - fs.restSpine[2 * c]!;
      const dy = fs.restSpine[2 * c + 3]! - fs.restSpine[2 * c + 1]!;
      fs.restAng[c] = Math.atan2(dy, dx);
      fs.restLen[c] = Math.hypot(dx, dy);
      const mid = 0.5 * (sigmas[c]! + sigmas[c + 1]!);
      fs.settleW0[c] = smoothstep(rig.joinSigma - 80, rig.joinSigma + 40, mid);
      fs.settleX[c] = clamp01((mid - rig.joinSigma) / tailSpan);
    }
    this.pose(fs, rig.uEnd, 0, 0, 1, true); // rest pose defines the texture mapping
    fs.uv.set(fs.pos);
    return fs;
  }

  private sampleTraj(f: FishState, u: number, out: Float32Array, o: number): void {
    const i = u / this.rig.step;
    const lo = Math.min(Math.max(Math.floor(i), 0), f.n - 2);
    const t = i - lo; // outside [0,1] extrapolates past either end
    const p = f.pts;
    out[o] = p[2 * lo]! + (p[2 * lo + 2]! - p[2 * lo]!) * t;
    out[o + 1] = p[2 * lo + 1]! + (p[2 * lo + 3]! - p[2 * lo + 1]!) * t;
  }

  private restAt(f: FishState, s: number, out: Float32Array, o: number): void {
    const i = (s + this.rig.eHead) / this.rig.step;
    const lo = Math.min(Math.max(Math.floor(i), 0), f.restN - 2);
    const t = i - lo;
    const p = f.rest;
    out[o] = p[2 * lo]! + (p[2 * lo + 2]! - p[2 * lo]!) * t;
    out[o + 1] = p[2 * lo + 1]! + (p[2 * lo + 3]! - p[2 * lo + 1]!) * t;
  }

  /**
   * Curls the body behind the join from its path toward the rest pose by blending each chord's
   * direction and length (so the body bends rather than stretches), rebuilt from the head back.
   */
  private settleInto(f: FishState, p: number): void {
    const { cols, spine, restAng, restLen, pathAng, pathLen, settleW0, settleX } = f;
    for (let c = 0; c < cols - 1; c++) {
      const dx = spine[2 * c + 2]! - spine[2 * c]!;
      const dy = spine[2 * c + 3]! - spine[2 * c + 1]!;
      pathAng[c] = Math.atan2(dy, dx);
      pathLen[c] = Math.hypot(dx, dy);
    }
    let prev = 0;
    for (let c = f.headCol; c < cols - 1; c++) {
      let d = restAng[c]! - pathAng[c]!;
      d = prev + Math.atan2(Math.sin(d - prev), Math.cos(d - prev)); // unwrap along the body
      prev = d;
      const w = settleW0[c]! * smoothstep(SETTLE_P0 + SETTLE_LAG * settleX[c]!, 1, p);
      const a = pathAng[c]! + w * d;
      const len = pathLen[c]! + w * (restLen[c]! - pathLen[c]!);
      spine[2 * c + 2] = spine[2 * c]! + Math.cos(a) * len;
      spine[2 * c + 3] = spine[2 * c + 1]! + Math.sin(a) * len;
    }
  }

  private computeNormals(f: FishState): void {
    const { spine: s, normals: nrm, cols } = f;
    for (let c = 0; c < cols; c++) {
      const a = Math.max(c - 1, 0);
      const b = Math.min(c + 1, cols - 1);
      const tx = s[2 * b]! - s[2 * a]!;
      const ty = s[2 * b + 1]! - s[2 * a + 1]!;
      const len = Math.hypot(tx, ty) || 1;
      nrm[2 * c] = -ty / len;
      nrm[2 * c + 1] = tx / len;
    }
  }

  /** Vertex positions (normalised) with the head at arc position `head`; `phase` drives the body wave. */
  private pose(
    f: FishState,
    head: number,
    amp: number,
    phase: number,
    p: number,
    atRest = false,
  ): void {
    const { cols, sigmas, spine, normals, offsets, pos } = f;
    const L = f.rig.length;
    if (atRest) spine.set(f.restSpine);
    else {
      for (let c = 0; c < cols; c++) this.sampleTraj(f, head - sigmas[c]!, spine, 2 * c);
      if (p > SETTLE_P0) this.settleInto(f, p);
    }
    this.computeNormals(f);
    if (amp > 0) {
      for (let c = 0; c < cols; c++) {
        // Real swimmers: small head yaw, amplitude growing toward the tail.
        const x = clamp01(sigmas[c]! / L);
        const env = 0.1 + 0.9 * Math.pow(smoothstep(0.1, 1, x), 1.3);
        const off = amp * env * Math.sin(WAVE_K * sigmas[c]! - phase);
        spine[2 * c]! += normals[2 * c]! * off;
        spine[2 * c + 1]! += normals[2 * c + 1]! * off;
      }
      this.computeNormals(f);
    }
    const inv = 1 / this.rig.size;
    const flutter = (FIN_FLUTTER * amp) / WAVE_AMP;
    const W = f.rig.halfWidth;
    for (let c = 0; c < cols; c++) {
      const nx = normals[2 * c]!;
      const ny = normals[2 * c + 1]!;
      const fl = flutter * Math.sin(phase * 1.7 - sigmas[c]! * 0.012);
      for (let r = 0; r < ROWS; r++) {
        const d = offsets[r]!;
        const drift = fl * (d / W) * (d / W); // tangent = (ny, -nx)
        const i = 2 * (c * ROWS + r);
        pos[i] = (spine[2 * c]! + nx * d + ny * drift) * inv;
        pos[i + 1] = (spine[2 * c + 1]! + ny * d - nx * drift) * inv;
      }
    }
  }

  private updatePoses(): void {
    const T = this.opts.duration;
    for (const f of this.fish) {
      const { uStart, uEnd, delay } = f.rig;
      const p = clamp01((this.elapsed / T - delay) / (1 - delay));
      const eased = 1 - Math.pow(1 - p, 1.8);
      const speed = Math.min(Math.max(1.8 * Math.pow(1 - p, 0.8), 0.35), 1); // relative to cruise
      const fade = 1 - smoothstep(0.62, 0.985, p);
      const base = uStart + (uEnd - uStart) * eased;
      const phase = SLIP * WAVE_K * (base - uStart); // tail beats tied to distance swum
      const head = base + SURGE * speed * fade * Math.sin(phase);
      f.depth = 1 - smoothstep(0.04, 0.42, p);
      f.progress = p;
      f.phase = phase;
      this.pose(f, head, WAVE_AMP * speed * fade, phase, p);
    }
  }

  // ---------- water coupling ----------

  private pushWater(dt: number): void {
    const s = this.rig.size;
    const k = (WAKE * 16.67) / Math.max(dt, 1);
    for (const f of this.fish) {
      const surface = Math.pow(1 - f.depth, 1.5);
      f.wakeCols.forEach((c, j) => {
        const x = f.spine[2 * c]!;
        const y = f.spine[2 * c + 1]!;
        if (j === 0 && this.havePrev)
          f.speed = (Math.hypot(x - f.wakePrev[0]!, y - f.wakePrev[1]!) * 1000) / Math.max(dt, 1);
        if (this.havePrev && surface > 0) {
          const v = Math.hypot(x - f.wakePrev[2 * j]!, y - f.wakePrev[2 * j + 1]!);
          if (v > 0.05) this.sim.splat(x / s, y / s, -k * v * f.wakeW[j]! * surface, 1.6);
        }
        f.wakePrev[2 * j] = x;
        f.wakePrev[2 * j + 1] = y;
      });
    }
    this.havePrev = true;
    if (!this.dropped && this.elapsed >= this.opts.duration - 60) {
      this.dropped = true; // the S locks: one soft pulse from its centre, then the water stills
      this.dropAt = this.elapsed;
      this.sim.splat(this.rig.center[0], this.rig.center[1], UNION_DROP, 3.5);
      if (this.soundOn) this.sound?.union();
    }
  }

  private advance(dt: number): void {
    const step = Math.min(dt, 50); // tab switches / long frames
    this.elapsed += step;
    this.updatePoses();
    this.pushWater(step);
    // after the drop's ring has spread a little, the whole surface settles flat
    if (this.opts.idle === 'none') {
      const k = smoothstep(CALM_DELAY_MS, CALM_DELAY_MS + CALM_MS, this.elapsed - this.dropAt);
      this.sim.damp = SIM_DAMP + (CALM_DAMP - SIM_DAMP) * k;
    }
    this.simAcc += step;
    let n = 0;
    while (this.simAcc >= 1000 / SIM_HZ && n < 4) {
      this.sim.step();
      this.simAcc -= 1000 / SIM_HZ;
      n++;
    }
    if (n === 4) this.simAcc = 0;
    this.peak = this.sim.encode(Math.min(this.simAcc / (1000 / SIM_HZ), 1));

    this.render();
  }

  // ---------- GL ----------

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type);
    if (!sh) throw new KoiIntroError('shader-compile-failed', 'createShader failed');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(sh) ?? '';
      gl.deleteShader(sh);
      throw new KoiIntroError('shader-compile-failed', log);
    }
    return sh;
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram();
    if (!p) throw new KoiIntroError('shader-compile-failed', 'createProgram failed');
    const v = this.compile(gl.VERTEX_SHADER, vs);
    const f = this.compile(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new KoiIntroError('shader-compile-failed', gl.getProgramInfoLog(p) ?? 'link failed');
    }
    this.uniforms.set(p, new Map());
    return p;
  }

  private u(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    const cache = this.uniforms.get(prog)!;
    if (!cache.has(name)) cache.set(name, this.gl.getUniformLocation(prog, name));
    return cache.get(name)!;
  }

  private texture(
    src: HTMLImageElement | null,
    kind: 'color' | 'tile' | 'data' | 'target',
    w = 0,
    h = 0,
  ): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    if (!t) throw new KoiIntroError('webgl-unavailable', 'createTexture failed');
    gl.bindTexture(gl.TEXTURE_2D, t);
    const mip = kind === 'color' || kind === 'tile';
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, kind === 'color');
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, mip ? gl.BROWSER_DEFAULT_WEBGL : gl.NONE);
    if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const wrap = kind === 'tile' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    const nearest = kind === 'data' && src !== null; // aux sigma maps must not be interpolated
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D); // assets are power-of-two
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    }
    return t;
  }

  private target(w: number, h: number): Target | null {
    const gl = this.gl;
    const tex = this.texture(null, 'target', w, h);
    const fb = gl.createFramebuffer();
    if (!fb) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      return null;
    }
    return { fb, tex, w, h };
  }

  private dropTarget(t: Target | null): void {
    if (!t || this.gl.isContextLost()) return;
    this.gl.deleteFramebuffer(t.fb);
    this.gl.deleteTexture(t.tex);
  }

  private buffer(target: number, data: ArrayBufferView, usage: number): WebGLBuffer {
    const gl = this.gl;
    const b = gl.createBuffer();
    if (!b) throw new KoiIntroError('webgl-unavailable', 'createBuffer failed');
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage);
    return b;
  }

  private initGL(): void {
    const gl = this.gl;
    const n = this.sim.n;
    const water = this.texture(null, 'data', n, n);
    const fish = this.fish.map((f): FishBuffers => {
      const idx: number[] = [];
      for (let c = 0; c < f.cols - 1; c++) {
        for (let r = 0; r < ROWS - 1; r++) {
          const v = c * ROWS + r;
          idx.push(v, v + ROWS, v + 1, v + 1, v + ROWS, v + ROWS + 1);
        }
      }
      return {
        posBuf: this.buffer(gl.ARRAY_BUFFER, f.pos, gl.DYNAMIC_DRAW),
        uvBuf: this.buffer(gl.ARRAY_BUFFER, f.uv, gl.STATIC_DRAW),
        sigBuf: this.buffer(gl.ARRAY_BUFFER, f.sigNorm, gl.STATIC_DRAW),
        idxBuf: this.buffer(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW),
        count: idx.length,
      };
    });
    this.res = {
      bgProg: this.program(VS_QUAD, FS_BG),
      fishProg: this.program(VS_FISH, FS_FISH),
      compProg: this.program(VS_QUAD, FS_COMP),
      quadBuf: this.buffer(
        gl.ARRAY_BUFFER,
        new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
        gl.STATIC_DRAW,
      ),
      tex: {
        bg: this.texture(this.images.bg, 'color'),
        white: this.texture(this.images.white, 'color'),
        black: this.texture(this.images.black, 'color'),
        aux: this.texture(this.images.aux, 'data'),
        caustics: this.texture(this.images.caustics, 'tile'),
        water,
      },
      fish,
      shadow: this.target(SHADOW_RES, SHADOW_RES),
      scene: null, // sized in render()
    };
  }

  private freeGL(): void {
    const gl = this.gl;
    const r = this.res;
    this.res = null;
    if (!r || gl.isContextLost()) return;
    [r.bgProg, r.fishProg, r.compProg].forEach((p) => gl.deleteProgram(p));
    gl.deleteBuffer(r.quadBuf);
    Object.values(r.tex).forEach((t) => gl.deleteTexture(t));
    r.fish.forEach((b) =>
      [b.posBuf, b.uvBuf, b.sigBuf, b.idxBuf].forEach((x) => gl.deleteBuffer(x)),
    );
    this.dropTarget(r.shadow);
    this.dropTarget(r.scene);
  }

  private attrib(prog: WebGLProgram, name: string, buf: WebGLBuffer, size: number): void {
    const gl = this.gl;
    const loc = gl.getAttribLocation(prog, name);
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  private use(prog: WebGLProgram): void {
    const gl = this.gl;
    for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
    gl.useProgram(prog);
  }

  private bindTex(prog: WebGLProgram, name: string, unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.u(prog, name), unit);
  }

  private drawFish(
    r: GLRes,
    shadowPass: boolean,
    waterU: { t: number; amb: number; caustic: number },
  ): void {
    const gl = this.gl;
    const prog = r.fishProg;
    this.use(prog);
    gl.uniform2f(
      this.u(prog, 'uOffset'),
      shadowPass ? SHADOW_OFFSET[0] : 0,
      shadowPass ? SHADOW_OFFSET[1] : 0,
    );
    gl.uniform1f(this.u(prog, 'uShadowPass'), shadowPass ? 1 : 0);
    gl.uniform1f(this.u(prog, 'uTime'), waterU.t);
    gl.uniform1f(this.u(prog, 'uAmb'), waterU.amb);
    gl.uniform1f(this.u(prog, 'uCaustic'), waterU.caustic);
    // At rest the white lies on top (the black tail runs under the S). While swimming the black
    // is also drawn over the white, fading out as it settles, so it never disappears behind.
    const black = this.fish.find((x) => x.rig.name === 'black');
    const over = shadowPass || !black ? 0 : 1 - smoothstep(0.72, 0.97, black.progress);
    const passes: ['white' | 'black', number][] = [
      ['black', 1],
      ['white', 1],
    ];
    if (over > 0.001) passes.push(['black', over]);
    for (const [name, opacity] of passes) {
      const i = this.fish.findIndex((x) => x.rig.name === name);
      if (i < 0) continue;
      const f = this.fish[i]!;
      const b = r.fish[i]!;
      this.attrib(prog, 'aPos', b.posBuf, 2);
      this.attrib(prog, 'aUV', b.uvBuf, 2);
      this.attrib(prog, 'aSig', b.sigBuf, 1);
      this.bindTex(prog, 'uTex', 0, r.tex[name]);
      this.bindTex(prog, 'uAux', 1, r.tex.aux);
      this.bindTex(prog, 'uCaus', 2, r.tex.caustics);
      gl.uniform1f(this.u(prog, 'uPanel'), f.panel);
      gl.uniform1f(this.u(prog, 'uSoft'), 1 - smoothstep(0.9, 1, f.progress));
      gl.uniform1f(this.u(prog, 'uTol'), f.tol);
      gl.uniform1f(this.u(prog, 'uDepth'), f.depth);
      gl.uniform1f(this.u(prog, 'uOpacity'), opacity);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idxBuf);
      gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_SHORT, 0);
    }
  }

  private drawQuad(prog: WebGLProgram): void {
    this.attrib(prog, 'aP', this.res!.quadBuf, 2);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  private render(): void {
    const gl = this.gl;
    const r = this.res;
    if (!r || gl.isContextLost()) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!r.scene || r.scene.w !== W || r.scene.h !== H) {
      this.dropTarget(r.scene);
      r.scene = this.target(W, H);
    }

    // Ambient water: full while swimming, easing to a calm idle level (or flat for idle "none").
    const after = this.elapsed - this.opts.duration;
    // idle "water": swell eases to a calm living level. idle "none": the drop stills the pond —
    // swell, caustic shimmer and ripples all fade to a flat, static surface.
    const amb =
      this.opts.idle === 'water'
        ? 1 + (IDLE_AMBIENT - 1) * smoothstep(0, SETTLE_MS, after)
        : 1 - smoothstep(CALM_DELAY_MS * 0.5, CALM_DELAY_MS + CALM_MS, this.elapsed - this.dropAt);
    const caustic = this.opts.idle === 'water' ? 0.55 + 0.45 * amb : amb; // "none" ends on the clean art
    const water = { t: (this.elapsed / 1000) % 3600, amb, caustic };

    const n = this.sim.n;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.tex.water);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, this.sim.pixels);

    this.fish.forEach((f, i) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, r.fish[i]!.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.pos);
    });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    // 1. soft fish shadows on the pond floor
    if (r.shadow) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, r.shadow.fb);
      gl.viewport(0, 0, SHADOW_RES, SHADOW_RES);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawFish(r, true, water);
    }

    // 2. floor + fish into the scene target (or straight to screen if targets are unsupported)
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.scene ? r.scene.fb : null);
    gl.viewport(0, 0, W, H);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.use(r.bgProg);
    this.bindTex(r.bgProg, 'uTex', 0, r.tex.bg);
    this.bindTex(r.bgProg, 'uAux', 1, r.tex.aux);
    this.bindTex(r.bgProg, 'uWater', 2, r.tex.water);
    this.bindTex(r.bgProg, 'uShadow', 3, r.shadow ? r.shadow.tex : r.tex.water);
    this.bindTex(r.bgProg, 'uCaus', 4, r.tex.caustics);
    gl.uniform1f(this.u(r.bgProg, 'uTime'), water.t);
    gl.uniform1f(this.u(r.bgProg, 'uAmb'), water.amb);
    gl.uniform1f(this.u(r.bgProg, 'uCaustic'), water.caustic);
    gl.uniform1f(this.u(r.bgProg, 'uShadowOn'), r.shadow ? 1 : 0);
    gl.uniform2f(this.u(r.bgProg, 'uC'), this.rig.center[0], this.rig.center[1]);
    this.drawQuad(r.bgProg);
    this.drawFish(r, false, water);
    if (!r.scene) return;

    // 3. the surface: refraction + glints
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.use(r.compProg);
    this.bindTex(r.compProg, 'uScene', 0, r.scene.tex);
    this.bindTex(r.compProg, 'uWater', 1, r.tex.water);
    this.bindTex(r.compProg, 'uAux', 2, r.tex.aux);
    gl.uniform1f(this.u(r.compProg, 'uTime'), water.t);
    gl.uniform1f(this.u(r.compProg, 'uAmb'), water.amb);
    this.drawQuad(r.compProg);
  }

  // ---------- loop ----------

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = this.last ? now - this.last : 16.67;
    this.last = now;
    this.advance(dt);
    const after = this.elapsed - this.opts.duration;
    if (after >= 0) this.settle();
    if (this.opts.idle === 'none' && after > SETTLE_MS && this.peak < CALM_EPS) {
      this.stop();
      this.sim.reset(); // perfectly flat, static final frame
      this.peak = this.sim.encode();
      this.render();
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private settle(): void {
    this.assembled?.resolve();
    this.assembled = null;
  }

  private start(): void {
    this.stop();
    this.running = true;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxPixelRatio);
    const px = Math.min(Math.round(this.canvas.clientWidth * dpr), this.rig.size);
    if (px > 0 && (this.canvas.width !== px || this.canvas.height !== px)) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    if (!this.running) this.render();
  }

  private onLost = (e: Event): void => {
    e.preventDefault(); // allow restore
    this.stop();
    this.res = null;
    this.opts.onError?.(new KoiIntroError('context-lost', 'WebGL context lost'));
  };

  private onRestored = (): void => {
    if (this.destroyed) return;
    try {
      this.initGL();
      if (this.elapsed < this.opts.duration + SETTLE_MS || this.opts.idle === 'water') this.start();
      else this.render();
    } catch (err) {
      const e =
        err instanceof KoiIntroError ? err : new KoiIntroError('webgl-unavailable', String(err));
      this.assembled?.reject(e);
      this.opts.onError?.(e);
    }
  };
}
