// SC1 (decision 930): the address a frame of the nexus opens a Symbiote at, with an open token the
// nexus asked for with that Symbiote's bridge key.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { frameAddress } from '../src/frame-address.js';

const closing: (() => void)[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake `symbiote view`: `/api/session/open` answers `status` with a token. */
async function fakeView(status = 200) {
  const seen: { path: string; headers: IncomingHttpHeaders }[] = [];
  const server: Server = createServer((req, res) => {
    seen.push({ path: req.url ?? '', headers: req.headers });
    req.resume();
    req.on('end', () => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(status === 200 ? JSON.stringify({ token: 'tok' }) : '{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closing.push(() => server.close());
  return { seen, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

function cacheWith(pid: number, key?: string): string {
  const cache = tempDir();
  dirs.push(cache);
  mkdirSync(join(cache, 'running'));
  writeFileSync(
    join(cache, 'running', `${pid}.json`),
    JSON.stringify({ pid, ...(key ? { key } : {}) }),
  );
  return cache;
}

describe('frameAddress', () => {
  it("asks the Symbiote for an open token with its record's bridge key", async () => {
    const view = await fakeView();
    const address = await frameAddress(cacheWith(42, 'b-key'), { url: view.url, pid: 42 });
    expect(address).toBe(`${view.url}#k=tok`);
    expect(view.seen).toHaveLength(1);
    expect(view.seen[0]?.path).toBe('/api/session/open');
    expect(view.seen[0]?.headers).toMatchObject({
      'x-symbiote': '1',
      'x-symbiote-key': 'b-key',
      'content-type': 'application/json',
    });
  });

  it('frames a Symbiote from before SC1 at its bare address: no key, or no such route', async () => {
    const view = await fakeView(404);
    expect(await frameAddress(cacheWith(43), { url: view.url, pid: 43 })).toBe(view.url);
    expect(view.seen).toHaveLength(0);
    expect(await frameAddress(cacheWith(44, 'k'), { url: view.url, pid: 44 })).toBe(view.url);
  });
});
