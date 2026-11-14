// The view server's other pages' reads and writes: the intro (V39), the Monitor (RM1), the
// Issues page (IS1).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SymbioteError } from '@symbiote/core';
import { isIssueCursor } from '@symbiote/forge';
import type { IntroRecord } from './intro.js';
import type { IssueStarter } from './issue-start.js';
import type { IssueClassifier } from './issue-classifier.js';
import type { IssuesService } from './issues.js';
import type { RepositoryOptions, ViewServerOptions } from './server-context.js';
import { answer, json, send, type ServerHttp } from './server-http.js';

/** The checkout's map (RM1), or why there is none (no commit yet): 409 with its words. */
export async function monitorMap(
  req: IncomingMessage,
  res: ServerResponse,
  monitor: NonNullable<RepositoryOptions['monitor']>,
): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, 'method not allowed');
  try {
    return json(res, 200, await monitor.map());
  } catch (error) {
    if (error instanceof SymbioteError) return json(res, 409, { error: error.message });
    throw error;
  }
}

/**
 * A page of origin's issues (IS1): `?state=open|closed|all` (open when absent), `q` words of
 * titles, `cursor` a page's `next`. A problem is an answer of its own (`problem`), with 200.
 */
export async function issueList(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  issues: IssuesService,
): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, 'method not allowed');
  const state = url.searchParams.get('state') ?? 'open';
  if (state !== 'open' && state !== 'closed' && state !== 'all') {
    return send(res, 400, 'state: open, closed or all');
  }
  const search = url.searchParams.get('q') ?? '';
  if (search.length > MAX_ISSUE_SEARCH) {
    return send(res, 400, `q: at most ${MAX_ISSUE_SEARCH} characters`);
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && !isIssueCursor(cursor)) {
    return send(res, 400, "cursor: a page's next, as the list gave it");
  }
  return json(
    res,
    200,
    await issues.list({
      state,
      ...(search.trim() ? { search } : {}),
      ...(cursor !== null ? { cursor } : {}),
    }),
  );
}

/** One issue whole (IS1), by its number. */
export async function issueOne(
  req: IncomingMessage,
  res: ServerResponse,
  number: string,
  issues: IssuesService,
): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, 'method not allowed');
  if (!/^[1-9]\d{0,9}$/.test(number)) return send(res, 400, "an issue's number");
  return json(res, 200, await issues.one(Number(number)));
}

/** An issue's number in a path: 1 to 10 digits, no leading zero. */
const ISSUE_NUMBER = /^[1-9]\d{0,9}$/;

/** A classification's body: none, or `{}`. */
function parseNoBody(text: string): void {
  if (text.trim() === '') return;
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Object.keys(value).length > 0) {
    throw new Error('the body is {} or none');
  }
}

/**
 * `POST /api/issues/<n>/classify` (HV9b): the classifier on issue `n`, with the page key (SC1);
 * its record, or the refusal's words.
 */
export async function issueClassify(
  req: IncomingMessage,
  res: ServerResponse,
  number: string,
  classifier: IssueClassifier,
  written: ServerHttp['written'],
): Promise<void> {
  if (!ISSUE_NUMBER.test(number)) return send(res, 400, "an issue's number");
  return written(req, res, parseNoBody, () =>
    answer(res, () => classifier.classify(Number(number))),
  );
}

/**
 * `POST /api/issues/<n>/start` (HV10b): Start in Hive, the person's click, with the page key (SC1);
 * the workspace started, or the refusal's words.
 */
export async function issueStartOne(
  req: IncomingMessage,
  res: ServerResponse,
  number: string,
  starter: IssueStarter,
  written: ServerHttp['written'],
): Promise<void> {
  if (!ISSUE_NUMBER.test(number)) return send(res, 400, "an issue's number");
  return written(req, res, parseNoBody, () =>
    answer(res, () => starter.start(Number(number), { by: 'page' })),
  );
}

/** `GET /api/issues/<n>/classification` (HV9b): the issue's record, or 404 without one. */
export async function issueClassification(
  req: IncomingMessage,
  res: ServerResponse,
  number: string,
  classifier: IssueClassifier,
): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, 'method not allowed');
  if (!ISSUE_NUMBER.test(number)) return send(res, 400, "an issue's number");
  const record = await classifier.record(Number(number));
  if (!record) return json(res, 404, { error: `#${number} has not been classified` });
  return json(res, 200, record);
}

/** The most of an issue search's words (IS1): GitHub's search takes 256 characters, the rest. */
const MAX_ISSUE_SEARCH = 200;

/** The intro seen, and a file of the Monitor's map opened. */
export function serverPages(
  { options }: { options: Pick<ViewServerOptions, 'open'> },
  { writable, refused, written }: Pick<ServerHttp, 'writable' | 'refused' | 'written'>,
) {
  /** `GET /api/intro`: `{ show }`; `POST`: the intro seen (V39). */
  async function introApi(
    req: IncomingMessage,
    res: ServerResponse,
    intro: IntroRecord,
  ): Promise<void> {
    if (req.method === 'GET') return json(res, 200, { show: !(await intro.seen()) });
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return refused(req, res);
    await intro.markSeen();
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
  }

  /**
   * Opens a file of the Monitor's map in VS Code (RM1): `POST { path }`, a path of the map read,
   * at its commit's first line where that is in the working copy now. Nothing outside the map.
   */
  async function monitorOpen(
    req: IncomingMessage,
    res: ServerResponse,
    monitor: NonNullable<RepositoryOptions['monitor']>,
  ): Promise<void> {
    const { open } = options;
    if (!open) return send(res, 404, 'files open from symbiote view');
    return written(
      req,
      res,
      (text) => {
        const value = JSON.parse(text) as { path?: unknown } | null;
        if (typeof value?.path !== 'string') throw new Error("path: a file of the map's commit");
        return value.path;
      },
      async (path) => {
        const map = await monitor.map();
        if (!map.files.some((file) => file.path === path)) {
          return send(res, 400, `${path} is not a file of ${map.commit.slice(0, 7)}`);
        }
        const result = await open({ sha: map.commit, file: path, line: 1, column: 1 });
        if (!result.opened) {
          return json(res, result.reason === 'missing' ? 404 : 502, { error: result.message });
        }
        return json(res, 200, { line: result.line, how: result.how, moved: result.moved });
      },
    );
  }

  return { introApi, monitorOpen };
}
