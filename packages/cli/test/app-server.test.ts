import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AppServerError,
  AppServerUnreachable,
  codexServer,
  connectAppServer,
} from '../src/app-server.js';
import { fakeAppServer, webSocketServer, type FakeAppServer } from './fake-app-server.js';

const dirs: string[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function socketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cpr-as-'));
  dirs.push(dir);
  return join(dir, 's.sock');
}

let clock = 1_792_448_324;
async function serve(): Promise<FakeAppServer> {
  const server = await fakeAppServer(socketPath(), { now: () => clock });
  closers.push(() => server.close());
  return server;
}

const WORKTREE = '/repo.worktrees/feature-csv';
const ROOTS = ['/repo/.git/worktrees/feature-csv', '/repo/.git/objects'];

describe('connectAppServer', () => {
  it('introduces CPR, then asks and answers by ID; an error keeps its code', async () => {
    const path = socketPath();
    const server = await webSocketServer(path, (socket) => {
      socket.onText((text) => {
        const message = JSON.parse(text) as { id?: number; method: string };
        if (message.id === undefined) return;
        if (message.method === 'initialize') {
          // A server request first, numbered as Codex numbers them: not an answer to CPR's 1.
          socket.send(JSON.stringify({ method: 'item/tool/call', id: 1, params: {} }));
          socket.send(JSON.stringify({ id: 1, result: { userAgent: 'x/0.163.0' } }));
        } else if (message.method === 'thread/read') {
          socket.send(
            JSON.stringify({
              id: message.id,
              error: { code: -32600, message: 'thread not found: t' },
            }),
          );
        } else socket.send(JSON.stringify({ id: message.id, result: { ok: message.method } }));
      });
    });
    closers.push(() => server.close());
    const connection = await connectAppServer(`unix://${path}`, { version: '1.2.3' });
    expect(await connection.request('thread/list', { limit: 1 })).toEqual({ ok: 'thread/list' });
    const error = await connection
      .request('thread/read', { threadId: 't' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppServerError);
    expect(error).toMatchObject({ code: -32600, message: 'thread not found: t' });
    connection.close();
    const [socket] = server.sockets;
    expect(socket?.received.map((text) => JSON.parse(text) as unknown)).toEqual([
      {
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'cpr', title: 'CPR', version: '1.2.3' }, capabilities: null },
      },
      { method: 'initialized' },
      { id: 2, method: 'thread/list', params: { limit: 1 } },
      { id: 3, method: 'thread/read', params: { threadId: 't' } },
    ]);
    // CPR answers no server request: an approval is the person's (decision 156's terminal).
    expect(socket?.received.some((text) => text.includes('"result"'))).toBe(false);
  });

  it('is unreachable without a socket or a WebSocket there; a request with no answer times out', async () => {
    await expect(connectAppServer(`unix://${socketPath()}`)).rejects.toThrow(AppServerUnreachable);
    await expect(connectAppServer('ws://127.0.0.1:1')).rejects.toThrow(/unix:\/\//);
    const path = socketPath();
    const silent = await webSocketServer(path, () => {});
    closers.push(() => silent.close());
    const started = Date.now();
    await expect(connectAppServer(`unix://${path}`, { timeoutMs: 100 })).rejects.toThrow(
      /did not answer initialize/,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('fails what is asked when the server goes', async () => {
    const server = await serve();
    const connection = await connectAppServer(server.address);
    const asked = connection
      .request('thread/turns/list', { threadId: 'none' })
      .catch((e: unknown) => e);
    server.restart();
    await expect(connection.request('thread/read', { threadId: 'x' })).rejects.toThrow(
      AppServerError,
    );
    expect(await asked).toBeInstanceOf(Error);
  });
});

describe('codexServer', () => {
  it("starts a thread in the worktree, its branch's git folders writable, named, with CPR's prompt", async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    const thread = await codex.start({
      cwd: WORKTREE,
      writable: ROOTS,
      name: 'feature/csv',
      prompt: 'Do it',
    });
    expect(thread).toBe('thread-1');
    expect(server.calls.map((c) => c.method)).toEqual([
      'initialize',
      'thread/start',
      'turn/start',
      'thread/name/set',
    ]);
    expect(server.calls[1]?.params).toEqual({
      cwd: WORKTREE,
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      config: { sandbox_workspace_write: { writable_roots: ROOTS } },
    });
    expect(server.calls[2]?.params).toEqual({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Do it', text_elements: [] }],
    });
    expect(server.thread('thread-1')).toMatchObject({
      name: 'feature/csv',
      sandbox: 'workspace-write',
    });
    // Answered once the prompt is in the thread: a read right after shows it.
    const read = await codex.read(thread, { turns: 1, items: 'full' });
    expect(read).toEqual({
      id: 'thread-1',
      createdAt: clock,
      updatedAt: clock,
      status: 'active',
      turns: [{ id: 'turn-2', status: 'inProgress', startedAt: clock, prompts: ['Do it'] }],
    });
  });

  it('gives the thread an effort level on its first turn, which Codex keeps for the next (V30b)', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    await codex.start({
      cwd: WORKTREE,
      writable: ROOTS,
      name: 'feature/csv',
      prompt: 'Do it',
      effort: 'high',
    });
    expect(server.calls.find((c) => c.method === 'turn/start')?.params).toEqual({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Do it', text_elements: [] }],
      effort: 'high',
    });
    expect(server.calls.find((c) => c.method === 'thread/start')?.params).not.toHaveProperty(
      'effort',
    );
  });

  it('reads the levels of the model Codex is configured with, and its configured level (V30b)', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    // As Codex 0.163 answered here: gpt-6-luna configured, at medium.
    expect(await codex.efforts(WORKTREE)).toEqual({
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      default: 'medium',
    });
    expect(server.calls.find((c) => c.method === 'config/read')?.params).toEqual({ cwd: WORKTREE });
    // Another model configured: its own levels; none configured: the default model's, and its
    // default level.
    server.config.model = 'gpt-5.6-terra';
    delete server.config.model_reasoning_effort;
    expect(await codex.efforts(WORKTREE)).toEqual({
      levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      default: 'medium',
    });
    delete server.config.model;
    server.models[0] = { ...server.models[0], defaultReasoningEffort: 'high' };
    expect(await codex.efforts(WORKTREE)).toEqual({
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      default: 'high',
    });
  });

  it('reads no levels it cannot trust: a model not listed, levels not words (V30b)', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    server.config.model = 'gpt-unknown';
    expect(await codex.efforts(WORKTREE)).toBeNull();
    server.config.model = 'gpt-6-luna';
    server.models[0] = { ...server.models[0], supportedReasoningEfforts: [{ effort: 'low' }] };
    expect(await codex.efforts(WORKTREE)).toBeNull();
    server.models[0] = {
      ...server.models[0],
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'Not one' }],
    };
    expect(await codex.efforts(WORKTREE)).toEqual({ levels: ['low'], default: 'medium' });
  });

  it('names the thread once its prompt is in it; a name refused does not fail the start', async () => {
    const path = socketPath();
    const server = await fakeAppServer(path, { refuse: ['thread/name/set'] });
    closers.push(() => server.close());
    const thread = await codexServer(server.address).start({
      cwd: WORKTREE,
      writable: ROOTS,
      name: 'feature/csv',
      prompt: 'Do it',
    });
    expect(server.thread(thread)).toMatchObject({ name: null, turns: [{ status: 'inProgress' }] });
  });

  it('reads the newest turns oldest first: prompts with steered ones, the final answer, a failure', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    const thread = await codex.start({
      cwd: WORKTREE,
      writable: ROOTS,
      name: 'b',
      prompt: 'Plan it',
    });
    clock += 5;
    server.reply(thread, '1. Plan');
    clock += 60;
    expect(await codex.send({ thread, text: 'Go ahead' })).toBe('started');
    expect(await codex.send({ thread, text: 'And test it' })).toBe('steered');
    server.ask(thread, 'I need the network: may I run it outside the sandbox?', 'pnpm install');
    const waiting = await codex.read(thread, { turns: 5, items: 'full' });
    expect(waiting).toMatchObject({ status: 'active', waiting: 'approval' });
    expect(waiting.turns).toEqual([
      {
        id: 'turn-2',
        status: 'completed',
        startedAt: clock - 65,
        completedAt: clock - 60,
        prompts: ['Plan it'],
        report: '1. Plan',
        final: true,
      },
      {
        id: expect.any(String) as string,
        status: 'inProgress',
        startedAt: clock,
        prompts: ['Go ahead', 'And test it'],
        report: 'I need the network: may I run it outside the sandbox?',
      },
    ]);
    server.fail(thread, 'unexpected status 401 Unauthorized');
    const [failed] = (await codex.read(thread, { turns: 1, items: 'summary' })).turns;
    expect(failed).toMatchObject({ status: 'failed', error: 'unexpected status 401 Unauthorized' });
    expect((await codex.read(thread, { turns: 1, items: 'summary' })).status).toBe('idle');
  });

  it('continues a thread after the server restarted: resumed first, its options kept by the server', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    const thread = await codex.start({ cwd: WORKTREE, writable: ROOTS, name: 'b', prompt: 'P' });
    server.reply(thread, 'Done');
    server.typed(thread, 'from the terminal');
    await new Promise((resolve) => setTimeout(resolve, 30));
    server.restart();
    expect(await codex.read(thread, { turns: 1, items: 'summary' })).toMatchObject({
      status: 'notLoaded',
      turns: [{ status: 'interrupted', prompts: ['from the terminal'] }],
    });
    expect(await codex.send({ thread, text: 'Again' })).toBe('started');
    const resume = server.calls.findLast((c) => c.method === 'thread/resume');
    expect(resume?.params).toEqual({ threadId: thread, excludeTurns: true });
    expect(server.thread(thread)).toMatchObject({ loaded: true, writableRoots: ROOTS });
  });

  it('interrupts the running turn and answers once it ended; nothing to interrupt otherwise', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    const thread = await codex.start({ cwd: WORKTREE, writable: ROOTS, name: 'b', prompt: 'P' });
    expect(await codex.interrupt(thread)).toBe(true);
    expect(server.calls.findLast((c) => c.method === 'turn/interrupt')?.params).toEqual({
      threadId: thread,
      turnId: 'turn-2',
    });
    expect(await codex.read(thread, { turns: 1, items: 'summary' })).toMatchObject({
      status: 'idle',
      turns: [{ status: 'interrupted' }],
    });
    expect(await codex.interrupt(thread)).toBe(false);
    server.restart();
    expect(await codex.interrupt(thread)).toBe(false);
  });

  it('stops a turn and the commands it left running; where Codex refuses that, the turn still stops (V27b)', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    const thread = await codex.start({ cwd: WORKTREE, writable: ROOTS, name: 'b', prompt: 'P' });
    server.command(thread, 'sleep 45');
    expect(await codex.interrupt(thread)).toBe(true);
    expect(server.thread(thread)).toMatchObject({
      terminals: [],
      turns: [{ status: 'interrupted' }],
    });
    // Only the connection that cleans opts into Codex's experimental methods.
    expect(server.calls.filter((c) => c.experimental).map((c) => c.method)).toEqual([
      'thread/backgroundTerminals/clean',
    ]);
    const optedIn = server.calls.filter(
      (c) =>
        c.method === 'initialize' &&
        (c.params.capabilities as { experimentalApi?: boolean } | null)?.experimentalApi === true,
    );
    expect(optedIn).toHaveLength(1);
    // A turn interrupted elsewhere (Esc in Codex's terminal): nothing to interrupt, its command
    // still ended.
    server.typed(thread, 'Run the dev server');
    await new Promise((resolve) => setTimeout(resolve, 30));
    server.command(thread, 'pnpm dev');
    const tui = await connectAppServer(server.address);
    await tui.request('turn/interrupt', {
      threadId: thread,
      turnId: server.thread(thread).turns.at(-1)?.id,
    });
    tui.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await codex.interrupt(thread)).toBe(false);
    expect(server.thread(thread).terminals).toEqual([]);

    const refusing = await fakeAppServer(socketPath(), {
      refuse: ['thread/backgroundTerminals/clean'],
    });
    closers.push(() => refusing.close());
    const older = codexServer(refusing.address);
    const other = await older.start({ cwd: WORKTREE, writable: ROOTS, name: 'b', prompt: 'P' });
    refusing.command(other, 'sleep 45');
    expect(await older.interrupt(other)).toBe(true);
    expect(refusing.thread(other)).toMatchObject({
      terminals: ['sleep 45'],
      turns: [{ status: 'interrupted' }],
    });
  });

  it("reads Codex's trust entries, by folder (V27b)", async () => {
    const server = await serve();
    server.trusted['/repo'] = 'trusted';
    server.trusted['/elsewhere'] = 'untrusted';
    expect(await codexServer(server.address).trust(WORKTREE)).toEqual({
      '/repo': 'trusted',
      '/elsewhere': 'untrusted',
    });
    expect(server.calls.at(-1)).toMatchObject({ method: 'config/read', params: { cwd: WORKTREE } });
  });

  it('archives a thread; an unknown one is an error in its words', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    const thread = await codex.start({ cwd: WORKTREE, writable: ROOTS, name: 'b', prompt: 'P' });
    await codex.archive(thread);
    expect(server.thread(thread).archived).toBe(true);
    await expect(codex.read('thread-9', { turns: 1, items: 'summary' })).rejects.toThrow(
      'thread not found: thread-9',
    );
  });
});
