// The view server's history and git (V10, V66): the commits page's rows, git's page, a checkout.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BranchNotMerged,
  CheckoutRefused,
  GitRefused,
  UnknownCheckoutTarget,
  type CheckoutTarget,
  type HistoryRefs,
} from '@symbiote/core';
import { count, historyScope, parseCheckoutTarget } from './server-requests.js';
import {
  GIT_WRITES,
  GitOpenRefused,
  parseGitOpen,
  parseGitWrite,
  type GitOpen,
  type GitPage,
  type GitWrite,
} from './git-page.js';
import type { RepositoryOptions } from './server-context.js';
import { MAX_BODY_BYTES, json, send, badBody, readBody, type ServerHttp } from './server-http.js';

/** Rows of the history with their details: `?scope=all|current&from=<n>&to=<n>&version=…`. */
export async function historyRows(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  repo: RepositoryOptions,
): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, 'method not allowed');
  const scope = historyScope(url);
  if (!scope) return send(res, 400, 'scope: all or current');
  const from = count(url.searchParams.get('from') ?? '0');
  const to = count(url.searchParams.get('to') ?? String((from ?? 0) + 200));
  if (from === null || to === null || to < from || to - from > MAX_HISTORY_ROWS) {
    return send(res, 400, `from, to: counts, at most ${MAX_HISTORY_ROWS} rows apart`);
  }
  const version = url.searchParams.get('version') ?? undefined;
  const page = await repo.history.page(scope, from, to, version);
  if (!page) return send(res, 409, 'the history changed: list it again');
  return json(res, 200, page);
}

/** Every row's parents as row numbers, once listed: `?scope=…&version=…`. */
export async function historyShape(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  repo: RepositoryOptions,
): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, 'method not allowed');
  const scope = historyScope(url);
  const version = url.searchParams.get('version');
  if (!scope || !version) return send(res, 400, 'scope and version needed');
  const shape = await repo.history.shape(scope, version);
  if (!shape) return send(res, 409, 'the history changed: list it again');
  return json(res, 200, shape);
}

/** The branches with their tips' rows in a listing (V10b): `?scope=…&version=…`. */
export async function historyRefs(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  repo: RepositoryOptions,
): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, 'method not allowed');
  const scope = historyScope(url);
  const version = url.searchParams.get('version');
  if (!scope || !version) return send(res, 400, 'scope and version needed');
  const { branches, remotes } = await repo.refs();
  const rows = await repo.history.tips(scope, version, [
    ...branches.map((b) => b.sha),
    ...remotes.map((r) => r.sha),
  ]);
  if (!rows) return send(res, 409, 'the history changed: list it again');
  // Hidden from the graph (decision 645): said, so the panel can show them again.
  const hidden = new Set((await repo.git?.hidden()) ?? []);
  const mark = (ref: string) => (hidden.has(ref) ? { hidden: true as const } : {});
  const answer: HistoryRefs = {
    version,
    branches: branches.map((b, i) => ({
      ...b,
      row: rows[i] ?? null,
      ...mark(`refs/heads/${b.name}`),
    })),
    remotes: remotes.map((r, i) => ({
      ...r,
      row: rows[branches.length + i] ?? null,
      ...mark(`refs/remotes/${r.name}`),
    })),
  };
  return json(res, 200, answer);
}

/**
 * The rows of commits in a listing, by SHA (decision 634: the page lists anew in place, the
 * cursor kept on its commit): `?scope=…&version=…&sha=…&sha=…`, null for a SHA it does not list.
 */
export async function historyRowsOf(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  repo: RepositoryOptions,
): Promise<void> {
  if (req.method !== 'GET') return send(res, 405, 'method not allowed');
  const scope = historyScope(url);
  const version = url.searchParams.get('version');
  const shas = url.searchParams.getAll('sha');
  if (!scope || !version || shas.length === 0) return send(res, 400, 'scope, version and sha');
  const rows = await repo.history.tips(scope, version, shas);
  if (!rows) return send(res, 409, 'the history changed: list it again');
  return json(res, 200, { rows });
}

/** Rows of the history the viewer may ask for at once. */
const MAX_HISTORY_ROWS = 500;

/** Git's page, and a checkout, one at a time. */
export function serverGit({ writable }: Pick<ServerHttp, 'writable'>) {
  let checkingOut = false;
  /**
   * Git's page (V66): `GET` a commit (`commit`, `commit/lines`, `commit/file`), the changes
   * (`changes`, `changes/lines`, `changes/file`), the branch's upstream (`sync`), a search
   * (`find`), the stashes, a reset's count (`leaving`), a file's history and blame (`file/…`), the
   * branches hidden; `POST` a write (`GIT_WRITES`), refused in git's words with 409; `POST open`,
   * a file's diff in VS Code (V70).
   */
  async function gitApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    repo: RepositoryOptions,
    page: GitPage,
  ): Promise<void> {
    const name = url.pathname.slice('/api/git/'.length);
    const param = (key: string) => url.searchParams.get(key);
    const sha = param('sha');
    const path = param('path');
    const text = (diff: string | null) =>
      diff === null ? send(res, 404, 'no such change') : send(res, 200, diff);
    // A file's diff opened in VS Code (V70): asked by the page, not one of git's writes.
    if (name === 'open') {
      if (req.method !== 'POST') return send(res, 405, 'method not allowed');
      if (!writable(req)) return send(res, 403, 'forbidden');
      let request: GitOpen;
      try {
        request = parseGitOpen(await readBody(req, MAX_BODY_BYTES));
      } catch (error) {
        return badBody(res, error);
      }
      try {
        await page.open(request);
        return json(res, 200, {});
      } catch (error) {
        if (error instanceof GitOpenRefused)
          return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    // `commit` is read with GET and written with POST.
    if (req.method === 'POST') {
      if (!GIT_WRITES.includes(name)) return send(res, 404, 'not found');
      if (!writable(req)) return send(res, 403, 'forbidden');
      let request: GitWrite;
      try {
        request = parseGitWrite(name, await readBody(req, MAX_BODY_BYTES));
      } catch (error) {
        return badBody(res, error);
      }
      try {
        return json(res, 200, await page.write(request));
      } catch (error) {
        if (error instanceof BranchNotMerged)
          return json(res, 409, { error: error.message, only: error.only });
        if (error instanceof GitRefused) return json(res, 409, { error: error.message });
        throw error;
      }
    }
    if (req.method !== 'GET') return send(res, 405, 'method not allowed');
    switch (name) {
      case 'commit': {
        if (!sha) return send(res, 400, 'sha needed');
        const info = await page.commit(sha);
        return info ? json(res, 200, info) : send(res, 404, `no commit ${sha}`);
      }
      case 'commit/lines':
        return sha ? json(res, 200, await page.commitLines(sha)) : send(res, 400, 'sha needed');
      case 'commit/file':
        return sha && path ? text(await page.commitFile(sha, path)) : send(res, 400, 'sha, path');
      case 'changes':
        return json(res, 200, await page.changes());
      case 'changes/lines':
        return json(res, 200, await page.changesLines());
      case 'changes/file':
        return path
          ? text(await page.changeFile(path, param('staged') === '1'))
          : send(res, 400, 'path');
      case 'sync':
        return json(res, 200, await page.sync());
      case 'stashes':
        return json(res, 200, await page.stashes());
      case 'hidden':
        return json(res, 200, { hidden: await page.hidden() });
      case 'leaving':
        if (!sha) return send(res, 400, 'sha needed');
        try {
          return json(res, 200, { count: await page.leaving(sha) });
        } catch (error) {
          if (error instanceof GitRefused) return send(res, 404, error.message);
          throw error;
        }
      case 'file/history':
      case 'file/blame': {
        if (!path) return send(res, 400, 'path needed');
        const at = sha ?? null;
        try {
          const answer = await (name === 'file/history'
            ? page.fileHistory(path, at)
            : page.blame(path, at));
          return answer ? json(res, 200, answer) : send(res, 404, `${path} is not listed there`);
        } catch (error) {
          if (error instanceof GitRefused) return json(res, 409, { error: error.message });
          throw error;
        }
      }
      case 'find': {
        const scope = historyScope(url);
        const version = param('version');
        const query = param('q');
        if (!scope || !version || query === null) return send(res, 400, 'scope, version and q');
        const found = await repo.history.find(scope, version, query);
        return found ? json(res, 200, found) : send(res, 409, 'the history changed: list it again');
      }
    }
    return GIT_WRITES.includes(name)
      ? send(res, 405, 'method not allowed')
      : send(res, 404, 'not found');
  }

  /** Checks out what the commits page asks for, one checkout at a time. */
  async function checkoutTarget(
    req: IncomingMessage,
    res: ServerResponse,
    repo: RepositoryOptions,
  ): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!writable(req)) return send(res, 403, 'forbidden');
    let target: CheckoutTarget;
    try {
      target = parseCheckoutTarget(await readBody(req, MAX_BODY_BYTES));
    } catch (error) {
      return badBody(res, error);
    }
    if (checkingOut) return json(res, 409, { error: 'a checkout is running' });
    checkingOut = true;
    try {
      return json(res, 200, await repo.checkout(target));
    } catch (error) {
      if (error instanceof UnknownCheckoutTarget) return send(res, 400, error.message);
      if (error instanceof CheckoutRefused) return json(res, 409, { error: error.message });
      throw error;
    } finally {
      checkingOut = false;
    }
  }

  return { gitApi, checkoutTarget };
}
