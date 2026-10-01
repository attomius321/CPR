import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Recorded {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface Reply {
  status?: number;
  body: unknown;
}

/**
 * A tiny JSON API: `routes['GET /path']` answers, with a fixed reply or one computed from the
 * request; every request is recorded.
 */
export async function mockApi(routes: Record<string, Reply | ((request: Recorded) => Reply)>) {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const path = req.url ?? '/';
      const request: Recorded = {
        method: req.method ?? 'GET',
        path,
        headers: req.headers,
        body: raw ? (JSON.parse(raw) as unknown) : undefined,
      };
      requests.push(request);
      const handler = routes[`${request.method} ${path}`];
      const route = typeof handler === 'function' ? handler(request) : handler;
      res.writeHead(route?.status ?? (route ? 200 : 404), { 'content-type': 'application/json' });
      res.end(JSON.stringify(route?.body ?? { message: 'Not Found' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
