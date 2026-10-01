import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import type { Graph } from '@cpr/core';

export type Side = 'base' | 'head';

export interface ViewServerOptions {
  graph: Graph;
  /** Folder with the built viewer (index.html, assets/). */
  viewerDir: string;
  /** Reads a repo-relative file on one side of the change. */
  readSource: (side: Side, path: string) => Promise<string>;
  /** Default: a free port. */
  port?: number;
}

export interface ViewServer {
  url: string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/**
 * Serves the viewer, `/api/graph` and `/api/source` on localhost only. Sources are limited to
 * files the graph mentions, so the server never exposes anything else from the machine.
 */
export async function startViewServer(options: ViewServerOptions): Promise<ViewServer> {
  const allowed = sourceFiles(options.graph);
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => send(res, 500, String(error)));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');

    if (url.pathname === '/api/graph') {
      return send(res, 200, JSON.stringify(options.graph), TYPES['.json']);
    }
    if (url.pathname === '/api/source') {
      const side = url.searchParams.get('side');
      const file = url.searchParams.get('file') ?? '';
      if ((side !== 'base' && side !== 'head') || !allowed[side].has(file)) {
        return send(res, 404, 'unknown source');
      }
      try {
        return send(res, 200, await options.readSource(side, file), 'text/plain; charset=utf-8');
      } catch {
        return send(res, 404, 'unknown source');
      }
    }

    // Static viewer files; anything outside the viewer folder is refused.
    const relative =
      normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '') || 'index.html';
    const path = join(options.viewerDir, relative);
    if (!path.startsWith(options.viewerDir + sep) && path !== options.viewerDir) {
      return send(res, 404, 'not found');
    }
    try {
      const body = await readFile(path);
      return send(res, 200, body, TYPES[extname(path)] ?? 'application/octet-stream');
    } catch {
      return send(res, 404, 'not found');
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type = 'text/plain',
): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

/** Repo-relative files per side that the graph refers to. */
export function sourceFiles(graph: Graph): Record<Side, Set<string>> {
  const files: Record<Side, Set<string>> = { base: new Set(), head: new Set() };
  for (const node of graph.nodes) {
    if (node.base) files.base.add(node.base.file);
    if (node.head) files.head.add(node.head.file);
  }
  for (const file of graph.files) {
    if (file.status !== 'added') files.base.add(file.previousPath ?? file.path);
    if (file.status !== 'deleted') files.head.add(file.path);
  }
  return files;
}
