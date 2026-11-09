// The view server's workspaces (V18): `/api/workspaces…`, and a Hive workspace's tab (HV3).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorkspaceRequest } from '@symbiote/core';
import {
  parseDocument,
  parseDraft,
  parseModelChange,
  parseEffortChange,
  parseWorkspaceAgainst,
  parseWorkspaceClean,
  parseWorkspaceDiff,
  parseWorkspaceOpen,
  parseWorkspaceReply,
  parseWorkspaceSent,
  parseWorkspaceRequest,
  parseSuggestRequest,
  parseWorkspaceTerminal,
} from './server-requests.js';
import type { Workspaces } from './workspace-context.js';
import { MAX_DOCUMENT_BYTES } from './workspace-documents.js';
import { WorkspaceRefused } from './workspace-record.js';
import type { HiveWorkspace } from './hive-workspace.js';
import type { ServerContext } from './server-context.js';
import {
  read,
  ofBranch,
  answer,
  exported,
  MAX_BODY_BYTES,
  exportFormat,
  FORMAT_WORDS,
  json,
  send,
  badBody,
  readBody,
  type ServerHttp,
} from './server-http.js';
import type { ServerSites } from './server-sites.js';

/** The advisor's settings on an agent (V75c): its models and levels, and its model or level set. */
const ADVISOR_SETTING = /^\/api\/workspaces\/advisor\/(claude|codex)\/(efforts|effort|model)$/;

/** Most a document's request may weigh (V40): the file as base64, in its JSON with its name. */
const MAX_DOCUMENT_BODY = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 4096;

const DOCUMENT_TOO_LARGE = `a document of at most ${MAX_DOCUMENT_BYTES / 2 ** 20} MB`;

/** `/api/workspaces…`. */
export function serverWorkspaces(
  { opened, root }: Pick<ServerContext, 'opened' | 'root'>,
  uses: Pick<
    ServerHttp,
    'written' | 'onBranch' | 'startingOne' | 'oneAtATime' | 'sameSite' | 'writable' | 'streamLog'
  > &
    Pick<ServerSites, 'serveSite'>,
) {
  const { written, onBranch, startingOne, oneAtATime, sameSite, writable, streamLog, serveSite } =
    uses;
  /** `/api/workspaces/hive…` (HV3): a Hive workspace's Review tab, its kept tests, its logs. */
  async function hiveRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    hiveTab: HiveWorkspace,
  ): Promise<void> {
    if (url.pathname === '/api/workspaces/hive') {
      return ofBranch(req, res, url, async (branch) => {
        const detail = await hiveTab.detail(branch);
        if (!detail) throw new WorkspaceRefused(`Hive does not drive ${branch}`, 404);
        return detail;
      });
    }
    if (url.pathname === '/api/workspaces/hive/test') {
      const round = Number(url.searchParams.get('round'));
      const path = url.searchParams.get('path') ?? '';
      return ofBranch(req, res, url, async (branch) => {
        const text = await hiveTab.test(branch, round, path);
        if (text === null)
          throw new WorkspaceRefused(`no kept test ${path} in round ${round}`, 404);
        return { text };
      });
    }
    if (url.pathname === '/api/workspaces/hive/log') {
      // A check's or a review's log (decision 695), streamed as a merge's is; refused from
      // another site, as a terminal's stream: a check prints the code.
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      if (!sameSite(req)) return send(res, 403, 'forbidden');
      const branch = url.searchParams.get('branch') ?? '';
      const log = url.searchParams.get('log') ?? '';
      const from = Number(url.searchParams.get('from') ?? '0');
      if (!branch || !log || !Number.isSafeInteger(from) || from < 0) {
        return send(res, 400, "branch: a Hive workspace's; log: one of its logs; from: an offset");
      }
      return streamLog(
        req,
        res,
        from,
        (at) => hiveTab.log(branch, log, at),
        `no log ${log} of ${branch}`,
      );
    }
    return send(res, 404, 'not found');
  }

  /** `/api/workspaces…` (V18): the list and a start, each workspace's reads and writes. */
  async function workspacesRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    workspaces: Workspaces,
  ): Promise<void> {
    if (url.pathname === '/api/workspaces') return workspacesApi(req, res, workspaces);
    if (url.pathname === '/api/workspaces/options')
      return read(req, res, () => workspaces.options());
    if (url.pathname === '/api/workspaces/history') {
      // History (V77): the finished workspaces, or one of them as its tabs read it.
      if (url.searchParams.has('branch')) {
        return ofBranch(req, res, url, (branch) => workspaces.finished(branch));
      }
      return read(req, res, () => workspaces.history());
    }
    if (url.pathname === '/api/workspaces/draft') {
      if (req.method === 'GET') return json(res, 200, await workspaces.draft());
      return written(req, res, parseDraft, (draft) =>
        answer(res, () => workspaces.saveDraft(draft).then(() => ({}))),
      );
    }
    if (url.pathname === '/api/workspaces/documents') {
      // A file for the start (V40), refused before it is read: the page checks the size first.
      if (Number(req.headers['content-length']) > MAX_DOCUMENT_BODY) {
        req.resume();
        return send(res, 413, DOCUMENT_TOO_LARGE);
      }
      return written(
        req,
        res,
        parseDocument,
        ({ name, bytes }) => answer(res, () => workspaces.saveDocument(name, bytes)),
        MAX_DOCUMENT_BODY,
      );
    }
    if (url.pathname === '/api/workspaces/suggest') {
      // The advisor (V75): a proposal for the Start page, only when the person asks for one.
      return written(req, res, parseSuggestRequest, (request) =>
        answer(res, () => workspaces.suggest(request)),
      );
    }
    // The advisor's model and level on each agent (V75c), read and set where Settings shows them.
    const advising = ADVISOR_SETTING.exec(url.pathname);
    if (advising) {
      const kind = advising[1] === 'codex' ? 'codex' : 'claude';
      if (advising[2] === 'efforts') return read(req, res, () => workspaces.advisor(kind));
      if (advising[2] === 'effort') {
        return written(req, res, parseEffortChange, (change) =>
          answer(res, () => workspaces.setAdvisorEffort(kind, change)),
        );
      }
      return written(req, res, parseModelChange, (change) =>
        answer(res, () => workspaces.setAdvisorModel(kind, change)),
      );
    }
    if (url.pathname === '/api/workspaces/check') {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      const at = url.searchParams.get('at');
      if (!at) return send(res, 400, 'at: the commit a workspace starts from');
      return answer(res, () => workspaces.check(at).then((guess) => guess ?? {}));
    }
    if (url.pathname === '/api/workspaces/start') {
      return onBranch(req, res, (branch) => startingOne(res, () => workspaces.startAgent(branch)));
    }
    if (url.pathname === '/api/workspaces/stop') {
      return onBranch(req, res, (branch) => answer(res, () => workspaces.stopAgent(branch)));
    }
    if (url.pathname === '/api/workspaces/open') {
      return written(req, res, parseWorkspaceOpen, ({ branch }) =>
        answer(res, () => workspaces.openWorktree(branch).then(() => ({}))),
      );
    }
    if (url.pathname === '/api/workspaces/diff') {
      return written(req, res, parseWorkspaceDiff, ({ branch, file }) =>
        answer(res, () => workspaces.openDiff(branch, file).then(() => ({}))),
      );
    }
    if (url.pathname === '/api/workspaces/changes') {
      return ofBranch(req, res, url, (branch) => workspaces.changes(branch));
    }
    if (url.pathname === '/api/workspaces/prompt') {
      return ofBranch(req, res, url, (branch) =>
        workspaces.prompt(branch).then((prompt) => ({ prompt })),
      );
    }
    if (url.pathname === '/api/workspaces/merge') {
      return ofBranch(req, res, url, (branch) => workspaces.merge(branch));
    }
    if (url.pathname === '/api/workspaces/against') {
      if (req.method === 'GET') return ofBranch(req, res, url, (b) => workspaces.against(b));
      return written(req, res, parseWorkspaceAgainst, ({ branch, against }) =>
        answer(res, async () => {
          const answered = await workspaces.setAgainst(branch, against);
          // Its review starts elsewhere now: resolved again when next opened.
          opened.delete(branch);
          return answered;
        }),
      );
    }
    if (url.pathname === '/api/workspaces/thread') {
      return ofBranch(req, res, url, (branch) => workspaces.thread(branch));
    }
    if (url.pathname === '/api/workspaces/activity') {
      return ofBranch(req, res, url, (branch) => workspaces.tools(branch));
    }
    // Its activity taken out (V84): a file to save.
    if (url.pathname === '/api/workspaces/activity/export') {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      const branch = url.searchParams.get('branch');
      if (!branch) return send(res, 400, "branch: a workspace's branch");
      const format = exportFormat(url);
      if (!format) return send(res, 400, FORMAT_WORDS);
      return exported(res, () => workspaces.exportActivity(branch, format));
    }
    if (url.pathname === '/api/workspaces/reply') {
      return written(req, res, parseWorkspaceReply, (request) =>
        oneAtATime(res, 'a message is being sent', () => workspaces.reply(request)),
      );
    }
    if (url.pathname === '/api/workspaces/sent') {
      return written(req, res, parseWorkspaceSent, (request) =>
        answer(res, () => workspaces.noteSent(request).then(() => ({ noted: true }))),
      );
    }
    if (url.pathname === '/api/workspaces/clean') {
      return written(req, res, parseWorkspaceClean, (request) =>
        answer(res, () => workspaces.clean(request)),
      );
    }
    if (url.pathname === '/api/workspaces/terminal') {
      return written(req, res, parseWorkspaceTerminal, (request) =>
        answer(res, () => workspaces.terminal(request)),
      );
    }
    if (url.pathname === '/api/workspaces/shell') {
      return written(req, res, parseWorkspaceTerminal, (request) =>
        answer(res, () => workspaces.shell(request)),
      );
    }
    if (url.pathname === '/api/workspaces/shells') {
      // It hands out terminals' IDs, which read and drive them: for the page only (V45).
      if (req.headers['x-symbiote'] !== '1' || !sameSite(req)) {
        return send(res, 403, 'forbidden');
      }
      return ofBranch(req, res, url, (branch) => workspaces.shells(branch));
    }
    return serveSite(req, res, url, url.pathname, root);
  }

  /** The workspaces (GET), or a new one: its branch, worktree and agent (POST), one at a time. */
  async function workspacesApi(
    req: IncomingMessage,
    res: ServerResponse,
    workspaces: Workspaces,
  ): Promise<void> {
    if (req.method === 'GET') return json(res, 200, await workspaces.list());
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let request: WorkspaceRequest;
    try {
      request = parseWorkspaceRequest(await readBody(req, MAX_BODY_BYTES));
    } catch (error) {
      return badBody(res, error);
    }
    return startingOne(res, () => workspaces.start(request));
  }

  return { workspacesRoute, hiveRoute };
}
