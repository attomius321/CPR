import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, isAbsolute, join } from 'node:path';
import type { Logger } from '@symbiote/log';
import type { FoldersAnswer } from './folders.js';
import type { Starter } from './start.js';
import type { Symbiote } from './symbiotes.js';

export interface NexusServerOptions {
  /** 0: any free port. */
  port: number;
  /** The running Symbiotes, read anew for each read of the page's. */
  symbiotes: () => Promise<Symbiote[]>;
  /**
   * A folder's folders and the places (NX2); null: where the Folders tab opens. Rejects with the
   * system's `code` when the folder cannot be listed.
   */
  folders: (path: string | null) => Promise<FoldersAnswer>;
  /** Starting and stopping `symbiote view` (NX2). */
  starter: Starter;
  /** The page's own files: `index.html`, `nexus.css`, `mark.png` (`packages/nexus/page`). */
  pageDir: string;
  /** The page's scripts, compiled (`dist/page`). */
  scriptsDir: string;
  /** The viewer's build (`@symbiote/viewer/dist`): its stylesheet, fonts and images. */
  viewerDir: string;
  log?: Logger;
}

export interface NexusServer {
  /** `http://127.0.0.1:<port>/`. */
  url: string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** A file's name in a folder served: no folders, nothing hidden, nothing encoded. */
const FILE_NAME = /^[\w-][\w.-]*$/;

/** The routes that write: they start or stop a Symbiote (NX2, decision 543). */
const WRITES = new Set(['/api/symbiotes', '/api/symbiotes/stop']);

/** The most a write's body may hold. */
const BODY_LIMIT = 64 * 1024;

/** A folder the system would not list, in words. */
const FOLDER_ERRORS: Record<string, [number, string]> = {
  ENOENT: [404, 'No such folder'],
  EACCES: [403, 'Permission denied'],
  EPERM: [403, 'Permission denied'],
  ENOTDIR: [400, 'Not a folder'],
};

/**
 * The nexus's server (NX1): its page, in the viewer's own stylesheet (decision 523), the running
 * Symbiotes, and (NX2) this PC's folders and starting or stopping a Symbiote. It answers only its
 * own address, as the viewer's server does, since the lists name the person's folders; it sends
 * no CORS headers, so no other site reads them. It takes a write only as the viewer's server does
 * (decision 543): JSON, `x-symbiote: 1`, its own origin if one is sent.
 */
export async function startNexusServer(options: NexusServerOptions): Promise<NexusServer> {
  const page = renderPage(options.pageDir, options.viewerDir);
  let hosts = new Set<string>();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hosts.has(req.headers.host ?? '')) return send(res, 421, 'unknown host');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (req.method === 'POST' && WRITES.has(path)) return write(req, res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'not allowed');
    if (path === '/') return send(res, 200, page, TYPES['.html']);
    if (path === '/api/folders') return listFolders(res, url.searchParams.get('path'));
    if (path === '/api/symbiotes') {
      let symbiotes: Symbiote[];
      try {
        symbiotes = await options.symbiotes();
      } catch (error) {
        options.log?.error({ err: error }, 'the running Symbiotes could not be read');
        return send(res, 500, (error as Error).message);
      }
      return send(res, 200, JSON.stringify({ symbiotes }), TYPES['.json']);
    }
    if (path === '/nexus.css' || path === '/mark.png') {
      return sendFile(res, join(options.pageDir, path.slice(1)), 'no-cache');
    }
    const script = /^\/page\/([^/]+\.js)$/.exec(path)?.[1];
    if (script && FILE_NAME.test(script)) {
      return sendFile(res, join(options.scriptsDir, script), 'no-cache');
    }
    // The viewer's assets are named by their content: kept by the browser.
    const asset = /^\/viewer\/assets\/([^/]+)$/.exec(path)?.[1];
    if (asset && FILE_NAME.test(asset)) {
      return sendFile(res, join(options.viewerDir, 'assets', asset), 'max-age=31536000, immutable');
    }
    if (WRITES.has(path)) return send(res, 405, 'not allowed');
    return send(res, 404, 'not found');
  }

  async function listFolders(res: ServerResponse, path: string | null): Promise<void> {
    if (path !== null && !isAbsolute(path)) {
      return sendJson(res, 400, { error: `Not an absolute path: ${path}` });
    }
    try {
      return sendJson(res, 200, await options.folders(path));
    } catch (error) {
      const known = FOLDER_ERRORS[(error as NodeJS.ErrnoException).code ?? ''];
      if (!known) throw error;
      return sendJson(res, known[0], { error: `${known[1]}: ${path ?? ''}` });
    }
  }

  async function write(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (!writable(req)) return send(res, 403, 'forbidden');
    const body = await readBody(req);
    if (body === 'too large') return send(res, 413, 'too large');
    const value = parseObject(body);
    if (path === '/api/symbiotes') {
      if (typeof value?.folder !== 'string') return send(res, 400, 'expected { folder }');
      const answer = await options.starter.start(value.folder);
      return sendJson(res, 'error' in answer ? 422 : 200, answer);
    }
    if (typeof value?.root !== 'string') return send(res, 400, 'expected { root }');
    if (await options.starter.stop(value.root)) {
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    return sendJson(res, 404, { error: `No Symbiote runs in ${value.root}` });
  }

  /** A write from the page itself: JSON, the custom header, and (if sent) our own origin. */
  function writable(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return (
      req.headers['x-symbiote'] === '1' &&
      !!req.headers['content-type']?.startsWith('application/json') &&
      (origin === undefined || hosts.has(origin.replace(/^http:\/\//, '')))
    );
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      options.log?.error({ err: error, path: req.url }, 'request failed');
      send(res, 500, String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * The page with the viewer's built stylesheet and its sans font (Geist, preloaded as the viewer
 * does), found from the viewer's `index.html`: their names change with every build.
 */
function renderPage(pageDir: string, viewerDir: string): string {
  let index: string;
  try {
    index = readFileSync(join(viewerDir, 'index.html'), 'utf8');
  } catch {
    index = '';
  }
  const css = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\.\/assets\/([^"]+\.css)"/.exec(
    index,
  )?.[1];
  if (!css) throw new Error(`the viewer is not built (${viewerDir}); run pnpm build`);
  const font = assetNames(viewerDir).find((name) =>
    /^geist-latin-wght-normal-[\w-]+\.woff2$/.test(name),
  );
  const template = readFileSync(join(pageDir, 'index.html'), 'utf8');
  return (
    font
      ? template.replaceAll('%GEIST%', `/viewer/assets/${font}`)
      : template.replace(/<link\b[^>]*%GEIST%[^>]*>\n?/g, '')
  ).replaceAll('%VIEWER_CSS%', `/viewer/assets/${css}`);
}

function assetNames(viewerDir: string): string[] {
  try {
    return readdirSync(join(viewerDir, 'assets'));
  } catch {
    return [];
  }
}

/** A request's body as text; 'too large' past `BODY_LIMIT`. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= BODY_LIMIT) body += chunk.toString();
    });
    req.on('end', () => resolve(size > BODY_LIMIT ? 'too large' : body));
    req.on('error', reject);
  });
}

/** A JSON object's fields, or null when the text is not one. */
function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), TYPES['.json']);
}

async function sendFile(res: ServerResponse, path: string, cache: string): Promise<void> {
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch {
    return send(res, 404, 'not found');
  }
  send(res, 200, body, TYPES[extname(path)] ?? 'application/octet-stream', cache);
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type = 'text/plain; charset=utf-8',
  cache = 'no-store',
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': type, 'cache-control': cache });
  res.end(body);
}
