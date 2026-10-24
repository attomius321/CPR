import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRepo, type ScoutAsk } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { codexServer } from '../src/app-server.js';
import type { Codex } from '../src/codex.js';
import { DEFAULT_PROMPTS, fillPrompt } from '../src/prompts.js';
import {
  findScoutSession,
  newScoutSession,
  scout,
  ScoutRefused,
  scoutSettings,
  scoutState,
} from '../src/scout.js';
import { scribe } from '../src/scribe.js';
import type { Terminals } from '../src/terminal.js';
import { claudeCode, type AgentSession, type ClaudeCode, type Run } from '../src/workspaces.js';
import { fakeAppServer, type FakeAppServer } from './fake-app-server.js';

const repos: TestRepo[] = [];
const folders: string[] = [];
const closers: (() => Promise<void>)[] = [];
let cache: string;
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  cache = tempDir();
  folders.push(cache);
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const repo of repos.splice(0)) repo.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/** A repository with one commit and a reviewer's email: `symbiote/` is kept in it. */
function fresh(): TestRepo {
  const repo = createRepo();
  repo.write({ 'src/a.ts': 'export const a = 1;\n' });
  repo.commit('A');
  repo.git('config', 'user.email', 'ada@example.com');
  repos.push(repo);
  return repo;
}

const NOW = new Date('2026-10-22T09:00:00Z');
/** Where Symbiote's gate would be installed. */
const GATE = '/opt/symbiote/dist/scout-hook.js';

/**
 * A fake Claude Code: the person's own interactive session in the checkout, newer than anything
 * Scout starts, and Scout's background session once started (`s9`).
 */
function fakeClaude(root: string) {
  const listed: AgentSession[] = [
    { cwd: root, kind: 'interactive', startedAt: 9e12, name: 'symbiote-38', status: 'idle' },
    {
      cwd: '/elsewhere',
      kind: 'background',
      startedAt: 1,
      id: 'other',
      sessionId: 'session-other',
      name: 'Scout',
      state: 'done',
      status: 'idle',
    },
  ];
  let next = 9;
  const startPageAgent = vi.fn<ClaudeCode['startPageAgent']>(({ cwd, name }) => {
    listed.push({
      cwd,
      kind: 'background',
      startedAt: next,
      id: `s${next}`,
      sessionId: `session-${next}`,
      name,
      state: 'working',
      status: 'busy',
    });
    next += 1;
    return Promise.resolve({ ok: true });
  });
  const sessions = vi.fn<ClaudeCode['sessions']>(() => Promise.resolve(listed));
  const stop = vi.fn<ClaudeCode['stop']>((id) => {
    for (const session of listed) {
      if (session.id !== id) continue;
      session.state = 'stopped';
      delete session.status;
    }
    return Promise.resolve({ ok: true });
  });
  const resume = vi.fn<ClaudeCode['resume']>(({ sessionId }) => {
    for (const session of listed) {
      if (session.sessionId !== sessionId) continue;
      session.state = 'working';
      session.status = 'busy';
    }
    return Promise.resolve({ ok: true });
  });
  const remove = vi.fn<ClaudeCode['remove']>((id) => {
    const at = listed.findIndex((session) => session.id === id);
    if (at >= 0) listed.splice(at, 1);
    return Promise.resolve({ ok: true });
  });
  const claude: ClaudeCode = {
    command: '/usr/bin/claude',
    start: () => Promise.reject(new Error('Scout never starts a workspace agent')),
    startPageAgent,
    sessions,
    stop,
    resume,
    remove,
    account: () => Promise.resolve('your Pro subscription'),
    efforts: () => Promise.resolve(null),
    models: () => Promise.resolve(null),
  };
  /** Sets what Claude Code says of Scout's session. */
  const set = (id: string, fields: Partial<AgentSession>) => {
    const session = listed.find((s) => s.id === id);
    if (!session) throw new Error(`no session ${id}`);
    for (const key of ['state', 'status', 'waitingFor'] as const) delete session[key];
    Object.assign(session, fields);
  };
  return { claude, listed, startPageAgent, sessions, stop, resume, remove, set };
}

/** Fake terminals (V21): records what it is asked to open. */
function fakeTerminals() {
  const opening: Parameters<Terminals['open']>[0][] = [];
  const terminals: Terminals = {
    available: () => Promise.resolve({ available: true }),
    open: (request) => {
      opening.push(request);
      return Promise.resolve(`t${opening.length}`);
    },
    listen: () => undefined,
    write: () => false,
    resize: () => false,
    running: () => undefined,
    image: () => Promise.resolve(undefined),
    files: () => Promise.resolve(undefined),
    openFile: () =>
      Promise.resolve({ opened: false, why: 'terminal', message: 'no such terminal' }),
    close: () => false,
    closeAll: () => {},
  };
  return { terminals, opening };
}

/** A fake Codex whose app server is `server` (none: Codex without a daemon). */
function fakeCodex(server: FakeAppServer | null) {
  const archive = vi.fn<Codex['archive']>(() => Promise.resolve());
  const codex: Codex = {
    command: '/usr/bin/codex',
    start: () => Promise.reject(new Error('Scout never runs codex exec')),
    resume: () => Promise.reject(new Error('Scout never runs codex exec')),
    alive: () => false,
    stop: () => Promise.resolve(),
    archive,
    account: () => Promise.resolve('your ChatGPT account'),
    server: () => Promise.resolve(server ? codexServer(server.address, { waitMs: 500 }) : null),
    efforts: () => Promise.resolve(null),
    models: () => Promise.resolve(null),
  };
  return { codex, archive };
}

async function appServer(): Promise<FakeAppServer> {
  const dir = mkdtempSync(join(tmpdir(), 'symbiote-scout-as-'));
  folders.push(dir);
  const server = await fakeAppServer(join(dir, 's.sock'));
  closers.push(() => server.close());
  return server;
}

const service = async (
  repo: TestRepo,
  {
    claude = null,
    codex = null,
    terminals,
  }: { claude?: ClaudeCode | null; codex?: Codex | null; terminals?: Terminals } = {},
) =>
  scout(await openRepo(repo.root), cache, {
    claude: () => Promise.resolve(claude),
    codex: () => Promise.resolve(codex),
    now: () => NOW,
    env: { PATH: '/usr/bin' },
    gate: GATE,
    node: '/usr/bin/node',
    ...(terminals ? { terminals } : {}),
  });

const record = (repo: TestRepo) => join(repo.root, 'symbiote', 'scout.json');

/** Scout's tools and mode (V35, decision 236). */
const READ_ONLY = { tools: ['Read', 'Grep', 'Glob', 'Bash'], permissionMode: 'dontAsk' } as const;

describe('claudeCode().startPageAgent (V35, decision 236)', () => {
  it('starts a background session with read tools, Bash only through the gate, nothing asked', async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const run: Run = (_command, args, { cwd }) => {
      calls.push({ args, cwd });
      return Promise.resolve({ code: 0, stdout: 'backgrounded · e03676db · Scout\n', stderr: '' });
    };
    const claude = claudeCode('/usr/bin/claude', { run, cwd: '/repo', model: 'sonnet' });
    expect(
      await claude.startPageAgent({
        cwd: '/repo',
        name: 'Scout',
        prompt: 'Where is it?',
        settings: '/repo/symbiote/scout-settings.json',
        ...READ_ONLY,
      }),
    ).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        args: [
          '--bg',
          '--name',
          'Scout',
          '--tools',
          'Read,Grep,Glob,Bash',
          '--permission-mode',
          'dontAsk',
          '--strict-mcp-config',
          '--settings',
          '/repo/symbiote/scout-settings.json',
          '--model',
          'sonnet',
          'Where is it?',
        ],
        cwd: '/repo',
      },
    ]);
  });

  it('starts at the level given, before the prompt, as a workspace does (V30b)', async () => {
    const calls: string[][] = [];
    const run: Run = (_command, args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    const claude = claudeCode('/usr/bin/claude', { run, cwd: '/repo' });
    const request = { cwd: '/repo', name: 'Scout', prompt: 'Q', settings: '/s', ...READ_ONLY };
    await claude.startPageAgent({ ...request, effort: 'low' });
    await claude.startPageAgent(request);
    expect(calls[0]?.slice(-3)).toEqual(['--effort', 'low', 'Q']);
    expect(calls[1]).not.toContain('--effort');
  });

  it("says Claude Code's words when it does not start", async () => {
    const run: Run = () =>
      Promise.resolve({ code: 1, stdout: '', stderr: 'Workspace not trusted. Run `claude`…\n' });
    const claude = claudeCode('/usr/bin/claude', { run, cwd: '/repo' });
    expect(
      await claude.startPageAgent({
        cwd: '/repo',
        name: 'Scout',
        prompt: 'Q',
        settings: '/s',
        ...READ_ONLY,
      }),
    ).toEqual({ ok: false, error: 'Workspace not trusted. Run `claude`…' });
  });
});

describe('scoutSettings', () => {
  it('runs the gate before every tool, and records nothing', () => {
    const settings = JSON.parse(
      scoutSettings({ node: '/usr/bin/node', gate: GATE }, 'linux'),
    ) as unknown;
    expect(settings).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: `'/usr/bin/node' '${GATE}'`, timeout: 30 }],
          },
        ],
      },
    });
  });
});

describe("finding Scout's session (decision 239)", () => {
  const root = '/repo';
  const real = (path: string) => path;
  const mine: AgentSession = {
    cwd: root,
    kind: 'interactive',
    startedAt: 50,
    name: 'symbiote-38',
    status: 'idle',
  };
  const scouts: AgentSession = {
    cwd: root,
    kind: 'background',
    startedAt: 10,
    id: 's9',
    sessionId: 'session-9',
    name: 'Scout',
    state: 'done',
    status: 'idle',
  };

  it('takes the background session named Scout in the checkout that was not listed before', () => {
    const before = [mine];
    const other = { ...scouts, cwd: '/elsewhere', id: 'x', startedAt: 20 };
    const unnamed = { ...scouts, name: 'my-own', id: 'y', startedAt: 30 };
    expect(newScoutSession(before, [mine, other, unnamed, scouts], root, real)?.id).toBe('s9');
    // Listed before: not the one just started.
    expect(newScoutSession([mine, scouts], [mine, scouts], root, real)).toBeUndefined();
  });

  it('finds it by its recorded ID, never by its folder', () => {
    const newer = { ...scouts, id: 'z', sessionId: 'session-z', startedAt: 99, state: 'working' };
    expect(findScoutSession({ id: 's9' }, [mine, newer, scouts])).toBe(scouts);
    expect(findScoutSession({ id: 's9' }, [mine, newer])).toBeUndefined();
  });

  it("reads Claude Code's word for it", () => {
    const read = (fields: Partial<AgentSession>) =>
      scoutState({ ...scouts, state: undefined, status: undefined, ...fields });
    expect(read({ state: 'working', status: 'busy' })).toBe('working');
    expect(read({ status: 'busy' })).toBe('working');
    expect(read({ state: 'done', status: 'idle' })).toBe('answered');
    expect(read({ state: 'blocked', status: 'idle' })).toBe('answered');
    // Esc: no hook, `working` and idle (V21).
    expect(read({ state: 'working', status: 'idle' })).toBe('interrupted');
    expect(read({ state: 'blocked', status: 'waiting', waitingFor: 'permission prompt' })).toBe(
      'needs-you',
    );
    expect(read({ state: 'stopped' })).toBe('stopped');
    expect(read({ state: 'failed' })).toBe('failed');
    expect(scoutState(undefined)).toBe('gone');
  });
});

describe('scout (V35)', () => {
  it('lists the agents installed, the default first, and asks none of them anything else', async () => {
    const repo = fresh();
    const { claude, sessions } = fakeClaude(repo.root);
    const { codex } = fakeCodex(null);
    const s = await service(repo, { claude, codex });
    expect(await s.state()).toEqual({
      checkout: repo.root,
      agents: [
        { kind: 'claude', command: '/usr/bin/claude' },
        { kind: 'codex', command: '/usr/bin/codex' },
      ],
      conversation: null,
    });
    expect(sessions).not.toHaveBeenCalled();
    // `agent.kind` names the default (decision 240).
    repo.write({ 'symbiote/config.json': '{ "agent": { "kind": "codex" } }\n' });
    expect((await s.state()).agents.map((a) => a.kind)).toEqual(['codex', 'claude']);
    expect((await (await service(repo)).state()).agents).toEqual([]);
    // Nothing written until a question is asked.
    expect(existsSync(record(repo))).toBe(false);
  });

  it("starts Claude Code read-only in the checkout and records its session's ID", async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    const state = await s.ask({ text: "Where is the merger's prompt defined?" });
    const settings = join(repo.root, 'symbiote', 'scout-settings.json');
    expect(startPageAgent).toHaveBeenCalledTimes(1);
    const request = startPageAgent.mock.calls[0]?.[0];
    expect(request).toMatchObject({ cwd: repo.root, name: 'Scout', settings, ...READ_ONLY });
    expect(request?.prompt).toBe(
      DEFAULT_PROMPTS.scout.replace('{question}', "Where is the merger's prompt defined?"),
    );
    expect(readFileSync(settings, 'utf8')).toBe(
      scoutSettings({ node: '/usr/bin/node', gate: GATE }),
    );
    expect(JSON.parse(readFileSync(record(repo), 'utf8'))).toEqual({
      about:
        "Scout's conversation in this checkout (V35): a read-only agent started in Symbiote. Not a workspace.",
      agent: 'claude',
      id: 's9',
      sessionId: 'session-9',
      started: NOW.toISOString(),
    });
    expect(state.conversation).toEqual({
      kind: 'claude',
      started: NOW.toISOString(),
      state: 'working',
      id: 's9',
    });
    // Its files are out of git: the checkout stays clean.
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  it("never takes the person's own session in the checkout for Scout's", async () => {
    const repo = fresh();
    const { claude, listed, set } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    await s.ask({ text: 'Q' });
    set('s9', { state: 'done', status: 'idle' });
    // The person starts a session of their own there, newer, working, even named Scout.
    listed.push({
      cwd: repo.root,
      kind: 'background',
      startedAt: 9e12,
      id: 'mine',
      sessionId: 'session-mine',
      name: 'Scout',
      state: 'working',
      status: 'busy',
    });
    expect((await s.state()).conversation).toMatchObject({ id: 's9', state: 'answered' });
    // Removed outside Symbiote: gone, not the person's.
    listed.splice(
      listed.findIndex((x) => x.id === 's9'),
      1,
    );
    expect((await s.state()).conversation).toMatchObject({ state: 'gone' });
    expect((await s.state()).conversation).not.toHaveProperty('id');
    // A question then starts a new conversation.
    expect((await s.ask({ text: 'Again' })).conversation).toMatchObject({
      id: 's10',
      state: 'working',
    });
  });

  it("refuses a start when Claude Code's new session cannot be found, recording nothing", async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    startPageAgent.mockImplementation(() => Promise.resolve({ ok: true }));
    const s = await service(repo, { claude });
    await expect(s.ask({ text: 'Q' })).rejects.toThrow(
      /Claude Code started no session Symbiote can find/,
    );
    expect(existsSync(record(repo))).toBe(false);
    startPageAgent.mockImplementation(() =>
      Promise.resolve({ ok: false, error: 'Workspace not trusted.' }),
    );
    await expect(s.ask({ text: 'Q' })).rejects.toThrow('Workspace not trusted.');
    expect(existsSync(record(repo))).toBe(false);
  });

  it('continues the conversation: refused while Scout works, stopped first when it is idle', async () => {
    const repo = fresh();
    const { claude, stop, resume, set } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    await s.ask({ text: 'Q' });
    const busy = await s.ask({ text: 'And why?' }).catch((e: unknown) => e);
    expect(busy).toBeInstanceOf(ScoutRefused);
    expect(busy).toMatchObject({ status: 409 });
    set('s9', { state: 'done', status: 'idle' });
    const state = await s.ask({ text: 'And why?' });
    expect(stop).toHaveBeenCalledWith('s9');
    expect(resume).toHaveBeenCalledWith({
      sessionId: 'session-9',
      cwd: repo.root,
      text: 'And why?',
    });
    expect(state.conversation).toMatchObject({ id: 's9', state: 'working' });
    // Stopped: continued without a stop.
    set('s9', { state: 'stopped' });
    stop.mockClear();
    await s.ask({ text: 'Once more' });
    expect(stop).not.toHaveBeenCalled();
  });

  it('starts a new conversation: the old session stopped and removed, the record gone', async () => {
    const repo = fresh();
    const { claude, stop, remove, startPageAgent } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    await s.ask({ text: 'Q' });
    expect((await s.renew()).conversation).toBeNull();
    expect(stop).toHaveBeenCalledWith('s9');
    expect(remove).toHaveBeenCalledWith('s9');
    expect(existsSync(record(repo))).toBe(false);
    // The next question starts another.
    expect((await s.ask({ text: 'Q2' })).conversation).toMatchObject({ id: 's10' });
    expect(startPageAgent).toHaveBeenCalledTimes(2);
    // Gone already: only the record goes.
    remove.mockClear();
    await claude.remove('s10');
    remove.mockClear();
    expect((await s.renew()).conversation).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it("opens a terminal on Scout's session in the checkout", async () => {
    const repo = fresh();
    const { claude } = fakeClaude(repo.root);
    const { terminals, opening } = fakeTerminals();
    const s = await service(repo, { claude, terminals });
    await expect(s.terminal({ cols: 80, rows: 24 })).rejects.toMatchObject({ status: 409 });
    await s.ask({ text: 'Q' });
    expect(await s.terminal({ cols: 120, rows: 40 })).toEqual({ id: 't1' });
    expect(opening).toEqual([
      {
        command: '/usr/bin/claude',
        args: ['attach', 's9'],
        cwd: repo.root,
        cols: 120,
        rows: 40,
        env: { PATH: '/usr/bin' },
      },
    ]);
    expect((await s.state()).terminal).toEqual({ available: true });
  });

  it("uses the project's prompt (prompts.scout), and refuses what it cannot ask", async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    await expect(s.ask({ text: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(s.ask({ text: 'x'.repeat(20_001) })).rejects.toMatchObject({ status: 400 });
    await expect(s.ask({ text: 'Q', agent: 'codex' })).rejects.toThrow('Codex is not installed');
    mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
    writeFileSync(
      join(repo.root, 'symbiote', 'config.json'),
      '{ "prompts": { "scout": "Answer briefly. {question}" } }\n',
    );
    await s.ask({ text: 'Where is X?' });
    expect(startPageAgent.mock.calls[0]?.[0].prompt).toBe('Answer briefly. Where is X?');
    await expect((await service(fresh())).ask({ text: 'Q' })).rejects.toThrow(
      /Scout needs Claude Code or Codex/,
    );
  });

  it('starts Codex read-only on its app server, opens its TUI there, archives it for a new one', async () => {
    const repo = fresh();
    const server = await appServer();
    const { codex, archive } = fakeCodex(server);
    const { terminals, opening } = fakeTerminals();
    const s = await service(repo, { codex, terminals });
    const state = await s.ask({ text: 'Where is it?' });
    const start = server.calls.find((c) => c.method === 'thread/start');
    expect(start?.params).toEqual({
      cwd: repo.root,
      sandbox: 'read-only',
      approvalPolicy: 'never',
    });
    expect(server.thread('thread-1')).toMatchObject({ name: 'Scout', sandbox: 'read-only' });
    expect(JSON.parse(readFileSync(record(repo), 'utf8'))).toMatchObject({
      agent: 'codex',
      thread: 'thread-1',
    });
    expect(state.conversation).toMatchObject({ kind: 'codex', state: 'working', id: 'thread-1' });
    await s.terminal({ cols: 100, rows: 30 });
    expect(opening[0]).toMatchObject({
      command: '/usr/bin/codex',
      args: ['resume', 'thread-1', '--remote', server.address, '-C', repo.root],
      cwd: repo.root,
    });
    expect((await s.renew()).conversation).toBeNull();
    expect(server.thread('thread-1')).toMatchObject({ archived: true });
    expect(archive).not.toHaveBeenCalled();
    // Without its app server, Codex has no terminal: Scout says so.
    const without = await service(repo, { codex: fakeCodex(null).codex });
    await expect(without.ask({ text: 'Q' })).rejects.toThrow(/app server/);
  });
});

describe("Scout's effort (fix/scout-effort-level)", () => {
  const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const config = (repo: TestRepo) => join(repo.root, 'symbiote', 'config.json');
  /** Claude Code with the levels its `--help` lists. */
  const leveled = (repo: TestRepo) => {
    const fake = fakeClaude(repo.root);
    fake.claude.efforts = () => Promise.resolve(LEVELS);
    return fake;
  };

  it("lists each agent's levels and the project's, read only when asked for", async () => {
    const repo = fresh();
    const { claude } = leveled(repo);
    const efforts = vi.fn(() => Promise.resolve(LEVELS));
    claude.efforts = efforts;
    const { codex } = fakeCodex(null);
    codex.efforts = () => Promise.resolve({ levels: ['low', 'medium', 'high'], default: 'medium' });
    const s = await service(repo, { claude, codex });
    await s.state();
    // Read with the shell's every read, Codex's would start its daemon: never there.
    expect(efforts).not.toHaveBeenCalled();
    expect(await s.efforts()).toEqual({
      agents: [
        { kind: 'claude', efforts: { levels: LEVELS } },
        { kind: 'codex', efforts: { levels: ['low', 'medium', 'high'], default: 'medium' } },
      ],
      file: 'symbiote/config.json',
    });
    repo.write({ 'symbiote/config.json': '{ "scout": { "effort": "high" } }\n' });
    expect(await s.efforts()).toMatchObject({ effort: 'high' });
    // Not a level's word: none.
    repo.write({ 'symbiote/config.json': '{ "scout": { "effort": "--max" } }\n' });
    expect(await s.efforts()).not.toHaveProperty('effort');
    // An agent whose levels cannot be read: listed without them.
    claude.efforts = () => Promise.resolve(null);
    expect((await s.efforts()).agents[0]).toEqual({ kind: 'claude' });
  });

  it('starts Claude Code at the level asked, records it, and says it', async () => {
    const repo = fresh();
    const { claude, startPageAgent } = leveled(repo);
    const s = await service(repo, { claude });
    const state = await s.ask({ text: 'Q', effort: 'high' });
    expect(startPageAgent.mock.calls[0]?.[0]).toMatchObject({ effort: 'high' });
    expect(JSON.parse(readFileSync(record(repo), 'utf8'))).toMatchObject({ effort: 'high' });
    expect(state.conversation).toMatchObject({ kind: 'claude', effort: 'high' });
  });

  it("starts at the project's level when none is asked; at the agent's own for null or one it does not list", async () => {
    const repo = fresh();
    const { claude, startPageAgent } = leveled(repo);
    const s = await service(repo, { claude });
    repo.write({ 'symbiote/config.json': '{ "scout": { "effort": "medium" } }\n' });
    expect((await s.ask({ text: 'Q' })).conversation).toMatchObject({ effort: 'medium' });
    expect(startPageAgent.mock.lastCall?.[0]).toMatchObject({ effort: 'medium' });
    await s.renew();
    // Null: the agent's own default, whatever the project says.
    expect((await s.ask({ text: 'Q', effort: null })).conversation).not.toHaveProperty('effort');
    expect(startPageAgent.mock.lastCall?.[0]).not.toHaveProperty('effort');
    expect(JSON.parse(readFileSync(record(repo), 'utf8'))).not.toHaveProperty('effort');
    await s.renew();
    // A level this agent does not list: its default, not a refusal (the project's file may be
    // another agent's or an older Claude Code's).
    repo.write({ 'symbiote/config.json': '{ "scout": { "effort": "ultra" } }\n' });
    await s.ask({ text: 'Q' });
    expect(startPageAgent.mock.lastCall?.[0]).not.toHaveProperty('effort');
  });

  it('refuses a level the agent does not list, and one for a conversation that runs', async () => {
    const repo = fresh();
    const { claude, startPageAgent } = leveled(repo);
    const s = await service(repo, { claude });
    await expect(s.ask({ text: 'Q', effort: 'ultra' })).rejects.toMatchObject({
      status: 400,
      message: 'Claude Code takes low, medium, high, xhigh or max: ultra',
    });
    await expect(s.ask({ text: 'Q', effort: 3 } as unknown as ScoutAsk)).rejects.toMatchObject({
      status: 400,
      message: 'an effort level is a word, such as high: 3',
    });
    claude.efforts = () => Promise.resolve(null);
    await expect(s.ask({ text: 'Q', effort: 'high' })).rejects.toMatchObject({
      status: 400,
      message: "Symbiote cannot read Claude Code's effort levels: start it at its default",
    });
    expect(startPageAgent).not.toHaveBeenCalled();
    expect(existsSync(record(repo))).toBe(false);
    claude.efforts = () => Promise.resolve(LEVELS);
    await s.ask({ text: 'Q', effort: 'low' });
    await expect(s.ask({ text: 'And?', effort: 'high' })).rejects.toMatchObject({
      status: 409,
      message: 'this conversation started at its level: change it in its terminal',
    });
  });

  it('starts Codex at the level on its first turn', async () => {
    const repo = fresh();
    const server = await appServer();
    const { codex } = fakeCodex(server);
    codex.efforts = () => Promise.resolve({ levels: ['low', 'medium', 'high'], default: 'medium' });
    const s = await service(repo, { codex });
    const state = await s.ask({ text: 'Where is it?', effort: 'low' });
    const turn = server.calls.find((c) => c.method === 'turn/start');
    expect(turn?.params).toMatchObject({ effort: 'low' });
    expect(state.conversation).toMatchObject({ kind: 'codex', effort: 'low' });
  });

  it("saves the project's level in its config, the rest as it was; null removes it", async () => {
    const repo = fresh();
    const { claude } = leveled(repo);
    const s = await service(repo, { claude });
    // The shape of a real one: four spaces, an inline list, the last section over several lines.
    // (jsonc-parser rewrites the line it inserts after: an inline object there would be spread.)
    const before =
      '{\n    "merge": {\n        "checks": ["pnpm check", "pnpm build"],\n        "push": true\n    },\n' +
      '    "prompts": {\n        "scout": "Q: {question}"\n    }\n}\n';
    repo.write({ 'symbiote/config.json': before });
    expect(await s.setEffort({ effort: 'high' })).toMatchObject({ effort: 'high' });
    expect(JSON.parse(readFileSync(config(repo), 'utf8'))).toEqual({
      merge: { checks: ['pnpm check', 'pnpm build'], push: true },
      prompts: { scout: 'Q: {question}' },
      scout: { effort: 'high' },
    });
    expect(readFileSync(config(repo), 'utf8')).toContain('\n    "scout": {');
    // Null: the agent's own default, and the file as it was.
    expect(await s.setEffort({ effort: null })).not.toHaveProperty('effort');
    expect(readFileSync(config(repo), 'utf8')).toBe(before);
    // Scout's default agent decides what can be saved.
    await expect(s.setEffort({ effort: 'ultra' })).rejects.toMatchObject({
      status: 400,
      message: 'Claude Code takes low, medium, high, xhigh or max: ultra',
    });
    repo.write({ 'symbiote/config.json': '{ not json' });
    await expect(s.setEffort({ effort: 'high' })).rejects.toMatchObject({ status: 409 });
    expect(readFileSync(config(repo), 'utf8')).toBe('{ not json');
  });

  it('creates symbiote/config.json for a level, out of the way of nothing else', async () => {
    const repo = fresh();
    const { claude } = leveled(repo);
    const s = await service(repo, { claude });
    await s.setEffort({ effort: 'low' });
    expect(JSON.parse(readFileSync(config(repo), 'utf8'))).toEqual({ scout: { effort: 'low' } });
    await expect((await service(fresh())).setEffort({ effort: 'low' })).rejects.toMatchObject({
      status: 409,
      message: 'Scout needs Claude Code or Codex: neither is installed',
    });
  });
});

describe('Scribe (V41): the same conversation, writing skills', () => {
  const SCRIBE_GATE = '/opt/symbiote/dist/scribe-hook.js';
  const scribeService = async (
    repo: TestRepo,
    {
      claude = null,
      codex = null,
      terminals,
    }: { claude?: ClaudeCode | null; codex?: Codex | null; terminals?: Terminals } = {},
  ) =>
    scribe(await openRepo(repo.root), cache, {
      claude: () => Promise.resolve(claude),
      codex: () => Promise.resolve(codex),
      now: () => NOW,
      env: { PATH: '/usr/bin' },
      gate: SCRIBE_GATE,
      node: '/usr/bin/node',
      ...(terminals ? { terminals } : {}),
    });
  const scribeRecord = (repo: TestRepo) => join(repo.root, 'symbiote', 'scribe.json');

  it('starts Claude Code in the checkout with Write and Edit, its gate given the skills folder, asking', async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const s = await scribeService(repo, { claude });
    const state = await s.ask({ text: 'A skill for adding a prompt to Settings' });
    const skills = join(repo.root, '.claude', 'skills');
    const settings = join(repo.root, 'symbiote', 'scribe-settings.json');
    expect(startPageAgent).toHaveBeenCalledTimes(1);
    const request = startPageAgent.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      cwd: repo.root,
      name: 'Scribe',
      settings,
      tools: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'],
      // Claude Code asks the person before each write into .claude (decision 275).
      permissionMode: 'default',
    });
    expect(request?.prompt).toBe(
      fillPrompt(DEFAULT_PROMPTS.scribe, {
        request: 'A skill for adding a prompt to Settings',
        skills,
        checkout: repo.root,
      }),
    );
    // Its gate, given the folder; and its writes in the checkout, not in a worktree of Claude
    // Code's own: a background session refuses an edit outside one unless told so (V41).
    expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual({
      worktree: { bgIsolation: 'none' },
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: `'/usr/bin/node' '${SCRIBE_GATE}' '${skills}'`,
                timeout: 30,
              },
            ],
          },
        ],
      },
    });
    expect(JSON.parse(readFileSync(scribeRecord(repo), 'utf8'))).toMatchObject({
      about:
        "Scribe's conversation in this checkout (V41): an agent started in Symbiote that writes skills in .claude/skills. Not a workspace.",
      agent: 'claude',
      id: 's9',
    });
    expect(state.conversation).toMatchObject({ kind: 'claude', state: 'working', id: 's9' });
    // Its folder is made for it; nothing shows in git until it writes a skill.
    expect(existsSync(skills)).toBe(true);
    expect(repo.git('status', '--porcelain')).toBe('');
    // Scout's conversation is apart.
    expect(existsSync(record(repo))).toBe(false);
    expect((await (await service(repo, { claude })).state()).conversation).toBeNull();
  });

  it('starts Codex in the skills folder, writing there and nowhere else, asking nobody', async () => {
    const repo = fresh();
    const server = await appServer();
    const { codex } = fakeCodex(server);
    const { terminals, opening } = fakeTerminals();
    const s = await scribeService(repo, { codex, terminals });
    await s.ask({ text: 'A skill for releases' });
    const skills = join(repo.root, '.claude', 'skills');
    const start = server.calls.find((c) => c.method === 'thread/start');
    expect(start?.params).toEqual({
      cwd: skills,
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
    });
    expect(server.thread('thread-1')).toMatchObject({ name: 'Scribe' });
    await s.terminal({ cols: 100, rows: 30 });
    expect(opening[0]).toMatchObject({
      command: '/usr/bin/codex',
      args: ['resume', 'thread-1', '--remote', server.address, '-C', skills],
      cwd: skills,
    });
  });

  it('speaks of itself, and has no level in the project’s config', async () => {
    const repo = fresh();
    await expect((await scribeService(repo)).ask({ text: 'Q' })).rejects.toThrow(
      'Scribe needs Claude Code or Codex: neither is installed',
    );
    await expect(
      (await scribeService(repo, { claude: fakeClaude(repo.root).claude })).setEffort({
        effort: null,
      }),
    ).rejects.toThrow("Scribe has no level in the project's config");
  });
});
