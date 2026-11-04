// The hooks' ping (V94c, decision 905): after its write, an agent's hook tells each running
// `symbiote view` of its records' folder, so the page hears it where no file event comes (`/mnt/c`
// under WSL2 gives none). The views are found in the registry the nexus reads
// (`<cache>/running/<pid>.json`), in the cache folder given on the hook's command line: agents start
// with a clean environment, without `SYMBIOTE_CACHE_DIR`. The POST is written on a bare socket and
// not waited for: `node:http` costs ~15 ms to load in a hook, a bare socket 3 ms, and a hung view
// cost an awaited ping 179–193 ms (the spike). Node's own modules only: the hook's copy runs it.
import { readdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';

/** Most a ping may take, written or not: the agent's hook must not wait on a view. */
const CAP_MS = 150;

/**
 * The ports of the views serving the records' folder `symbiote`: by the record's `symbiote`, or,
 * for a record written before V94c, by its root (the folder's parent).
 */
export function viewPorts(symbiote: string, cache: string): number[] {
  const dir = join(cache, 'running');
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const ports: number[] = [];
  for (const name of names) {
    try {
      const record = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
        url?: unknown;
        root?: unknown;
        symbiote?: unknown;
      };
      const serves =
        typeof record.symbiote === 'string'
          ? record.symbiote === symbiote
          : record.root === dirname(symbiote);
      if (!serves || typeof record.url !== 'string') continue;
      const port = Number(new URL(record.url).port);
      if (port > 0) ports.push(port);
    } catch {
      // Not a record.
    }
  }
  return ports;
}

/** Tells each view of `symbiote` that a hook wrote; done once written. Never throws. */
export async function ping(
  symbiote: string,
  cache: string | undefined,
  wrote: { kind: 'thread' | 'activity'; branch?: string },
): Promise<void> {
  if (!cache) return;
  const body = JSON.stringify(wrote);
  await Promise.all(
    viewPorts(symbiote, cache).map(
      (port) =>
        new Promise<void>((resolve) => {
          const socket = connect(port, '127.0.0.1');
          const done = () => {
            clearTimeout(cap);
            socket.destroy();
            resolve();
          };
          const cap = setTimeout(done, CAP_MS);
          socket.on('error', done);
          // Written whole: the view reads it; its answer is not waited for.
          socket.on('finish', done);
          socket.end(
            `POST /api/events/ping HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nx-symbiote: 1\r\n` +
              `content-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n` +
              `connection: close\r\n\r\n${body}`,
          );
        }),
    ),
  );
}
