import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AppServerError,
  AppServerUnreachable,
  codexServer,
  connectAppServer,
  readProfile,
} from '../src/app-server.js';
import { fakeAppServer, webSocketServer, type FakeAppServer } from './fake-app-server.js';

const dirs: string[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function socketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'symbiote-as-'));
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
  it('introduces Symbiote, then asks and answers by ID; an error keeps its code', async () => {
    const path = socketPath();
    const server = await webSocketServer(path, (socket) => {
      socket.onText((text) => {
        const message = JSON.parse(text) as { id?: number; method: string };
        if (message.id === undefined) return;
        if (message.method === 'initialize') {
          // A server request first, numbered as Codex numbers them: not an answer to Symbiote's 1.
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
        params: {
          clientInfo: { name: 'symbiote', title: 'Symbiote', version: '1.2.3' },
          capabilities: null,
        },
      },
      { method: 'initialized' },
      { id: 2, method: 'thread/list', params: { limit: 1 } },
      { id: 3, method: 'thread/read', params: { threadId: 't' } },
    ]);
    // Symbiote answers no server request: an approval is the person's (decision 156's terminal).
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
  it("starts a thread in the worktree, its branch's git folders writable, named, with Symbiote's prompt", async () => {
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
      // What it runs on (V83): none given, the configured model and level.
      model: 'gpt-6-luna',
      effort: 'medium',
      turns: [
        { id: 'turn-2', status: 'inProgress', startedAt: clock, prompts: ['Do it'], items: [] },
      ],
    });
    // A command it runs is an item of the turn read in full (V48f), not of a summary.
    server.command(thread, 'pnpm test -- --run\nsecond line');
    const [running] = (await codex.read(thread, { turns: 1, items: 'full' })).turns;
    expect(running?.items).toEqual([
      {
        id: expect.any(String) as string,
        kind: 'command',
        subject: 'pnpm test -- --run',
        status: 'inProgress',
        // Whole, since V73.
        command: 'pnpm test -- --run\nsecond line',
      },
    ]);
    const [summary] = (await codex.read(thread, { turns: 1, items: 'summary' })).turns;
    expect(summary).not.toHaveProperty('items');
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

  it('lists its models with their names, descriptions and levels, the configured one its default (V47)', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    const luna = ['low', 'medium', 'high', 'xhigh', 'max'];
    // As Codex 0.163 answered here: gpt-6-luna configured, at medium.
    expect(await codex.models(WORKTREE)).toEqual({
      models: [
        {
          id: 'gpt-6-luna',
          name: 'GPT-6-Luna',
          description: 'Fast and affordable model for easier tasks.',
          efforts: { levels: luna, default: 'medium' },
        },
        {
          id: 'gpt-5.6-terra',
          name: 'GPT-5.6-Terra',
          description: 'Older balanced model for straightforward work.',
          efforts: { levels: [...luna, 'ultra'], default: 'medium' },
        },
        {
          id: 'gpt-5.6-luna',
          name: 'GPT-5.6-Luna',
          description: 'Older fast and efficient model.',
          efforts: { levels: luna, default: 'medium' },
        },
      ],
      default: 'gpt-6-luna',
    });
    expect(server.calls.find((c) => c.method === 'config/read')?.params).toEqual({ cwd: WORKTREE });
    // Every page; a hidden model left out; none configured: the one it marks as its default.
    server.modelPage = 1;
    server.models[1] = { ...server.models[1], hidden: true };
    delete server.config.model;
    server.models[0] = { ...server.models[0], isDefault: false };
    server.models[2] = { ...server.models[2], isDefault: true };
    const listed = await codex.models(WORKTREE);
    expect(listed?.models.map((m) => m.id)).toEqual(['gpt-6-luna', 'gpt-5.6-luna']);
    expect(listed?.default).toBe('gpt-5.6-luna');
    expect(server.calls.filter((c) => c.method === 'model/list').length).toBe(1 + 3);
  });

  it('lists no model it cannot pass: an ID that is no word, a list with none (V47)', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    server.models[0] = { ...server.models[0], model: '--yolo', id: '--yolo' };
    server.models[1] = { ...server.models[1], displayName: undefined, description: '' };
    server.models[2] = { ...server.models[2], supportedReasoningEfforts: [] };
    expect(await codex.models(WORKTREE)).toEqual({
      models: [
        {
          id: 'gpt-5.6-terra',
          name: 'gpt-5.6-terra',
          efforts: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
            default: 'medium',
          },
        },
        {
          id: 'gpt-5.6-luna',
          name: 'GPT-5.6-Luna',
          description: 'Older fast and efficient model.',
        },
      ],
      default: 'gpt-6-luna',
    });
    server.models.splice(0, server.models.length);
    expect(await codex.models(WORKTREE)).toBeNull();
  });

  it('starts a thread on the model picked: the thread keeps it (V47)', async () => {
    const server = await serve();
    await codexServer(server.address).start({
      cwd: WORKTREE,
      writable: ROOTS,
      name: 'feature/csv',
      prompt: 'Do it',
      model: 'gpt-5.6-luna',
    });
    expect(server.calls.find((c) => c.method === 'thread/start')?.params).toMatchObject({
      model: 'gpt-5.6-luna',
    });
    expect(server.calls.find((c) => c.method === 'turn/start')?.params).not.toHaveProperty('model');
    // None picked: none given, the configured one runs.
    await codexServer(server.address).start({
      cwd: WORKTREE,
      writable: ROOTS,
      name: 'feature/two',
      prompt: 'Do it',
    });
    expect(server.calls.filter((c) => c.method === 'thread/start')[1]?.params).not.toHaveProperty(
      'model',
    );
  });

  it('reads what a thread runs on: its model and level, as Codex says them (V83)', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    const thread = await codex.start({
      cwd: WORKTREE,
      writable: ROOTS,
      name: 'feature/csv',
      prompt: 'Do it',
      model: 'gpt-5.6-terra',
      effort: 'ultra',
    });
    expect(await codex.read(thread, { turns: 1, items: 'summary' })).toMatchObject({
      model: 'gpt-5.6-terra',
      effort: 'ultra',
    });
    // Changed in its terminal (`/model`): the thread says the new one.
    Object.assign(server.thread(thread), { model: 'gpt-5.6-luna', effort: 'low' });
    expect(await codex.read(thread, { turns: 1, items: 'summary' })).toMatchObject({
      model: 'gpt-5.6-luna',
      effort: 'low',
    });
    // None set, or not a model's ID: left out, never guessed.
    Object.assign(server.thread(thread), { model: '--yolo', effort: null });
    const read = await codex.read(thread, { turns: 1, items: 'summary' });
    expect(read).not.toHaveProperty('model');
    expect(read).not.toHaveProperty('effort');
  });

  it('starts a thread with no turn, its instructions as developer instructions, its level in its config (V50)', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    const thread = await codex.start({
      cwd: '/repo',
      writable: [],
      name: 'Scout',
      readOnly: true,
      instructions: 'You are Scout.',
      effort: 'low',
      config: { mcp_servers: {} },
    });
    expect(thread).toBe('thread-1');
    // Named as soon as it starts: Codex 0.164 names an empty thread; 0.163 (the fake) refuses, and
    // the start goes on.
    expect(server.calls.map((c) => c.method)).toEqual([
      'initialize',
      'thread/start',
      'thread/name/set',
    ]);
    expect(server.calls[1]?.params).toEqual({
      cwd: '/repo',
      sandbox: 'read-only',
      approvalPolicy: 'never',
      developerInstructions: 'You are Scout.',
      config: { mcp_servers: {}, model_reasoning_effort: 'low' },
    });
    expect(await codex.read(thread, { turns: 1, items: 'summary' })).toMatchObject({
      status: 'idle',
      turns: [],
    });
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
        // Codex's own measure (NU2).
        ms: 5000,
        prompts: ['Plan it'],
        report: '1. Plan',
        final: true,
        items: [],
      },
      {
        id: expect.any(String) as string,
        status: 'inProgress',
        startedAt: clock,
        prompts: ['Go ahead', 'And test it'],
        report: 'I need the network: may I run it outside the sandbox?',
        items: [],
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

  it('gives a thread a configuration of its own: at its start, at each message, and when loaded for its terminal (MC1)', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    const config = {
      mcp_servers: { symbiote: { command: '/usr/bin/node', args: ['/b.js'] } },
    };
    const thread = await codex.start({
      cwd: '/repo',
      writable: [],
      name: 'Scout',
      prompt: 'P',
      readOnly: true,
      config,
    });
    expect(server.calls.find((c) => c.method === 'thread/start')?.params).toEqual({
      cwd: '/repo',
      sandbox: 'read-only',
      approvalPolicy: 'never',
      config,
    });
    server.reply(thread, 'Done');
    await codex.send({ thread, text: 'Again', config });
    expect(server.calls.findLast((c) => c.method === 'thread/resume')?.params).toEqual({
      threadId: thread,
      excludeTurns: true,
      config,
    });
    server.reply(thread, 'Done again');
    const turns = server.calls.filter((c) => c.method === 'turn/start').length;
    await codex.load({ thread, config });
    expect(server.calls.findLast((c) => c.method === 'thread/resume')?.params).toEqual({
      threadId: thread,
      excludeTurns: true,
      config,
    });
    // Loaded, not given a turn.
    expect(server.calls.filter((c) => c.method === 'turn/start')).toHaveLength(turns);
    // A workspace's start keeps its own configuration beside it.
    await codex.start({ cwd: WORKTREE, writable: ROOTS, name: 'b', prompt: 'P', config });
    expect(server.calls.findLast((c) => c.method === 'thread/start')?.params).toMatchObject({
      config: { sandbox_workspace_write: { writable_roots: ROOTS }, ...config },
    });
  });

  it('reads only the folders it is given: a permission profile, no sandbox mode, given again at each resume (V80, decision 599)', async () => {
    const server = await serve();
    const codex = codexServer(server.address);
    const config = { mcp_servers: {} };
    const reads = ['/codex', '/repo', '/repo.worktrees/feature-a'];
    const thread = await codex.start({
      cwd: '/repo',
      writable: [],
      name: 'Scout',
      prompt: 'P',
      readOnly: true,
      reads,
      config,
    });
    // Codex's minimal system folders, then the folders given; read only, nothing written.
    expect(readProfile(reads)).toEqual({
      default_permissions: 'symbiote-read',
      permissions: {
        'symbiote-read': {
          filesystem: {
            ':minimal': 'read',
            '/codex': 'read',
            '/repo': 'read',
            '/repo.worktrees/feature-a': 'read',
          },
        },
      },
    });
    // No sandbox mode: Codex 0.163 takes a mode over a profile (V80 spike).
    expect(server.calls.find((c) => c.method === 'thread/start')?.params).toEqual({
      cwd: '/repo',
      approvalPolicy: 'never',
      config: { ...config, ...readProfile(reads) },
    });
    expect(server.thread(thread)).toMatchObject({ sandbox: 'read-only', reads });
    server.reply(thread, 'Done');
    // A resume without it falls back to the folder's default: each one gives it again, newer.
    const later = [...reads, '/repo.worktrees/feature-b'];
    await codex.send({ thread, text: 'Again', config, reads: later });
    expect(server.calls.findLast((c) => c.method === 'thread/resume')?.params).toEqual({
      threadId: thread,
      excludeTurns: true,
      config: { ...config, ...readProfile(later) },
    });
    server.reply(thread, 'Done again');
    server.restart();
    await codex.load({ thread, config, reads: later });
    expect(server.calls.findLast((c) => c.method === 'thread/resume')?.params).toEqual({
      threadId: thread,
      excludeTurns: true,
      config: { ...config, ...readProfile(later) },
    });
    // A thread the server did not hold takes the newer folders.
    expect(server.thread(thread)).toMatchObject({ sandbox: 'read-only', reads: later });
  });

  it('refuses a thread Codex does not keep read-only: the start archived, no message, no load (V80)', async () => {
    const path = socketPath();
    // A Codex that does not take profiles, in a folder it trusts: writable without a mode.
    const server = await fakeAppServer(path, { profiles: false });
    closers.push(() => server.close());
    server.trusted['/repo'] = 'trusted';
    const codex = codexServer(server.address);
    const reads = ['/codex', '/repo'];
    await expect(
      codex.start({
        cwd: '/repo',
        writable: [],
        name: 'Scout',
        prompt: 'P',
        readOnly: true,
        reads,
      }),
    ).rejects.toThrow(/not read-only/);
    expect(server.threads[0]).toMatchObject({ sandbox: 'workspace-write', archived: true });
    expect(server.calls.some((c) => c.method === 'turn/start')).toBe(false);

    // A thread that lost its profile (resumed without it elsewhere) gets no message and no load.
    const good = await fakeAppServer(socketPath());
    closers.push(() => good.close());
    const other = codexServer(good.address);
    const thread = await other.start({
      cwd: '/repo',
      writable: [],
      name: 'Scout',
      readOnly: true,
      reads,
    });
    good.thread(thread).sandbox = 'workspace-write';
    await expect(other.send({ thread, text: 'Hi', reads })).rejects.toThrow(/not read-only/);
    await expect(other.load({ thread, config: {}, reads })).rejects.toThrow(/not read-only/);
    expect(good.calls.some((c) => c.method === 'turn/start')).toBe(false);
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
