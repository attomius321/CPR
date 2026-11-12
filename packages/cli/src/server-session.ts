// The page key's routes (SC1, decision 930): `/api/session`, an opened address's token traded for
// the page key, and whether a request holds it; `/api/session/open`, an open token for the bridge
// key (the nexus frames a Symbiote with it); `/api/session/again`, a fresh address for a tab
// without the key, opened or printed by `symbiote view` itself, never answered to the asker.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerContext } from './server-context.js';
import {
  badBody,
  json,
  MAX_BODY_BYTES,
  readBody,
  refuseKey,
  send,
  type ServerHttp,
} from './server-http.js';

/** How long after a fresh address another is opened: a page's Retry, never a flood of tabs. */
const AGAIN_MS = 3000;

/** The token a trade sends: `{ k }`. */
function parseTrade(text: string): string {
  const value = JSON.parse(text) as { k?: unknown } | null;
  if (typeof value?.k !== 'string') throw new Error('k: the token of the address opened');
  return value.k;
}

export function serverSession(
  { keys, options }: Pick<ServerContext, 'keys' | 'options'>,
  { pageShaped }: Pick<ServerHttp, 'pageShaped'>,
) {
  let lastAgain = 0;

  async function sessionRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (url.pathname === '/api/session') {
      if (req.method === 'GET') return json(res, 200, { page: keys.isPage(req) });
      if (req.method !== 'POST') return send(res, 405, 'method not allowed');
      if (!pageShaped(req)) return send(res, 403, 'forbidden');
      let token: string;
      try {
        token = parseTrade(await readBody(req, MAX_BODY_BYTES));
      } catch (error) {
        return badBody(res, error);
      }
      const key = keys.trade(token);
      return key ? json(res, 200, { key }) : refuseKey(res);
    }
    if (url.pathname === '/api/session/open') {
      if (req.method !== 'POST') return send(res, 405, 'method not allowed');
      if (!pageShaped(req) || !keys.isBridge(req)) return send(res, 403, 'forbidden');
      return json(res, 200, { token: keys.open() });
    }
    if (url.pathname === '/api/session/again') {
      if (req.method !== 'POST') return send(res, 405, 'method not allowed');
      if (!pageShaped(req)) return send(res, 403, 'forbidden');
      if (!options.openAgain) return send(res, 404, 'not found');
      if (Date.now() - lastAgain < AGAIN_MS) return send(res, 429, 'opened a moment ago');
      lastAgain = Date.now();
      options.openAgain();
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    return send(res, 404, 'not found');
  }

  return { sessionRoute };
}
