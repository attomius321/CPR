import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadPty,
  terminals,
  type Pty,
  type SpawnPty,
  type TerminalListener,
} from '../src/terminal.js';

/** A fake pseudo-terminal: records what it is asked, prints and exits when told. */
function fakePty() {
  const made: {
    file: string;
    args: string[];
    options: Parameters<SpawnPty>[2];
    written: string[];
    sizes: [number, number][];
    signals: (string | undefined)[];
    print: (data: string) => void;
    exit: (code: number) => void;
  }[] = [];
  const spawn: SpawnPty = (file, args, options) => {
    let onData: (data: string) => void = () => {};
    let onExit: (event: { exitCode: number }) => void = () => {};
    const record = {
      file,
      args,
      options,
      written: [] as string[],
      sizes: [] as [number, number][],
      signals: [] as (string | undefined)[],
      print: (data: string) => onData(data),
      exit: (code: number) => onExit({ exitCode: code }),
    };
    made.push(record);
    const pty: Pty = {
      onData: (listener) => (onData = listener),
      onExit: (listener) => (onExit = listener),
      write: (data) => record.written.push(data),
      resize: (cols, rows) => record.sizes.push([cols, rows]),
      kill: (signal) => record.signals.push(signal),
    };
    return pty;
  };
  return { made, pty: () => Promise.resolve({ spawn }) };
}

function reader() {
  const seen: string[] = [];
  const ended: number[] = [];
  const listener: TerminalListener = {
    out: (data) => seen.push(data),
    exit: (code) => ended.push(code),
  };
  return { seen, ended, listener };
}

const request = {
  command: '/usr/bin/claude',
  args: ['attach', 'abc'],
  cwd: '/work/app.worktrees/feature-x',
  cols: 100,
  rows: 30,
  env: { PATH: '/usr/bin', HOME: '/home/a', UNSET: undefined },
};

afterEach(() => {
  vi.useRealTimers();
});

describe('terminals', () => {
  it("runs the program in the worktree, in a colour terminal, with symbiote view's environment", async () => {
    const fake = fakePty();
    const t = terminals({ pty: fake.pty });
    const id = await t.open(request);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(await t.open(request)).not.toBe(id);
    const [made] = fake.made;
    expect(made?.file).toBe('/usr/bin/claude');
    expect(made?.args).toEqual(['attach', 'abc']);
    expect(made?.options).toEqual({
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: '/work/app.worktrees/feature-x',
      env: { PATH: '/usr/bin', HOME: '/home/a', TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    t.closeAll();
  });

  it('gives a reader what was printed so far, then what is printed, then the end', async () => {
    const fake = fakePty();
    const t = terminals({ pty: fake.pty });
    const id = await t.open(request);
    const made = fake.made[0]!;
    made.print('Claude Code\r\n');
    made.print('> ');
    const first = reader();
    t.listen(id, first.listener);
    expect(first.seen).toEqual(['Claude Code\r\n> ']);
    made.print('hi');
    const late = reader();
    t.listen(id, late.listener);
    expect(late.seen).toEqual(['Claude Code\r\n> hi']);
    made.print('!');
    expect(first.seen).toEqual(['Claude Code\r\n> ', 'hi', '!']);
    expect(late.seen.at(-1)).toBe('!');
    made.exit(0);
    expect(first.ended).toEqual([0]);
    expect(late.ended).toEqual([0]);
    // Gone once it ended: nothing to read or write.
    expect(t.listen(id, reader().listener)).toBeUndefined();
    expect(t.write(id, 'x')).toBe(false);
  });

  it('keeps at most maxOutput of what was printed, the oldest dropped', async () => {
    const fake = fakePty();
    const t = terminals({ pty: fake.pty, maxOutput: 10 });
    const id = await t.open(request);
    for (const chunk of ['aaaa', 'bbbb', 'cccc', 'dddd']) fake.made[0]!.print(chunk);
    const r = reader();
    t.listen(id, r.listener);
    expect(r.seen).toEqual(['ccccdddd']);
    t.closeAll();
  });

  it('writes keys and sizes to its terminal; unknown IDs are refused', async () => {
    const fake = fakePty();
    const t = terminals({ pty: fake.pty });
    const id = await t.open(request);
    expect(t.write(id, 'yes\r')).toBe(true);
    expect(t.resize(id, 80, 24)).toBe(true);
    expect(fake.made[0]?.written).toEqual(['yes\r']);
    expect(fake.made[0]?.sizes).toEqual([[80, 24]]);
    expect(t.write('nope', 'x')).toBe(false);
    expect(t.resize('nope', 80, 24)).toBe(false);
    expect(t.close('nope')).toBe(false);
    t.closeAll();
  });

  it('hangs up on close (no signal on Windows), and the ID is gone at once', async () => {
    const fake = fakePty();
    const t = terminals({ pty: fake.pty });
    const id = await t.open(request);
    const r = reader();
    t.listen(id, r.listener);
    expect(t.close(id)).toBe(true);
    expect(fake.made[0]?.signals).toEqual(['SIGHUP']);
    expect(t.write(id, 'x')).toBe(false);
    // Its reader still learns how it ended.
    fake.made[0]!.exit(129);
    expect(r.ended).toEqual([129]);

    const windows = fakePty();
    const w = terminals({ pty: windows.pty, platform: 'win32' });
    w.close(await w.open(request));
    expect(windows.made[0]?.signals).toEqual([undefined]);
  });

  it('hangs up one nobody reads for graceMs; a reader within that keeps it', async () => {
    vi.useFakeTimers();
    const fake = fakePty();
    const t = terminals({ pty: fake.pty, graceMs: 10_000 });
    const id = await t.open(request);
    vi.advanceTimersByTime(9_000);
    const stop = t.listen(id, reader().listener);
    vi.advanceTimersByTime(60_000);
    expect(fake.made[0]?.signals).toEqual([]);
    // The page goes (a reload): it has 10 s to come back.
    stop?.();
    vi.advanceTimersByTime(9_000);
    t.listen(id, reader().listener);
    vi.advanceTimersByTime(60_000);
    expect(fake.made[0]?.signals).toEqual([]);

    // Never read at all: hung up too.
    const other = await t.open(request);
    vi.advanceTimersByTime(10_000);
    expect(fake.made[1]?.signals).toEqual(['SIGHUP']);
    expect(t.write(other, 'x')).toBe(true);
    t.closeAll();
  });

  it('opens at most limit: a new one hangs up the oldest nobody reads, else is refused', async () => {
    const fake = fakePty();
    const t = terminals({ pty: fake.pty, limit: 2 });
    const a = await t.open(request);
    const b = await t.open(request);
    t.listen(b, reader().listener);
    const c = await t.open(request);
    expect(fake.made[0]?.signals).toEqual(['SIGHUP']);
    expect(t.write(a, 'x')).toBe(false);
    t.listen(c, reader().listener);
    await expect(t.open(request)).rejects.toThrow('2 terminals are open: close one first');
    t.closeAll();
  });

  it('closeAll hangs every terminal up and ends its readers', async () => {
    const fake = fakePty();
    const t = terminals({ pty: fake.pty });
    const id = await t.open(request);
    const r = reader();
    t.listen(id, r.listener);
    await t.open(request);
    t.closeAll();
    expect(fake.made.map((m) => m.signals)).toEqual([['SIGHUP'], ['SIGHUP']]);
    expect(r.ended).toEqual([0]);
    expect(t.write(id, 'x')).toBe(false);
  });

  it('says why terminals cannot run, and refuses to open one', async () => {
    const t = terminals({ pty: () => Promise.resolve({ error: 'node-pty is not installed' }) });
    expect(await t.available()).toEqual({
      available: false,
      reason: 'node-pty is not installed',
    });
    await expect(t.open(request)).rejects.toThrow('node-pty is not installed');
    expect(await terminals({ pty: fakePty().pty }).available()).toEqual({ available: true });
  });
});

describe('loadPty', () => {
  it("takes node-pty's spawn, from a CommonJS module's default too", async () => {
    const spawn = () => ({}) as Pty;
    expect(await loadPty(() => Promise.resolve({ spawn }))).toEqual({ spawn });
    expect(await loadPty(() => Promise.resolve({ default: { spawn } }))).toEqual({ spawn });
  });

  it('says whether it is missing or did not load', async () => {
    const missing = Object.assign(new Error("Cannot find package 'node-pty' imported from x"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    expect(await loadPty(() => Promise.reject(missing))).toEqual({
      error: 'node-pty is not installed',
    });
    const built = new Error(
      "The module 'pty.node' was compiled against a different Node.js version\nMore",
    );
    expect(await loadPty(() => Promise.reject(built))).toEqual({
      error:
        "node-pty did not load: The module 'pty.node' was compiled against a different Node.js version",
    });
  });

  it('loads the real one here (an optional dependency, built on install)', async () => {
    const result = await loadPty();
    expect('spawn' in result ? 'loaded' : result.error).toBe('loaded');
  });

  it('runs a program in a real terminal: keys in, output out, hung up on close', async () => {
    const t = terminals();
    // Raw mode, as Claude Code's interface: each key arrives as typed.
    const script =
      "process.stdin.setRawMode(true); process.stdout.write('ready> ');" +
      "process.stdin.on('data', (d) => process.stdout.write('got:' + d));" +
      "process.on('SIGHUP', () => process.exit(7));";
    const id = await t.open({
      ...request,
      command: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env: process.env,
    });
    const r = reader();
    t.listen(id, r.listener);
    const printed = (text: string) =>
      vi.waitFor(() => expect(r.seen.join('')).toContain(text), { timeout: 5_000 });
    await printed('ready> ');
    t.write(id, 'y');
    await printed('got:y');
    t.close(id);
    await vi.waitFor(() => expect(r.ended).toEqual([7]), { timeout: 5_000 });
  });
});
