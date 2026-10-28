import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import type { Logger } from '@symbiote/log';
import type { Symbiote } from './symbiotes.js';

export interface NexusServerOptions {
  /** 0: any free port. */
  port: number;
  /** The running Symbiotes, read anew for each read of the page's. */
  symbiotes: () => Promise<Symbiote[]>;
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

/**
 * The nexus's server (NX1): its page, in the viewer's own stylesheet (decision 523), and the
 * running Symbiotes. It only reads (decision 526); it answers only its own address, as the
 * viewer's server does, since the list names the person's folders.
 */
export async function startNexusServer(options: NexusServerOptions): Promise<NexusServer> {
  const page = renderPage(options.pageDir, options.viewerDir);
  let hosts = new Set<string>();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hosts.has(req.headers.host ?? '')) return send(res, 421, 'unknown host');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'read only');
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/') return send(res, 200, page, TYPES['.html']);
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
    return send(res, 404, 'not found');
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
