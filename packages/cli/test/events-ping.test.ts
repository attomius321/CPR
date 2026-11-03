// The hooks' ping (V94c, decision 905): after its write, a hook tells each `symbiote view` of its
// records' folder, found in the registry of the cache folder on its command line, with a POST
// written on a bare socket and not waited for (the spike: 3 ms against node:http's 15; a hung view
// cost an awaited ping 179–193 ms).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ping, viewPorts } from '../src/events-ping.js';
import { agentSettings } from '../src/claude-code.js';
import { hookArgs } from '../src/thread.js';

const folders: string[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A view that keeps what it is sent, answering nothing. */
async function view(): Promise<{ port: number; got: () => string }> {
  let got = '';
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on('data', (data) => (got += data.toString()));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  return { port, got: () => got };
}

function registry(records: Record<string, unknown>[]): string {
  const cache = mkdtempSync(join(tmpdir(), 'events-ping-'));
  folders.push(cache);
  mkdirSync(join(cache, 'running'));
  for (const [i, record] of records.entries()) {
    writeFileSync(join(cache, 'running', `${1000 + i}.json`), JSON.stringify(record));
  }
  return cache;
}

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the hooks’ ping (V94c)', () => {
  it("finds the views of its records' folder; a record before V94c by its root", () => {
    const cache = registry([
      { url: 'http://127.0.0.1:4101/', root: '/w/repo.worktrees/x', symbiote: '/w/repo/symbiote' },
      { url: 'http://127.0.0.1:4102/', root: '/w/repo' },
      { url: 'http://127.0.0.1:4103/', root: '/w/other', symbiote: '/w/other/symbiote' },
      { broken: true },
    ]);
    writeFileSync(join(cache, 'running', 'note.txt'), 'not a record');
    expect(viewPorts('/w/repo/symbiote', cache).sort()).toEqual([4101, 4102]);
    expect(viewPorts('/w/repo/symbiote', join(cache, 'none'))).toEqual([]);
  });

  it('writes one POST to each, with its host, and the kind and branch it wrote', async () => {
    const a = await view();
    const b = await view();
    const cache = registry([
      { url: `http://127.0.0.1:${a.port}/`, root: '/w/repo', symbiote: '/w/repo/symbiote' },
      { url: `http://127.0.0.1:${b.port}/`, root: '/w/repo' },
    ]);
    await ping('/w/repo/symbiote', cache, { kind: 'thread', branch: 'feature/x' });
    await settle();
    for (const { port, got } of [a, b]) {
      const text = got();
      expect(text).toMatch(/^POST \/api\/events\/ping HTTP\/1\.1\r\n/);
      expect(text).toContain(`host: 127.0.0.1:${port}\r\n`);
      expect(text).toContain('x-symbiote: 1\r\n');
      expect(text).toContain('content-type: application/json\r\n');
      expect(text.split('\r\n\r\n')[1]).toBe('{"kind":"thread","branch":"feature/x"}');
    }
  });

  it('is done once written: a view that never answers costs it no wait', async () => {
    const hung = await view();
    const cache = registry([{ url: `http://127.0.0.1:${hung.port}/`, root: '/w/repo' }]);
    const started = performance.now();
    await ping('/w/repo/symbiote', cache, { kind: 'activity' });
    expect(performance.now() - started).toBeLessThan(100);
    await settle();
    expect(hung.got()).toContain('POST /api/events/ping');
  });

  it('never throws: no registry, a view gone', async () => {
    const gone = await view();
    const port = gone.port;
    await new Promise<void>((resolve) => servers.pop()?.close(() => resolve()));
    const cache = registry([{ url: `http://127.0.0.1:${port}/`, root: '/w/repo' }]);
    await expect(ping('/w/repo/symbiote', cache, { kind: 'thread' })).resolves.toBeUndefined();
    await expect(ping('/w/repo/symbiote', undefined, { kind: 'thread' })).resolves.toBeUndefined();
  });
});

describe("the hook's command line (V94c)", () => {
  it('names the cache folder: agents start with a clean environment', () => {
    const settings = JSON.parse(
      agentSettings(
        { node: '/n/node', hook: '/c/hooks/h/agent-hook.js', symbiote: '/r/symbiote', cache: '/c' },
        'linux',
      ),
    ) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    expect(settings.hooks.Stop?.[0]?.hooks[0]?.command).toBe(
      "'/n/node' '/c/hooks/h/agent-hook.js' '/r/symbiote' '--cache=/c'",
    );
    expect(settings.hooks.PostToolUse?.at(-1)?.hooks[0]?.command).toBe(
      "'/n/node' '/c/hooks/h/agent-hook.js' '/r/symbiote' activity '--cache=/c'",
    );
    const windows = JSON.parse(
      agentSettings(
        { node: 'C:\\n\\node.exe', hook: 'C:\\h.js', symbiote: 'C:\\r\\symbiote', cache: 'C:\\c' },
        'win32',
      ),
    ) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    expect(windows.hooks.Stop?.[0]?.hooks[0]?.command).toBe(
      '"C:\\n\\node.exe" "C:\\h.js" "C:\\r\\symbiote" "--cache=C:\\c"',
    );
  });

  it('reads the folder, the mode and the cache folder; a command line before V94c too', () => {
    expect(hookArgs(['/r/symbiote', 'activity', '--cache=/c'])).toEqual({
      symbiote: '/r/symbiote',
      mode: 'activity',
      cache: '/c',
    });
    expect(hookArgs(['/r/symbiote', '--cache=/c'])).toEqual({
      symbiote: '/r/symbiote',
      cache: '/c',
    });
    expect(hookArgs(['/r/symbiote', 'activity'])).toEqual({
      symbiote: '/r/symbiote',
      mode: 'activity',
    });
    expect(hookArgs([])).toEqual({});
  });
});
