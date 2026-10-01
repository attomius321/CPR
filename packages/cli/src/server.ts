import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import type { Graph } from '@cpr/core';
import type { Review, ReviewComment, ReviewEvent } from '@cpr/forge';

export type Side = 'base' | 'head';

/** What the viewer keeps between sessions: reviewed marks and draft comments. */
export type StateName = 'review' | 'drafts';
const STATE_NAMES: readonly StateName[] = ['review', 'drafts'];

export interface StateStore {
  /** The saved value, or null. */
  read(name: StateName): Promise<unknown>;
  write(name: StateName, value: unknown): Promise<void>;
}

/** Posts reviews to the change request being viewed (`cpr pr` only). */
export interface ReviewTarget {
  forge: 'github' | 'gitlab';
  submit(review: Review): Promise<{ url: string }>;
}

export interface ViewServerOptions {
  graph: Graph;
  /** Folder with the built viewer (index.html, assets/). */
  viewerDir: string;
  /** Reads a repo-relative file on one side of the change. */
  readSource: (side: Side, path: string) => Promise<string>;
  /** Default: a free port. */
  port?: number;
  /** Enables `POST /api/review`. */
  review?: ReviewTarget;
  /** Enables `/api/state/<name>`; without it the viewer keeps state in the browser. */
  state?: StateStore;
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

/** Largest review or state the viewer may send. */
const MAX_BODY_BYTES = 1 << 20;
const EVENTS: readonly ReviewEvent[] = ['comment', 'approve', 'request-changes'];

/**
 * Serves the viewer, `/api/graph` and `/api/source` on localhost only. Sources are limited to
 * files the graph mentions, so the server never exposes anything else from the machine.
 * Requests must name the server itself as host, which defeats DNS rebinding; writes (a review,
 * saved state) also need a same-origin JSON request with a custom header, which other sites
 * cannot send.
 */
export async function startViewServer(options: ViewServerOptions): Promise<ViewServer> {
  const allowed = sourceFiles(options.graph);
  let hosts: Set<string> = new Set();
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => send(res, 500, String(error)));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hosts.has(req.headers.host ?? '')) return send(res, 421, 'unknown host');
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/review') return postReview(req, res);
    if (url.pathname.startsWith('/api/state/')) {
      return state(req, res, url.pathname.slice('/api/state/'.length));
    }
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');

    if (url.pathname === '/api/capabilities') {
      const review = options.review ? { forge: options.review.forge } : null;
      const capabilities = { sources: true, review, state: options.state !== undefined };
      return send(res, 200, JSON.stringify(capabilities), TYPES['.json']);
    }
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

  async function postReview(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = options.review;
    if (!target) return send(res, 404, 'reviews are posted from cpr pr');
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');

    let review: Review;
    try {
      review = parseReview(await readBody(req, MAX_BODY_BYTES), allowed);
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    try {
      return send(res, 200, JSON.stringify(await target.submit(review)), TYPES['.json']);
    } catch (error) {
      // The forge's own words: no access, a line outside the diff, approving one's own PR…
      return send(res, 502, JSON.stringify({ error: (error as Error).message }), TYPES['.json']);
    }
  }

  async function state(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
    const store = options.state;
    if (!store || !STATE_NAMES.includes(name as StateName)) return send(res, 404, 'not found');
    if (req.method === 'GET') {
      return send(res, 200, JSON.stringify(await store.read(name as StateName)), TYPES['.json']);
    }
    if (req.method !== 'PUT') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let value: unknown;
    try {
      value = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (error) {
      return send(res, 400, (error as Error).message);
    }
    await store.write(name as StateName, value);
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
  }

  /** A write from the viewer itself: JSON, the custom header, and (if sent) our own origin. */
  function writable(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return (
      req.headers['x-cpr'] === '1' &&
      !!req.headers['content-type']?.startsWith('application/json') &&
      (origin === undefined || hosts.has(origin.replace(/^http:\/\//, '')))
    );
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
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

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('review too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Checks a review from the viewer: known event, comments only on files of this change. */
export function parseReview(text: string, allowed: Record<Side, Set<string>>): Review {
  const value = JSON.parse(text) as Partial<Record<keyof Review, unknown>>;
  if (!value || typeof value !== 'object') throw new Error('not a review');
  const { event, body, comments } = value;
  if (!EVENTS.includes(event as ReviewEvent)) throw new Error(`unknown event '${String(event)}'`);
  if (typeof body !== 'string') throw new Error('body must be a string');
  if (!Array.isArray(comments)) throw new Error('comments must be a list');
  return {
    event: event as ReviewEvent,
    body,
    comments: comments.map((raw: unknown, i): ReviewComment => {
      const c = (raw ?? {}) as Partial<Record<keyof ReviewComment, unknown>>;
      const where = `comment ${i + 1}`;
      if (c.side !== 'base' && c.side !== 'head') throw new Error(`${where}: side`);
      const other = c.side === 'head' ? 'base' : 'head';
      if (typeof c.path !== 'string' || !allowed[c.side].has(c.path)) {
        throw new Error(`${where}: ${String(c.path)} is not part of this change`);
      }
      if (
        typeof c.otherPath !== 'string' ||
        !(c.otherPath === c.path || allowed[other].has(c.otherPath))
      ) {
        throw new Error(`${where}: otherPath`);
      }
      if (typeof c.line !== 'number' || !Number.isInteger(c.line) || c.line < 1) {
        throw new Error(`${where}: line`);
      }
      if (typeof c.body !== 'string' || c.body.trim() === '') throw new Error(`${where}: empty`);
      return { side: c.side, path: c.path, otherPath: c.otherPath, line: c.line, body: c.body };
    }),
  };
}
