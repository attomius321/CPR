// The view server's logs (LG1): a line per request, and the pages' errors.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parsePageError } from './server-requests.js';
import type { ServerContext } from './server-context.js';
import { answers, send, type ServerHttp } from './server-http.js';

/** Most a page's error may weigh (LG1), and how many the pages may send a minute. */
const MAX_PAGE_ERROR = 32 * 1024;

const PAGE_ERRORS_A_MINUTE = 60;

/**
 * Writes that come many times a minute, written at `debug` as reads are (LG1): keys typed in a
 * terminal and its size, a review's marks and drafts as they are saved.
 */
const CHATTY = /^\/api\/terminals\/[0-9a-z]+\/(?:in|resize)$|\/api\/state\//;

/** A terminal's ID in a request's path: what keeps other sites out of it, so written short. */
const TERMINAL_ID = /^(\/api\/terminals\/[0-9a-z]{8})[0-9a-z]+/;

/** A request's line, and `POST /api/logs`; the pages' errors counted a minute. */
export function serverLogs(
  { log }: Pick<ServerContext, 'log'>,
  { writtenOpen }: Pick<ServerHttp, 'writtenOpen'>,
) {
  // The pages' errors, as they sent them: `err` is theirs, not an Error for pino to read.
  const pageLog = log.as('viewer').child({}, { serializers: { err: (err: unknown) => err } });
  const pageErrors = { since: 0, count: 0 };
  /**
   * A request's line (LG1, decision 354), once it has ended: its method, path, status and time.
   * A `5xx` is an error, with the stack when the request threw; other writes are `info`, with
   * a refusal's words; reads and the chatty writes are `debug`. What a request carried is never
   * written (decision 356).
   */
  function requestLine(req: IncomingMessage, res: ServerResponse, ms: number, failure: unknown) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/logs') return;
    const status = res.statusCode;
    const refusal = status >= 400 ? answers.get(res) : undefined;
    const fields = {
      method: req.method,
      path: url.pathname.replace(TERMINAL_ID, '$1…'),
      ...(url.search ? { query: url.search.slice(0, 300) } : {}),
      status,
      ms: Math.round(ms),
      ...(failure === undefined ? {} : { err: failure }),
      ...(refusal === undefined ? {} : { answer: refusal }),
    };
    if (status >= 500) log.log.error(fields, 'request failed');
    else if (req.method === 'GET' || req.method === 'HEAD' || CHATTY.test(url.pathname)) {
      log.log.debug(fields, 'request');
    } else log.log.info(fields, 'request');
  }

  /**
   * `POST /api/logs` (LG1, decision 353): a page's error (`viewer/src/ui/report.ts`), written as
   * a `viewer` line. From the pages only, as any write; 32 KB, and 60 a minute, at most.
   */
  async function pageError(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (Number(req.headers['content-length']) > MAX_PAGE_ERROR) {
      req.resume();
      return send(res, 413, `a page's error of at most ${MAX_PAGE_ERROR / 1024} KB`);
    }
    // Without the page key (SC1): a tab that reads only reports its errors too.
    return writtenOpen(
      req,
      res,
      parsePageError,
      ({ level, msg, ...fields }) => {
        const now = Date.now();
        if (now - pageErrors.since >= 60_000) Object.assign(pageErrors, { since: now, count: 0 });
        if (pageErrors.count >= PAGE_ERRORS_A_MINUTE) {
          send(res, 429, "too many of the pages' errors this minute");
          return Promise.resolve();
        }
        pageErrors.count++;
        pageLog[level](fields, msg);
        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();
        return Promise.resolve();
      },
      MAX_PAGE_ERROR,
    );
  }

  return { requestLine, pageError };
}
