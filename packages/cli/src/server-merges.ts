// The view server's merges (V26): `/api/merges…`, a merge's log as server-sent events.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  parseMergeChanges,
  parseMergeId,
  parseMergeRequest,
  parseModelChange,
  parseEffortChange,
} from './server-requests.js';
import type { Workspaces } from './workspaces.js';
import { sendFailure, type Merger } from './merges.js';
import type { ServerContext } from './server-context.js';
import { read, ofBranch, answer, json, send, type ServerHttp } from './server-http.js';
import type { ServerSites } from './server-sites.js';

/** `/api/merges…`. */
export function serverMerges(
  { root }: Pick<ServerContext, 'root'>,
  uses: Pick<ServerHttp, 'written' | 'oneAtATime' | 'sameSite' | 'streamLog'> &
    Pick<ServerSites, 'serveSite'>,
) {
  const { written, oneAtATime, sameSite, streamLog, serveSite } = uses;
  /** `/api/merges…` (V26): the queue and a merge's entry, log, actions, effort and model. */
  async function mergesRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    merges: Merger,
    workspaces?: Workspaces,
  ): Promise<void> {
    if (url.pathname === '/api/merges') {
      if (req.method === 'GET') return answer(res, () => merges.list());
      return written(req, res, parseMergeRequest, (request) =>
        answer(res, () => merges.enqueue(request)),
      );
    }
    if (url.pathname === '/api/merges/targets') {
      return ofBranch(req, res, url, (branch) => merges.targets(branch));
    }
    if (url.pathname === '/api/merges/log') return mergeLog(req, res, url, merges);
    // The merger's effort (V46d), read and set where Settings' stepper shows it, as Nucleus's.
    if (url.pathname === '/api/merges/efforts') return read(req, res, () => merges.efforts());
    if (url.pathname === '/api/merges/effort') {
      return written(req, res, parseEffortChange, (change) =>
        answer(res, () => merges.setEffort(change)),
      );
    }
    if (url.pathname === '/api/merges/model') {
      return written(req, res, parseModelChange, (change) =>
        answer(res, () => merges.setModel(change)),
      );
    }
    if (url.pathname === '/api/merges/approve') {
      return written(req, res, parseMergeId, (id) => answer(res, () => merges.approve(id)));
    }
    if (url.pathname === '/api/merges/recheck') {
      return written(req, res, parseMergeId, (id) => answer(res, () => merges.recheck(id)));
    }
    // A failed check sent to the branch's agent, on the person's press (AR2, decision 742).
    if (url.pathname === '/api/merges/send') {
      return written(req, res, parseMergeId, (id) =>
        workspaces
          ? oneAtATime(res, 'a message is being sent', () =>
              sendFailure(merges, (request) => workspaces.reply(request), id),
            )
          : Promise.resolve(json(res, 409, { error: 'no workspaces here to send it to' })),
      );
    }
    // A fast-forward its target can no longer take, merged with a merge commit (V67).
    if (url.pathname === '/api/merges/merge-commit') {
      return written(req, res, parseMergeId, (id) => answer(res, () => merges.mergeCommit(id)));
    }
    if (url.pathname === '/api/merges/request-changes') {
      return written(req, res, parseMergeChanges, ({ id, comments }) =>
        answer(res, () => merges.requestChanges(id, comments)),
      );
    }
    const action = /^\/api\/merges\/(land|retry|remove)$/.exec(url.pathname)?.[1];
    if (action) {
      return written(req, res, parseMergeId, (id) =>
        answer(res, () =>
          action === 'land'
            ? merges.land(id)
            : action === 'retry'
              ? merges.retry(id)
              : merges.remove(id).then(() => ({})),
        ),
      );
    }
    return serveSite(req, res, url, url.pathname, root);
  }

  /**
   * `GET /api/merges/log?id=<id>&from=<byte>`: a merge's log as server-sent events (V46a,
   * decision 314). `lines` with the lines from `from` and the offset to read on from, then each
   * time the log grows, read every 250 ms: whichever process merges writes it. `gone` when its
   * entry is removed. Refused from another site, as a terminal's stream: a check prints the code.
   */
  async function mergeLog(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    merges: Merger,
  ): Promise<void> {
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    if (!sameSite(req)) return send(res, 403, 'forbidden');
    const id = url.searchParams.get('id');
    const from = Number(url.searchParams.get('from') ?? '0');
    if (!id || !Number.isSafeInteger(from) || from < 0) {
      return send(res, 400, 'id: a queued merge; from: an offset in its log');
    }
    return streamLog(req, res, from, (at) => merges.log(id, at), `no merge ${id}`);
  }

  return { mergesRoute };
}
