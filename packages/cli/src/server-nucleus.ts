// The view server's page agents and MCP: Nucleus's and Scribe's API (V35, V41), `/api/mcp…` (MC1).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpCaller } from '@symbiote/core';
import {
  parseMcpAnswer,
  parseModelChange,
  parsePageAgentAsk,
  parsePageAgentOpen,
  parseEffortChange,
  parsePageAgentTerminal,
} from './server-requests.js';
import type { PageAgent } from './page-agent.js';
import { McpRefused, type SymbioteMcp } from './mcp.js';
import type { ServerKeys } from './server-keys.js';
import type { ServerContext } from './server-context.js';
import {
  read,
  answer,
  exported,
  MAX_BODY_BYTES,
  exportFormat,
  FORMAT_WORDS,
  json,
  send,
  BodyTooLarge,
  badBody,
  readBody,
  refuseKey,
  type ServerHttp,
} from './server-http.js';
import type { ServerSites } from './server-sites.js';
import type { ServerHive } from './server-hive.js';

/**
 * Who calls Symbiote's MCP (MC1): Nucleus when its bridge sends Nucleus's key (SC1, decision 931:
 * `x-symbiote-caller` alone, which any agent can send, no longer says so); else an agent through
 * `symbiote mcp`, as its bridge names it.
 */
function callerOf(req: IncomingMessage, keys: ServerKeys): McpCaller {
  if (keys.isNucleus(req)) return { via: 'nucleus' };
  const header = (name: string) => {
    const value = req.headers[name];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  const client = header('x-symbiote-client')?.slice(0, 200);
  let folder: string | undefined;
  try {
    folder = header('x-symbiote-folder') && decodeURIComponent(header('x-symbiote-folder') ?? '');
  } catch {
    folder = undefined;
  }
  return {
    via: 'mcp',
    ...(client ? { client } : {}),
    ...(folder ? { folder: folder.slice(0, 1000) } : {}),
  };
}

/** A page agent's routes, and Symbiote's MCP. */
export function serverNucleus(
  { root, keys }: Pick<ServerContext, 'root' | 'keys'>,
  uses: Pick<ServerHttp, 'written' | 'oneAtATime' | 'pageShaped' | 'keyed'> &
    Pick<ServerSites, 'serveSite'> &
    Pick<ServerHive, 'hiveOn'>,
) {
  const { written, oneAtATime, pageShaped, keyed, serveSite, hiveOn } = uses;
  /**
   * `/api/mcp` (MC1): one JSON-RPC message of an agent's, answered when its tool is done — an asked
   * one once the person answered —, and dropped when the agent hangs up; `/api/mcp/asks`, what waits
   * for the person; `/api/mcp/answer { id, yes }`, their answer from a page. The asks and the
   * answer are the page's (its key, SC1); `/api/mcp` is a bridge's (the bridge key in the view
   * record), which answers no Confirm.
   */
  async function mcpRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    mcp: SymbioteMcp,
  ): Promise<void> {
    if (url.pathname === '/api/mcp/asks') {
      if (req.method === 'GET' && !keyed(req)) return refuseKey(res);
      return read(req, res, () => Promise.resolve(mcp.asks()));
    }
    if (url.pathname === '/api/mcp/answer') {
      return written(req, res, parseMcpAnswer, async (answer) => {
        try {
          json(res, 200, await mcp.answer(answer));
        } catch (error) {
          if (!(error instanceof McpRefused)) throw error;
          json(res, error.status, { error: error.message });
        }
      });
    }
    if (url.pathname !== '/api/mcp') return send(res, 404, 'not found');
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!pageShaped(req) || !keys.isBridge(req)) return send(res, 403, 'forbidden');
    let message: unknown;
    try {
      message = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (error) {
      if (error instanceof BodyTooLarge) return badBody(res, error);
      return json(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'not JSON' },
      });
    }
    const hungUp = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) hungUp.abort();
    });
    const answer = await mcp.handle(message, callerOf(req, keys), hungUp.signal);
    if (hungUp.signal.aborted) return;
    if (answer) return json(res, 200, answer);
    // A notification has no answer; a call ended without one, by the server closing.
    const call = !!message && typeof message === 'object' && 'id' in message;
    if (call) return send(res, 503, 'Symbiote is closing');
    res.writeHead(202, { 'cache-control': 'no-store' });
    res.end();
  }

  /**
   * A page agent's API under `api` (Nucleus's, V35; Scribe's, V41): its state; a question or a new
   * conversation, one at a time (each starts or stops an agent), refused meanwhile with `busy`;
   * its terminal; the levels, read where a stepper shows them (Codex's start its daemon), and its
   * level and model (V47) in the project's config, set in Settings.
   */
  async function pageAgentRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    agent: PageAgent,
    { api, busy, hiveBusy }: { api: string; busy: string; hiveBusy?: string },
  ): Promise<void> {
    const said = async () => (hiveBusy && (await hiveOn()) ? hiveBusy : busy);
    if (url.pathname === api) return read(req, res, () => agent.state());
    if (url.pathname === `${api}/ask`) {
      return written(req, res, parsePageAgentAsk, (request) =>
        oneAtATime(res, busy, () => agent.ask(request), said),
      );
    }
    // Nucleus's conversation with no question (V50).
    if (url.pathname === `${api}/open`) {
      return written(req, res, parsePageAgentOpen, (request) =>
        oneAtATime(res, busy, () => agent.open(request), said),
      );
    }
    if (url.pathname === `${api}/new`) {
      return written(
        req,
        res,
        () => ({}),
        () => oneAtATime(res, busy, () => agent.renew(), said),
      );
    }
    if (url.pathname === `${api}/terminal`) {
      return written(req, res, parsePageAgentTerminal, (request) =>
        answer(res, () => agent.terminal(request)),
      );
    }
    // What Nucleus did (NU2): its activity file's newest megabyte.
    const { activity, exportActivity } = agent;
    if (url.pathname === `${api}/activity` && activity) return read(req, res, () => activity());
    // Taken out (V84): a file to save.
    if (url.pathname === `${api}/activity/export` && exportActivity) {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      const format = exportFormat(url);
      if (!format) return send(res, 400, FORMAT_WORDS);
      return exported(res, () => exportActivity(format));
    }
    if (url.pathname === `${api}/efforts`) return read(req, res, () => agent.efforts());
    if (url.pathname === `${api}/effort`) {
      return written(req, res, parseEffortChange, (change) =>
        answer(res, () => agent.setEffort(change)),
      );
    }
    if (url.pathname === `${api}/model`) {
      return written(req, res, parseModelChange, (change) =>
        answer(res, () => agent.setModel(change)),
      );
    }
    return serveSite(req, res, url, url.pathname, root);
  }

  return { pageAgentRoute, mcpRoute };
}
