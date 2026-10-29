import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openRepo, type AgentModel, type PageAgentAsk } from '@symbiote/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { codexServer, readProfile } from '../src/app-server.js';
import { codexFolders, type Codex } from '../src/codex.js';
import { DEFAULT_PROMPTS } from '../src/prompts.js';
import { NUCLEUS_NAME, nucleus } from '../src/nucleus.js';
import {
  findPageAgentSession,
  newPageAgentSession,
  PageAgentRefused,
  pageAgentSettings,
  pageAgentState,
} from '../src/page-agent.js';
import { libraryService, type LibraryService } from '../src/library.js';
import { scribe, scribePrompt } from '../src/scribe.js';
import { viewFile } from '../src/mcp-bridge.js';
import { gateDecision, nucleusReach } from '../src/nucleus-gate.js';
import type { Terminals } from '../src/terminal.js';
import { claudeCode, type AgentSession, type ClaudeCode } from '../src/claude-code.js';
import type { Run } from '../src/programs.js';
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
const GATE = '/opt/symbiote/dist/nucleus-hook.js';
/** Where Symbiote's MCP bridge would be installed (MC1). */
const BRIDGE = '/opt/symbiote/dist/mcp-stdio.js';

/**
 * A fake Claude Code: the person's own interactive session in the checkout, newer than anything
 * Nucleus starts, and Nucleus's background session once started (`s9`).
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
      name: 'Nucleus',
      state: 'done',
      status: 'idle',
    },
  ];
  let next = 9;
  // Without a prompt, Claude Code 2.1.310's session waits for its first one (V50 spike).
  const startPageAgent = vi.fn<ClaudeCode['startPageAgent']>(({ cwd, name, prompt }) => {
    listed.push({
      cwd,
      kind: 'background',
      startedAt: next,
      id: `s${next}`,
      sessionId: `session-${next}`,
      name,
      ...(prompt === undefined
        ? { state: 'blocked', status: 'idle' }
        : { state: 'working', status: 'busy' }),
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
  /** Sets what Claude Code says of Nucleus's session. */
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
  nucleus(await openRepo(repo.root), cache, {
    claude: () => Promise.resolve(claude),
    codex: () => Promise.resolve(codex),
    now: () => NOW,
    env: { PATH: '/usr/bin' },
    gate: GATE,
    bridge: BRIDGE,
    node: '/usr/bin/node',
    ...(terminals ? { terminals } : {}),
  });

const record = (repo: TestRepo) => join(repo.root, 'symbiote', 'nucleus.json');

/** Nucleus's tools and mode (V35, decision 236): read-only in the checkout, the web since NU1. */
const READ_ONLY = {
  tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebSearch', 'WebFetch'],
  permissionMode: 'dontAsk',
} as const;

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
        name: 'Nucleus',
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
          'Nucleus',
          '--tools',
          'Read,Grep,Glob,Bash,WebSearch,WebFetch',
          '--permission-mode',
          'dontAsk',
          '--strict-mcp-config',
          '--settings',
          '/repo/symbiote/scout-settings.json',
          '--model',
          'sonnet',
          '--',
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
    const request = { cwd: '/repo', name: 'Nucleus', prompt: 'Q', settings: '/s', ...READ_ONLY };
    await claude.startPageAgent({ ...request, effort: 'low' });
    await claude.startPageAgent(request);
    expect(calls[0]?.slice(-4)).toEqual(['--effort', 'low', '--', 'Q']);
    expect(calls[1]).not.toContain('--effort');
  });

  it('gives a folder outside the checkout with --add-dir, before its settings (SK1)', async () => {
    const calls: string[][] = [];
    const run: Run = (_command, args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    const claude = claudeCode('/usr/bin/claude', { run, cwd: '/repo' });
    const request = { cwd: '/repo', name: 'Scribe', prompt: 'Q', settings: '/s', ...READ_ONLY };
    await claude.startPageAgent({ ...request, addDirs: ['/home/a/skills'] });
    const at = calls[0]?.indexOf('--add-dir') ?? -1;
    expect(calls[0]?.slice(at, at + 4)).toEqual([
      '--add-dir',
      '/home/a/skills',
      '--settings',
      '/s',
    ]);
    await claude.startPageAgent(request);
    expect(calls[1]).not.toContain('--add-dir');
  });

  it("gives Symbiote's MCP server, and no other, when asked (MC1)", async () => {
    const calls: string[][] = [];
    const run: Run = (_command, args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    const claude = claudeCode('/usr/bin/claude', { run, cwd: '/repo' });
    const request = { cwd: '/repo', name: 'Nucleus', prompt: 'Q', settings: '/s', ...READ_ONLY };
    await claude.startPageAgent({ ...request, mcpConfig: '/repo/symbiote/scout-mcp.json' });
    const at = calls[0]?.indexOf('--strict-mcp-config') ?? -1;
    expect(calls[0]?.slice(at, at + 3)).toEqual([
      '--strict-mcp-config',
      '--mcp-config',
      '/repo/symbiote/scout-mcp.json',
    ]);
    await claude.startPageAgent(request);
    expect(calls[1]).not.toContain('--mcp-config');
  });

  it("starts with no question, its instructions as Claude Code's appended system prompt (V50)", async () => {
    const calls: string[][] = [];
    const run: Run = (_command, args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    const claude = claudeCode('/usr/bin/claude', { run, cwd: '/repo' });
    const request = { cwd: '/repo', name: 'Nucleus', settings: '/s', ...READ_ONLY };
    await claude.startPageAgent({ ...request, instructions: 'You are Scout.', effort: 'low' });
    // Nothing after it: no prompt, so the session waits for its first one.
    expect(calls[0]?.slice(-4)).toEqual([
      '--effort',
      'low',
      '--append-system-prompt',
      'You are Scout.',
    ]);
    await claude.startPageAgent({ ...request, instructions: 'You are Scout.', prompt: 'Q' });
    expect(calls[1]?.slice(-4)).toEqual(['--append-system-prompt', 'You are Scout.', '--', 'Q']);
  });

  it("says Claude Code's words when it does not start", async () => {
    const run: Run = () =>
      Promise.resolve({ code: 1, stdout: '', stderr: 'Workspace not trusted. Run `claude`…\n' });
    const claude = claudeCode('/usr/bin/claude', { run, cwd: '/repo' });
    expect(
      await claude.startPageAgent({
        cwd: '/repo',
        name: 'Nucleus',
        prompt: 'Q',
        settings: '/s',
        ...READ_ONLY,
      }),
    ).toEqual({ ok: false, error: 'Workspace not trusted. Run `claude`…' });
  });
});

describe('pageAgentSettings', () => {
  it('runs the gate before every tool, and records nothing', () => {
    const settings = JSON.parse(
      pageAgentSettings({ node: '/usr/bin/node', gate: GATE }, 'linux'),
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

describe("finding Nucleus's session (decision 239)", () => {
  const root = '/repo';
  const real = (path: string) => path;
  const mine: AgentSession = {
    cwd: root,
    kind: 'interactive',
    startedAt: 50,
    name: 'symbiote-38',
    status: 'idle',
  };
  const nucleusSession: AgentSession = {
    cwd: root,
    kind: 'background',
    startedAt: 10,
    id: 's9',
    sessionId: 'session-9',
    name: 'Nucleus',
    state: 'done',
    status: 'idle',
  };

  it('takes the background session named Nucleus in the checkout that was not listed before', () => {
    const before = [mine];
    const other = { ...nucleusSession, cwd: '/elsewhere', id: 'x', startedAt: 20 };
    const unnamed = { ...nucleusSession, name: 'my-own', id: 'y', startedAt: 30 };
    expect(
      newPageAgentSession(before, [mine, other, unnamed, nucleusSession], root, real, NUCLEUS_NAME)
        ?.id,
    ).toBe('s9');
    // Listed before: not the one just started.
    expect(
      newPageAgentSession([mine, nucleusSession], [mine, nucleusSession], root, real, NUCLEUS_NAME),
    ).toBeUndefined();
  });

  it('finds it by its recorded ID, never by its folder', () => {
    const newer = {
      ...nucleusSession,
      id: 'z',
      sessionId: 'session-z',
      startedAt: 99,
      state: 'working',
    };
    expect(findPageAgentSession({ id: 's9' }, [mine, newer, nucleusSession])).toBe(nucleusSession);
    expect(findPageAgentSession({ id: 's9' }, [mine, newer])).toBeUndefined();
  });

  it("reads Claude Code's word for it", () => {
    const read = (fields: Partial<AgentSession>) =>
      pageAgentState({ ...nucleusSession, state: undefined, status: undefined, ...fields });
    expect(read({ state: 'working', status: 'busy' })).toBe('working');
    expect(read({ status: 'busy' })).toBe('working');
    expect(read({ state: 'done', status: 'idle' })).toBe('answered');
    // A finished plan, a turn ended on a refused tool, a session asked nothing yet (V50 spike):
    // only Nucleus's record tells the last ('ready', V50).
    expect(read({ state: 'blocked', status: 'idle' })).toBe('answered');
    // Esc: no hook, `working` and idle (V21).
    expect(read({ state: 'working', status: 'idle' })).toBe('interrupted');
    expect(read({ state: 'blocked', status: 'waiting', waitingFor: 'permission prompt' })).toBe(
      'needs-you',
    );
    expect(read({ state: 'stopped' })).toBe('stopped');
    expect(read({ state: 'failed' })).toBe('failed');
    expect(pageAgentState(undefined)).toBe('gone');
  });
});

describe('nucleus (V35)', () => {
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
    // A workspace's Hermes (V58) is not Nucleus's: Nucleus keeps Claude Code and Codex (decision 421).
    repo.write({ 'symbiote/config.json': '{ "agent": { "kind": "hermes" } }\n' });
    expect((await s.state()).agents.map((a) => a.kind)).toEqual(['claude', 'codex']);
    await expect(s.ask({ text: 'Why?', agent: 'hermes' })).rejects.toMatchObject({ status: 400 });
    expect((await (await service(repo)).state()).agents).toEqual([]);
    // Nothing written until a question is asked.
    expect(existsSync(record(repo))).toBe(false);
  });

  it("starts Claude Code read-only in the checkout and records its session's ID", async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    const state = await s.ask({ text: "Where is the merger's prompt defined?" });
    const settings = join(repo.root, 'symbiote', 'nucleus-settings.json');
    expect(startPageAgent).toHaveBeenCalledTimes(1);
    const request = startPageAgent.mock.calls[0]?.[0];
    expect(request).toMatchObject({ cwd: repo.root, name: 'Nucleus', settings, ...READ_ONLY });
    // Its instructions are its system prompt (V50, decision 383); the question its first message.
    expect(request?.instructions).toBe(DEFAULT_PROMPTS.nucleus);
    expect(request?.prompt).toBe("Where is the merger's prompt defined?");
    // Its gate is given the checkout and the workspaces' records (V80, decision 596).
    expect(readFileSync(settings, 'utf8')).toBe(
      pageAgentSettings({
        node: '/usr/bin/node',
        gate: GATE,
        args: [repo.root, join(repo.root, 'symbiote', 'workspaces'), '--web'],
      }),
    );
    expect(JSON.parse(readFileSync(record(repo), 'utf8'))).toEqual({
      about:
        "Nucleus's conversation in this checkout (NU1): the person's orchestrator, started in Symbiote. Not a workspace.",
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

  it("never takes the person's own session in the checkout for Nucleus's", async () => {
    const repo = fresh();
    const { claude, listed, set } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    await s.ask({ text: 'Q' });
    set('s9', { state: 'done', status: 'idle' });
    // The person starts a session of their own there, newer, working, even named Nucleus.
    listed.push({
      cwd: repo.root,
      kind: 'background',
      startedAt: 9e12,
      id: 'mine',
      sessionId: 'session-mine',
      name: 'Nucleus',
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

  it('continues the conversation: refused while Nucleus works, stopped first when it is idle', async () => {
    const repo = fresh();
    const { claude, stop, resume, set } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    await s.ask({ text: 'Q' });
    const busy = await s.ask({ text: 'And why?' }).catch((e: unknown) => e);
    expect(busy).toBeInstanceOf(PageAgentRefused);
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

  it("opens a terminal on Nucleus's session in the checkout", async () => {
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

  it("uses the project's prompt (prompts.nucleus), and refuses what it cannot ask", async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    await expect(s.ask({ text: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(s.ask({ text: 'x'.repeat(20_001) })).rejects.toMatchObject({ status: 400 });
    await expect(s.ask({ text: 'Q', agent: 'codex' })).rejects.toThrow('Codex is not installed');
    mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
    writeFileSync(
      join(repo.root, 'symbiote', 'config.json'),
      '{ "prompts": { "nucleus": "Answer briefly." } }\n',
    );
    await s.ask({ text: 'Where is X?' });
    expect(startPageAgent.mock.calls[0]?.[0]).toMatchObject({
      instructions: 'Answer briefly.',
      prompt: 'Where is X?',
    });
    // A project's text from before V50 still holding {question}: filled with nothing.
    await s.renew();
    writeFileSync(
      join(repo.root, 'symbiote', 'config.json'),
      '{ "prompts": { "nucleus": "Answer briefly.\\n\\nThe question:\\n\\n{question}" } }\n',
    );
    await s.open({});
    expect(startPageAgent.mock.calls[1]?.[0].instructions).toBe('Answer briefly.\n\nThe question:');
    await expect((await service(fresh())).ask({ text: 'Q' })).rejects.toThrow(
      /Nucleus needs Claude Code or Codex/,
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
    // Read-only through a profile that reads the checkout (V80, decision 599), not a mode.
    expect(start?.params).toMatchObject({ cwd: repo.root, approvalPolicy: 'never' });
    expect(start?.params).not.toHaveProperty('sandbox');
    expect(server.thread('thread-1')).toMatchObject({
      name: 'Nucleus',
      sandbox: 'read-only',
      reads: [...codexFolders('/usr/bin/codex'), repo.root],
    });
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
    // Without its app server, Codex has no terminal: Nucleus says so.
    const without = await service(repo, { codex: fakeCodex(null).codex });
    await expect(without.ask({ text: 'Q' })).rejects.toThrow(/app server/);
  });
});

describe("Nucleus reads the workspaces' worktrees (V80, decisions 596-599)", () => {
  /** `repo` with a workspace's worktree beside it, and its record. */
  function withWorkspace(repo: TestRepo) {
    const holder = `${repo.root}.worktrees`;
    folders.push(holder);
    const worktree = join(holder, 'feature-a');
    repo.git('worktree', 'add', '--quiet', worktree, '-b', 'feature/a');
    writeFileSync(join(worktree, 'wip.md'), 'not committed\n');
    const file = join(repo.root, 'symbiote', 'workspaces', 'feature', 'a.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        agent: null,
        base: repo.git('rev-parse', 'HEAD'),
        branch: 'feature/a',
        brief: 'b',
        created: NOW.toISOString(),
        planFirst: false,
        worktree,
      }),
    );
    return { holder, worktree };
  }

  /** The gate's arguments as Nucleus's settings file gives them to the hook. */
  const gateArgsOf = (settings: string): string[] => {
    const text = readFileSync(settings, 'utf8');
    const command = (
      JSON.parse(text) as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } }
    ).hooks.PreToolUse[0]?.hooks[0]?.command;
    return (command ?? '')
      .split(' ')
      .slice(2)
      .map((word) => word.replace(/^'|'$/g, ''));
  };
  const read = (file_path: string) => ({
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path },
  });

  it("opens the workspaces' worktrees to its gate and nothing outside them; no --add-dir", async () => {
    const repo = fresh();
    const { holder, worktree } = withWorkspace(repo);
    const { claude, startPageAgent } = fakeClaude(repo.root);
    await (await service(repo, { claude })).open({});
    const request = startPageAgent.mock.calls[0]?.[0];
    // Nothing opened for the whole session: the gate decides at each call.
    expect(request).not.toHaveProperty('addDirs');
    const args = gateArgsOf(request?.settings ?? '');
    expect(args).toEqual([repo.root, join(repo.root, 'symbiote', 'workspaces'), '--web']);
    const reach = nucleusReach(args);
    expect(gateDecision(read(join(worktree, 'wip.md')), { reach })).toMatchObject({ allow: true });
    for (const outside of [
      join(holder, 'other', 'x.md'),
      join(dirname(repo.root), 'x.md'),
      join(repo.root, 'src/a.ts'),
    ]) {
      expect(gateDecision(read(outside), { reach })).toBeNull();
    }
    // A workspace started during the conversation is read at the next call.
    const later = join(holder, 'feature-b');
    repo.git('worktree', 'add', '--quiet', later, '-b', 'feature/b');
    const file = join(repo.root, 'symbiote', 'workspaces', 'feature', 'b.json');
    writeFileSync(
      file,
      readFileSync(join(dirname(file), 'a.json'), 'utf8')
        .replace('feature/a', 'feature/b')
        .replace(worktree, later),
    );
    expect(
      gateDecision(read(join(later, 'README.md')), { reach: nucleusReach(args) }),
    ).toMatchObject({
      allow: true,
    });
  });

  it("confines Codex's Nucleus like Claude Code's: the checkout and the open worktrees, read only (decision 599)", async () => {
    const repo = fresh();
    const { holder, worktree } = withWorkspace(repo);
    // Codex trusts the checkout: without its profile, a thread there would be writable.
    const server = await appServer();
    server.trusted[repo.root] = 'trusted';
    const { codex } = fakeCodex(server);
    const { terminals } = fakeTerminals();
    const s = await service(repo, { codex, terminals });
    await s.open({});
    const own = codexFolders('/usr/bin/codex');
    const start = server.calls.find((c) => c.method === 'thread/start');
    expect(start?.params).not.toHaveProperty('sandbox');
    expect(JSON.stringify(start?.params)).not.toContain('writable');
    expect(server.thread('thread-1')).toMatchObject({
      sandbox: 'read-only',
      reads: [...own, repo.root, worktree],
    });
    expect(JSON.stringify(start?.params)).not.toContain(`"${holder}"`);
    // A workspace started since is in the profile given with the next message, and at a load.
    const later = join(holder, 'feature-b');
    repo.git('worktree', 'add', '--quiet', later, '-b', 'feature/b');
    const file = join(repo.root, 'symbiote', 'workspaces', 'feature', 'b.json');
    writeFileSync(
      file,
      readFileSync(join(dirname(file), 'a.json'), 'utf8')
        .replace('feature/a', 'feature/b')
        .replace(worktree, later),
    );
    const profileOf = (call: { params: Record<string, unknown> } | undefined) =>
      Object.keys(
        (call?.params.config as { permissions: Record<string, { filesystem: object }> })
          .permissions['symbiote-read']?.filesystem ?? {},
      );
    await s.ask({ text: 'What does feature/b change?' });
    const resumed = server.calls.findLast((c) => c.method === 'thread/resume');
    expect(profileOf(resumed)).toEqual([':minimal', ...own, repo.root, worktree, later]);
    server.restart();
    await s.terminal({ cols: 100, rows: 30 });
    expect(profileOf(server.calls.findLast((c) => c.method === 'thread/resume'))).toEqual([
      ':minimal',
      ...own,
      repo.root,
      worktree,
      later,
    ]);
    // Still read-only after the restart: the profile came with the load.
    expect(server.thread('thread-1')).toMatchObject({ sandbox: 'read-only' });
  });

  it('refuses a Codex that would not keep Nucleus read-only: its thread archived, no record', async () => {
    const repo = fresh();
    const dir = mkdtempSync(join(tmpdir(), 'symbiote-scout-as-'));
    folders.push(dir);
    // A Codex without permission profiles, in a checkout it trusts.
    const server = await fakeAppServer(join(dir, 's.sock'), { profiles: false });
    closers.push(() => server.close());
    server.trusted[repo.root] = 'trusted';
    const { codex } = fakeCodex(server);
    await expect((await service(repo, { codex })).open({})).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/not read-only/) as unknown,
    });
    expect(server.threads[0]).toMatchObject({ sandbox: 'workspace-write', archived: true });
    expect(existsSync(record(repo))).toBe(false);
  });
});

describe('Nucleus is a terminal (V50)', () => {
  const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const MODELS: AgentModel[] = [
    { id: 'opus', name: 'Opus 5.5', efforts: { levels: LEVELS } },
    { id: 'sonnet', name: 'Sonnet 5.5', efforts: { levels: LEVELS } },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
  ];
  /** Claude Code with its levels and its models. */
  const listing = (repo: TestRepo) => {
    const fake = fakeClaude(repo.root);
    fake.claude.efforts = () => Promise.resolve(LEVELS);
    fake.claude.models = () => Promise.resolve(structuredClone(MODELS));
    return fake;
  };
  const files = (repo: TestRepo) => ({
    settings: join(repo.root, 'symbiote', 'nucleus-settings.json'),
    mcpConfig: join(repo.root, 'symbiote', 'nucleus-mcp.json'),
  });

  it("opens a conversation with no question: Claude Code waits for its first, Nucleus's instructions its system prompt", async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const { terminals } = fakeTerminals();
    const s = await service(repo, { claude, terminals });
    // Whether a terminal runs, before any conversation: the page shows its terminal or its box.
    expect((await s.state()).terminal).toEqual({ available: true });
    const state = await s.open({});
    expect(startPageAgent).toHaveBeenCalledTimes(1);
    const request = startPageAgent.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      cwd: repo.root,
      name: 'Nucleus',
      ...READ_ONLY,
      ...files(repo),
      instructions: DEFAULT_PROMPTS.nucleus,
    });
    expect(request).not.toHaveProperty('prompt');
    expect(JSON.parse(readFileSync(record(repo), 'utf8'))).toMatchObject({
      agent: 'claude',
      id: 's9',
      sessionId: 'session-9',
      started: NOW.toISOString(),
    });
    expect(state.conversation).toEqual({
      kind: 'claude',
      started: NOW.toISOString(),
      state: 'ready',
      id: 's9',
    });
    // Opened again: the one there is, nothing started.
    expect((await s.open({})).conversation).toMatchObject({ id: 's9' });
    expect(startPageAgent).toHaveBeenCalledTimes(1);
    // Removed outside Symbiote: the next open starts another.
    await claude.remove('s9');
    expect((await s.open({})).conversation).toMatchObject({ id: 's10', state: 'ready' });
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  it('is ready until a turn is seen: Claude Code reads a turn ended on a refused tool as it reads a new session', async () => {
    const repo = fresh();
    const { claude, set } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    await s.open({});
    expect(JSON.parse(readFileSync(record(repo), 'utf8'))).toMatchObject({ fresh: true });
    // Stopped and woken by its terminal with no turn: still asked nothing.
    set('s9', { state: 'stopped' });
    expect((await s.state()).conversation).toMatchObject({ state: 'stopped' });
    set('s9', { state: 'blocked', status: 'idle' });
    expect((await s.state()).conversation).toMatchObject({ state: 'ready' });
    // The first question typed in its terminal: seen working, the record says so from then on.
    set('s9', { state: 'working', status: 'busy' });
    expect((await s.state()).conversation).toMatchObject({ state: 'working' });
    expect(JSON.parse(readFileSync(record(repo), 'utf8'))).not.toHaveProperty('fresh');
    set('s9', { state: 'blocked', status: 'idle' });
    expect((await s.state()).conversation).toMatchObject({ state: 'answered' });
    // A short turn missed between two reads: done is a turn too.
    await s.renew();
    await s.open({});
    set('s10', { state: 'done', status: 'idle' });
    expect((await s.state()).conversation).toMatchObject({ state: 'answered' });
    set('s10', { state: 'blocked', status: 'idle' });
    expect((await s.state()).conversation).toMatchObject({ state: 'answered' });
    // A question asked from the box starts no fresh conversation.
    await s.renew();
    await s.ask({ text: 'Q' });
    expect(JSON.parse(readFileSync(record(repo), 'utf8'))).not.toHaveProperty('fresh');
  });

  it("opens on the model and at the level asked, else the project's; refuses what the agent does not list", async () => {
    const repo = fresh();
    const { claude, startPageAgent } = listing(repo);
    const s = await service(repo, { claude });
    repo.write({
      'symbiote/config.json': '{ "nucleus": { "model": "sonnet", "effort": "medium" } }\n',
    });
    expect((await s.open({})).conversation).toMatchObject({ model: 'sonnet', effort: 'medium' });
    expect(startPageAgent.mock.lastCall?.[0]).toMatchObject({ model: 'sonnet', effort: 'medium' });
    await s.renew();
    expect((await s.open({ model: 'opus', effort: 'high' })).conversation).toMatchObject({
      model: 'opus',
      effort: 'high',
    });
    await s.renew();
    // Null: the agent's own, whatever the project says.
    const own = await s.open({ model: null, effort: null });
    expect(own.conversation).not.toHaveProperty('model');
    expect(own.conversation).not.toHaveProperty('effort');
    expect(startPageAgent.mock.lastCall?.[0]).not.toHaveProperty('model');
    expect(startPageAgent.mock.lastCall?.[0]).not.toHaveProperty('effort');
    await s.renew();
    await expect(s.open({ model: 'gpt-6-luna' })).rejects.toMatchObject({
      status: 400,
      message: 'Claude Code lists no model gpt-6-luna: pick one it lists',
    });
    // The level is checked on the model asked for.
    await expect(
      s.open({ model: 'claude-haiku-4-5-20251001', effort: 'high' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Haiku 4.5 takes no effort level: start it at its default',
    });
    await expect(s.open({ agent: 'codex' })).rejects.toThrow('Codex is not installed');
    expect(existsSync(record(repo))).toBe(false);
  });

  it("opens Codex's thread with no turn, Nucleus's instructions its developer instructions", async () => {
    const repo = fresh();
    const server = await appServer();
    const { codex } = fakeCodex(server);
    codex.efforts = () => Promise.resolve({ levels: ['low', 'medium', 'high'], default: 'medium' });
    const s = await service(repo, { codex });
    const state = await s.open({ effort: 'low' });
    // Read-only through its profile (V80), not a sandbox mode.
    expect(server.calls.find((c) => c.method === 'thread/start')?.params).toMatchObject({
      cwd: repo.root,
      approvalPolicy: 'never',
      developerInstructions: DEFAULT_PROMPTS.nucleus,
      config: { model_reasoning_effort: 'low', default_permissions: 'symbiote-read' },
    });
    expect(server.calls.some((c) => c.method === 'turn/start')).toBe(false);
    expect(state.conversation).toMatchObject({
      kind: 'codex',
      state: 'ready',
      id: 'thread-1',
      effort: 'low',
    });
  });

  it('opens Scribe with no request too (V78, decision 570): its instructions its system prompt', async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const s = scribe(await openRepo(repo.root), cache, {
      claude: () => Promise.resolve(claude),
      now: () => NOW,
      gate: '/opt/symbiote/dist/scribe-hook.js',
      node: '/usr/bin/node',
    });
    expect((await s.open({})).conversation).toMatchObject({ kind: 'claude', state: 'ready' });
    const request = startPageAgent.mock.calls[0]?.[0];
    expect(request).not.toHaveProperty('prompt');
    expect(request?.instructions).toBe(
      scribePrompt(DEFAULT_PROMPTS, {
        skills: join(repo.root, '.claude', 'skills'),
        checkout: repo.root,
      }),
    );
  });
});

describe("Nucleus's effort (fix/scout-effort-level)", () => {
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
    repo.write({ 'symbiote/config.json': '{ "nucleus": { "effort": "high" } }\n' });
    expect(await s.efforts()).toMatchObject({ effort: 'high' });
    // Not a level's word: none.
    repo.write({ 'symbiote/config.json': '{ "nucleus": { "effort": "--max" } }\n' });
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
    repo.write({ 'symbiote/config.json': '{ "nucleus": { "effort": "medium" } }\n' });
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
    repo.write({ 'symbiote/config.json': '{ "nucleus": { "effort": "ultra" } }\n' });
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
    await expect(s.ask({ text: 'Q', effort: 3 } as unknown as PageAgentAsk)).rejects.toMatchObject({
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
      '    "prompts": {\n        "nucleus": "Q: {question}"\n    }\n}\n';
    repo.write({ 'symbiote/config.json': before });
    expect(await s.setEffort({ effort: 'high' })).toMatchObject({ effort: 'high' });
    expect(JSON.parse(readFileSync(config(repo), 'utf8'))).toEqual({
      merge: { checks: ['pnpm check', 'pnpm build'], push: true },
      prompts: { nucleus: 'Q: {question}' },
      nucleus: { effort: 'high' },
    });
    expect(readFileSync(config(repo), 'utf8')).toContain('\n    "nucleus": {');
    // Null: the agent's own default, and the file as it was.
    expect(await s.setEffort({ effort: null })).not.toHaveProperty('effort');
    expect(readFileSync(config(repo), 'utf8')).toBe(before);
    // Nucleus's default agent decides what can be saved.
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
    expect(JSON.parse(readFileSync(config(repo), 'utf8'))).toEqual({ nucleus: { effort: 'low' } });
    await expect((await service(fresh())).setEffort({ effort: 'low' })).rejects.toMatchObject({
      status: 409,
      message: 'Nucleus needs Claude Code or Codex: neither is installed',
    });
  });
});

describe("Nucleus's and Scribe's model (V47)", () => {
  const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
  /** Some of Claude Code 2.1.310's models: Haiku 4.5 takes no level, Opus 4.6 no xhigh. */
  const MODELS: AgentModel[] = [
    { id: 'opus', name: 'Opus 5.5', efforts: { levels: LEVELS } },
    { id: 'sonnet', name: 'Sonnet 5.5', efforts: { levels: LEVELS } },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
    {
      id: 'claude-opus-4-6',
      name: 'Opus 4.6',
      efforts: { levels: ['low', 'medium', 'high', 'max'] },
    },
  ];
  const config = (repo: TestRepo) => join(repo.root, 'symbiote', 'config.json');
  /** Claude Code with its levels and its models. */
  const listing = (repo: TestRepo) => {
    const fake = fakeClaude(repo.root);
    fake.claude.efforts = () => Promise.resolve(LEVELS);
    fake.claude.models = () => Promise.resolve(structuredClone(MODELS));
    return fake;
  };

  it("lists each agent's models and the model it runs on without the project's; the levels on the model it would start on", async () => {
    const repo = fresh();
    const { claude } = listing(repo);
    const server = await appServer();
    const { codex } = fakeCodex(server);
    codex.efforts = () => Promise.resolve({ levels: ['low', 'medium', 'high'], default: 'medium' });
    codex.models = () => codexServer(server.address).models(repo.root);
    const s = await service(repo, { claude, codex });
    const read = await s.efforts();
    expect(read.agents[0]).toEqual({ kind: 'claude', efforts: { levels: LEVELS }, models: MODELS });
    expect(read.agents[1]).toMatchObject({
      kind: 'codex',
      defaultModel: { id: 'gpt-6-luna', by: 'agent' },
    });
    expect(read.agents[1]?.models?.map((m) => m.id)).toEqual([
      'gpt-6-luna',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
    expect(read).not.toHaveProperty('model');
    // nucleus.model: said, and the levels its model takes; the project's agent.model is the default.
    repo.write({
      'symbiote/config.json':
        '{ "agent": { "model": "sonnet" }, "nucleus": { "model": "claude-opus-4-6" } }\n',
    });
    const set = await s.efforts();
    expect(set.model).toBe('claude-opus-4-6');
    expect(set.agents[0]).toMatchObject({
      defaultModel: { id: 'sonnet', by: 'project' },
      efforts: { levels: ['low', 'medium', 'high', 'max'] },
    });
    // Not a model's ID: none.
    repo.write({ 'symbiote/config.json': '{ "nucleus": { "model": "--yolo" } }\n' });
    expect(await s.efforts()).not.toHaveProperty('model');
  });

  it('starts a conversation on nucleus.model when its agent lists it, records and says it; the other agent on its own', async () => {
    const repo = fresh();
    const { claude, startPageAgent } = listing(repo);
    const server = await appServer();
    const { codex } = fakeCodex(server);
    codex.models = () => codexServer(server.address).models(repo.root);
    const s = await service(repo, { claude, codex });
    repo.write({ 'symbiote/config.json': '{ "nucleus": { "model": "sonnet" } }\n' });
    const state = await s.ask({ text: 'Q' });
    expect(startPageAgent.mock.lastCall?.[0]).toMatchObject({ model: 'sonnet' });
    expect(JSON.parse(readFileSync(record(repo), 'utf8'))).toMatchObject({ model: 'sonnet' });
    expect(state.conversation).toMatchObject({ kind: 'claude', model: 'sonnet' });
    await s.renew();
    // Codex lists no sonnet: its own model, nothing recorded.
    const other = await s.ask({ text: 'Q', agent: 'codex' });
    expect(server.calls.find((c) => c.method === 'thread/start')?.params).not.toHaveProperty(
      'model',
    );
    expect(other.conversation).not.toHaveProperty('model');
    await s.renew();
    repo.write({ 'symbiote/config.json': '{ "nucleus": { "model": "gpt-5.6-luna" } }\n' });
    await s.ask({ text: 'Q', agent: 'codex' });
    expect(server.calls.filter((c) => c.method === 'thread/start')[1]?.params).toMatchObject({
      model: 'gpt-5.6-luna',
    });
  });

  it("checks a level against the project's model: none for Haiku 4.5", async () => {
    const repo = fresh();
    const { claude, startPageAgent } = listing(repo);
    const s = await service(repo, { claude });
    repo.write({
      'symbiote/config.json': '{ "nucleus": { "model": "claude-haiku-4-5-20251001" } }\n',
    });
    expect((await s.efforts()).agents[0]).not.toHaveProperty('efforts');
    await expect(s.ask({ text: 'Q', effort: 'high' })).rejects.toMatchObject({
      status: 400,
      message: 'Haiku 4.5 takes no effort level: start it at its default',
    });
    expect(startPageAgent).not.toHaveBeenCalled();
  });

  it('starts a question on the model asked where no terminal runs (V50); refused for one that runs', async () => {
    const repo = fresh();
    const { claude, startPageAgent, set } = listing(repo);
    const s = await service(repo, { claude });
    repo.write({ 'symbiote/config.json': '{ "nucleus": { "model": "sonnet" } }\n' });
    const state = await s.ask({ text: 'Q', model: 'opus', effort: 'max' });
    expect(startPageAgent.mock.lastCall?.[0]).toMatchObject({ model: 'opus', effort: 'max' });
    expect(state.conversation).toMatchObject({ model: 'opus', effort: 'max' });
    set('s9', { state: 'done', status: 'idle' });
    await expect(s.ask({ text: 'And?', model: 'sonnet' })).rejects.toMatchObject({
      status: 409,
      message: 'this conversation started on its model: change it in its terminal',
    });
    await s.renew();
    expect((await s.ask({ text: 'Q', model: null })).conversation).not.toHaveProperty('model');
    await s.renew();
    await expect(s.ask({ text: 'Q', model: '--yolo' })).rejects.toMatchObject({ status: 400 });
  });

  it("saves the project's model in its config, one its default agent lists; null removes it", async () => {
    const repo = fresh();
    const { claude } = listing(repo);
    const s = await service(repo, { claude });
    repo.write({ 'symbiote/config.json': '{\n  "nucleus": { "effort": "high" }\n}\n' });
    expect(await s.setModel({ model: 'sonnet' })).toMatchObject({ model: 'sonnet' });
    expect(JSON.parse(readFileSync(config(repo), 'utf8'))).toEqual({
      nucleus: { effort: 'high', model: 'sonnet' },
    });
    expect(await s.setModel({ model: null })).not.toHaveProperty('model');
    expect(JSON.parse(readFileSync(config(repo), 'utf8'))).toEqual({ nucleus: { effort: 'high' } });
    await expect(s.setModel({ model: 'gpt-6-luna' })).rejects.toMatchObject({
      status: 400,
      message: 'Claude Code lists no model gpt-6-luna: pick one it lists',
    });
    await expect(s.setModel({ model: '--yolo' })).rejects.toMatchObject({ status: 400 });
    claude.models = () => Promise.resolve(null);
    await expect(s.setModel({ model: 'sonnet' })).rejects.toMatchObject({
      status: 400,
      message: "Symbiote cannot read Claude Code's models: start it on its default",
    });
    await expect((await service(fresh())).setModel({ model: 'sonnet' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('gives Scribe its own: scribe.model', async () => {
    const repo = fresh();
    const { claude, startPageAgent } = listing(repo);
    const s = scribe(await openRepo(repo.root), cache, {
      claude: () => Promise.resolve(claude),
      now: () => NOW,
      env: { PATH: '/usr/bin' },
      gate: '/opt/symbiote/dist/scribe-hook.js',
      node: '/usr/bin/node',
    });
    expect(await s.setModel({ model: 'claude-opus-4-6' })).toMatchObject({
      model: 'claude-opus-4-6',
    });
    expect(JSON.parse(readFileSync(config(repo), 'utf8'))).toEqual({
      scribe: { model: 'claude-opus-4-6' },
    });
    await s.ask({ text: 'A skill' });
    expect(startPageAgent.mock.lastCall?.[0]).toMatchObject({ model: 'claude-opus-4-6' });
    // Nucleus's is not Scribe's.
    expect(await (await service(repo, { claude })).efforts()).not.toHaveProperty('model');
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
      library,
    }: {
      claude?: ClaudeCode | null;
      codex?: Codex | null;
      terminals?: Terminals;
      library?: LibraryService;
    } = {},
  ) =>
    scribe(await openRepo(repo.root), cache, {
      claude: () => Promise.resolve(claude),
      codex: () => Promise.resolve(codex),
      now: () => NOW,
      env: { PATH: '/usr/bin' },
      gate: SCRIBE_GATE,
      node: '/usr/bin/node',
      ...(terminals ? { terminals } : {}),
      ...(library ? { library } : {}),
    });
  /** A skill library (SK1) in a folder of the test's own, or at `folder`. */
  const libraryAt = async (folder?: string) => {
    const config = tempDir();
    const at = folder ?? join(config, 'library');
    mkdirSync(at, { recursive: true });
    const service = libraryService(join(config, 'library.json'), { home: config });
    await service.set({ action: 'library', folder: at, commits: 'none' });
    return { folder: at, service };
  };
  const scribeRecord = (repo: TestRepo) => join(repo.root, 'symbiote', 'scribe.json');

  it('opens Claude Code in the checkout with Write and Edit, its gate given the skills folder, asking', async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const s = await scribeService(repo, { claude });
    const state = await s.open({});
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
    // Its instructions its system prompt, the person's words typed in its terminal (V78,
    // decision 570); without a skill library (SK1), no line of it.
    expect(request).not.toHaveProperty('prompt');
    expect(request?.instructions).toBe(
      scribePrompt(DEFAULT_PROMPTS, { skills, checkout: repo.root }),
    );
    expect(request?.instructions).not.toMatch(/library|\{\w+\}/);
    expect(request).not.toHaveProperty('addDirs');
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
    expect(state.conversation).toMatchObject({ kind: 'claude', state: 'ready', id: 's9' });
    // Its folder is made for it; nothing shows in git until it writes a skill.
    expect(existsSync(skills)).toBe(true);
    expect(repo.git('status', '--porcelain')).toBe('');
    // Nucleus's conversation is apart.
    expect(existsSync(record(repo))).toBe(false);
    expect((await (await service(repo, { claude })).state()).conversation).toBeNull();
  });

  it('opens Codex in the skills folder, writing there and nowhere else, asking nobody', async () => {
    const repo = fresh();
    const server = await appServer();
    const { codex } = fakeCodex(server);
    const { terminals, opening } = fakeTerminals();
    const s = await scribeService(repo, { codex, terminals });
    expect((await s.open({})).conversation).toMatchObject({ kind: 'codex', state: 'ready' });
    const skills = join(repo.root, '.claude', 'skills');
    const start = server.calls.find((c) => c.method === 'thread/start');
    expect(start?.params).toEqual({
      cwd: skills,
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
      developerInstructions: scribePrompt(DEFAULT_PROMPTS, { skills, checkout: repo.root }),
    });
    // No turn: the first is typed in its terminal. Named as Nucleus's is (the fake is Codex 0.163,
    // which names a thread once it has a message).
    expect(server.calls.some((c) => c.method === 'turn/start')).toBe(false);
    expect(server.calls.find((c) => c.method === 'thread/name/set')?.params).toMatchObject({
      name: 'Scribe',
    });
    await s.terminal({ cols: 100, rows: 30 });
    expect(opening[0]).toMatchObject({
      command: '/usr/bin/codex',
      args: ['resume', 'thread-1', '--remote', server.address, '-C', skills],
      cwd: skills,
    });
  });

  it('gives Claude Code the library: --add-dir, and its gate both folders (SK1)', async () => {
    const repo = fresh();
    const library = await libraryAt();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const s = await scribeService(repo, { claude, library: library.service });
    await s.open({});
    const skills = join(repo.root, '.claude', 'skills');
    const request = startPageAgent.mock.calls[0]?.[0];
    expect(request?.addDirs).toEqual([library.folder]);
    expect(request?.instructions).toBe(
      scribePrompt(DEFAULT_PROMPTS, { skills, checkout: repo.root, library: library.folder }),
    );
    expect(request?.instructions).toContain(`${library.folder}/<name>/SKILL.md`);
    const settings = join(repo.root, 'symbiote', 'scribe-settings.json');
    expect(
      (
        JSON.parse(readFileSync(settings, 'utf8')) as {
          hooks: { PreToolUse: { hooks: { command: string }[] }[] };
        }
      ).hooks.PreToolUse[0]?.hooks[0]?.command,
    ).toBe(`'/usr/bin/node' '${SCRIBE_GATE}' '${skills}' '${library.folder}'`);
  });

  it('gives Codex the library as a folder it may write too (SK1)', async () => {
    const repo = fresh();
    const library = await libraryAt();
    const server = await appServer();
    const { codex } = fakeCodex(server);
    const s = await scribeService(repo, { codex, library: library.service });
    await s.open({});
    const start = server.calls.find((c) => c.method === 'thread/start');
    expect(start?.params).toMatchObject({
      cwd: join(repo.root, '.claude', 'skills'),
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
      config: { sandbox_workspace_write: { writable_roots: [library.folder] } },
    });
  });

  it('leaves out a library that is not there, or is the checkout’s own skills', async () => {
    const repo = fresh();
    const gone = await libraryAt();
    rmSync(gone.folder, { recursive: true });
    const { claude, startPageAgent } = fakeClaude(repo.root);
    await (await scribeService(repo, { claude, library: gone.service })).open({});
    expect(startPageAgent.mock.calls[0]?.[0]).not.toHaveProperty('addDirs');
    expect(startPageAgent.mock.calls[0]?.[0]?.instructions).not.toContain(gone.folder);

    const own = await libraryAt(join(repo.root, '.claude', 'skills'));
    const second = fresh();
    const other = fakeClaude(second.root);
    await (await scribeService(repo, { claude: other.claude, library: own.service })).open({});
    expect(other.startPageAgent.mock.calls[0]?.[0]).not.toHaveProperty('addDirs');
  });

  it("asked through its API, the person's words are its first prompt, after its instructions (V78)", async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    await (await scribeService(repo, { claude })).ask({ text: 'A skill for releases' });
    expect(startPageAgent.mock.calls[0]?.[0]).toMatchObject({
      prompt: 'A skill for releases',
      instructions: scribePrompt(DEFAULT_PROMPTS, {
        skills: join(repo.root, '.claude', 'skills'),
        checkout: repo.root,
      }),
    });
  });

  it('speaks of itself', async () => {
    const repo = fresh();
    await expect((await scribeService(repo)).open({})).rejects.toThrow(
      'Scribe needs Claude Code or Codex: neither is installed',
    );
    await expect((await scribeService(repo)).setEffort({ effort: 'low' })).rejects.toThrow(
      'Scribe needs Claude Code or Codex: neither is installed',
    );
  });

  it('starts at its own level, scribe.effort, saved in the config; null removes it (fix/scribe-effort-level)', async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    claude.efforts = () => Promise.resolve(['low', 'medium', 'high', 'xhigh', 'max']);
    const s = await scribeService(repo, { claude });
    const config = join(repo.root, 'symbiote', 'config.json');
    repo.write({ 'symbiote/config.json': '{ "nucleus": { "effort": "low" } }\n' });
    // Nucleus's is not Scribe's.
    expect(await s.efforts()).not.toHaveProperty('effort');
    expect(await s.setEffort({ effort: 'high' })).toMatchObject({ effort: 'high' });
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({
      nucleus: { effort: 'low' },
      scribe: { effort: 'high' },
    });
    expect(await (await service(repo, { claude })).efforts()).toMatchObject({ effort: 'low' });
    const state = await s.open({});
    expect(startPageAgent.mock.lastCall?.[0]).toMatchObject({ effort: 'high' });
    expect(JSON.parse(readFileSync(scribeRecord(repo), 'utf8'))).toMatchObject({ effort: 'high' });
    expect(state.conversation).toMatchObject({ kind: 'claude', effort: 'high' });
    // Null: the next conversation at the agent's own, and the file as it was.
    await s.renew();
    expect(await s.setEffort({ effort: null })).not.toHaveProperty('effort');
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({ nucleus: { effort: 'low' } });
    await s.open({});
    expect(startPageAgent.mock.lastCall?.[0]).not.toHaveProperty('effort');
  });
});

describe("Nucleus with Symbiote's tools (MC1, decisions 358, 365)", () => {
  const viewOf = async (repo: TestRepo) => viewFile(cache, (await openRepo(repo.root)).commonDir);
  const mcpFile = (repo: TestRepo) => join(repo.root, 'symbiote', 'nucleus-mcp.json');

  it("starts Claude Code with Symbiote's server and no other, its file written before each wake", async () => {
    const repo = fresh();
    const { claude, startPageAgent, set } = fakeClaude(repo.root);
    const { terminals } = fakeTerminals();
    const s = await service(repo, { claude, terminals });
    await s.ask({ text: 'What needs me?' });
    expect(startPageAgent.mock.calls[0]?.[0]).toMatchObject({
      ...READ_ONLY,
      mcpConfig: mcpFile(repo),
    });
    const expected = {
      mcpServers: {
        symbiote: {
          type: 'stdio',
          command: '/usr/bin/node',
          args: [BRIDGE, '--as', 'nucleus', '--view', await viewOf(repo)],
        },
      },
    };
    expect(JSON.parse(readFileSync(mcpFile(repo), 'utf8'))).toEqual(expected);
    // A session that wakes reads it again: a reply and a terminal write it first.
    rmSync(mcpFile(repo));
    set('s9', { state: 'done', status: 'idle' });
    await s.ask({ text: 'And now?' });
    expect(JSON.parse(readFileSync(mcpFile(repo), 'utf8'))).toEqual(expected);
    rmSync(mcpFile(repo));
    await s.terminal({ cols: 80, rows: 24 });
    expect(existsSync(mcpFile(repo))).toBe(true);
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  it("starts Codex's thread with Symbiote's server, approved, waiting long; each message and its terminal carry it", async () => {
    const repo = fresh();
    const server = await appServer();
    const { codex } = fakeCodex(server);
    const { terminals, opening } = fakeTerminals();
    const s = await service(repo, { codex, terminals });
    await s.ask({ text: 'What needs me?' });
    const config = {
      mcp_servers: {
        symbiote: {
          command: '/usr/bin/node',
          args: [BRIDGE, '--as', 'nucleus', '--view', await viewOf(repo)],
          default_tools_approval_mode: 'approve',
          tool_timeout_sec: 660,
        },
      },
      web_search: 'live',
      // The folders it reads (V80): Codex's program's and the checkout; no workspace here.
      ...readProfile([...codexFolders('/usr/bin/codex'), repo.root]),
    };
    expect(server.calls.find((c) => c.method === 'thread/start')?.params).toEqual({
      cwd: repo.root,
      approvalPolicy: 'never',
      developerInstructions: DEFAULT_PROMPTS.nucleus,
      config,
    });
    server.reply('thread-1', 'Nothing.');
    await s.ask({ text: 'And now?' });
    expect(server.calls.findLast((c) => c.method === 'thread/resume')?.params).toEqual({
      threadId: 'thread-1',
      excludeTurns: true,
      config,
    });
    server.reply('thread-1', 'Still nothing.');
    const resumes = server.calls.filter((c) => c.method === 'thread/resume').length;
    await s.terminal({ cols: 100, rows: 30 });
    // Loaded with the server before Codex's terminal joins the thread.
    const loads = server.calls.filter((c) => c.method === 'thread/resume');
    expect(loads).toHaveLength(resumes + 1);
    expect(loads.at(-1)?.params).toEqual({ threadId: 'thread-1', excludeTurns: true, config });
    expect(opening[0]?.args).toEqual([
      'resume',
      'thread-1',
      '--remote',
      server.address,
      '-C',
      repo.root,
    ]);
  });

  it('gives Scribe none of it', async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const s = scribe(await openRepo(repo.root), cache, {
      claude: () => Promise.resolve(claude),
      now: () => NOW,
      env: { PATH: '/usr/bin' },
      gate: GATE,
      bridge: BRIDGE,
      node: '/usr/bin/node',
    });
    await s.ask({ text: 'A skill for releases' });
    expect(startPageAgent.mock.calls[0]?.[0]).not.toHaveProperty('mcpConfig');
    expect(existsSync(join(repo.root, 'symbiote', 'scribe-mcp.json'))).toBe(false);
    const server = await appServer();
    const codexScribe = scribe(await openRepo(repo.root), cache, {
      claude: () => Promise.resolve(null),
      codex: () => Promise.resolve(fakeCodex(server).codex),
      now: () => NOW,
      bridge: BRIDGE,
    });
    await codexScribe.renew();
    await codexScribe.ask({ text: 'A skill' });
    expect(server.calls.find((c) => c.method === 'thread/start')?.params).not.toHaveProperty(
      'config.mcp_servers',
    );
  });
});

describe("Nucleus's old names (NU1, decisions 590, 591)", () => {
  const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const MODELS: AgentModel[] = [
    { id: 'opus', name: 'Opus 5.5', efforts: { levels: LEVELS } },
    { id: 'sonnet', name: 'Sonnet 5.5', efforts: { levels: LEVELS } },
  ];
  const STARTED = '2026-10-29T19:50:40.704Z';
  const scoutFiles = (repo: TestRepo) =>
    ['scout.json', 'scout-settings.json', 'scout-mcp.json'].map((f) =>
      join(repo.root, 'symbiote', f),
    );
  /** A Scout conversation as Symbiote wrote it before NU1: its record and its two files. */
  const scoutConversation = (repo: TestRepo, fields: Record<string, unknown>) =>
    repo.write({
      'symbiote/scout.json': `${JSON.stringify(
        {
          about:
            "Scout's conversation in this checkout (V35): a read-only agent started in Symbiote. Not a workspace.",
          ...fields,
          started: STARTED,
        },
        null,
        2,
      )}\n`,
      'symbiote/scout-settings.json': '{ "hooks": {} }\n',
      'symbiote/scout-mcp.json': '{ "mcpServers": {} }\n',
      'symbiote/.gitignore': '*\n',
    });

  it("reads a Scout conversation as Nucleus's, as it is, until New conversation removes it and its files", async () => {
    const repo = fresh();
    const { claude, listed, stop, remove, startPageAgent } = fakeClaude(repo.root);
    listed.push({
      cwd: repo.root,
      kind: 'background',
      startedAt: 5,
      id: 'old',
      sessionId: 'session-old',
      name: 'Scout',
      state: 'done',
      status: 'idle',
    });
    scoutConversation(repo, {
      agent: 'claude',
      id: 'old',
      sessionId: 'session-old',
      effort: 'xhigh',
      model: 'opus',
    });
    const { terminals, opening } = fakeTerminals();
    const s = await service(repo, { claude, terminals });
    expect((await s.state()).conversation).toEqual({
      kind: 'claude',
      started: STARTED,
      effort: 'xhigh',
      model: 'opus',
      state: 'answered',
      id: 'old',
      startedAs: 'Scout',
    });
    // Opened: the one there is, nothing started; its terminal attaches to it.
    expect((await s.open({})).conversation).toMatchObject({ id: 'old', startedAs: 'Scout' });
    expect(startPageAgent).not.toHaveBeenCalled();
    await s.terminal({ cols: 80, rows: 24 });
    expect(opening[0]?.args).toEqual(['attach', 'old']);
    expect(existsSync(record(repo))).toBe(false);
    // New conversation: Scout's session ended, its record and its files gone.
    expect((await s.renew()).conversation).toBeNull();
    expect(stop).toHaveBeenCalledWith('old');
    expect(remove).toHaveBeenCalledWith('old');
    for (const file of scoutFiles(repo)) expect(existsSync(file)).toBe(false);
    // The next is Nucleus's.
    expect((await s.open({})).conversation).toMatchObject({ id: 's9', state: 'ready' });
    expect((await s.state()).conversation).not.toHaveProperty('startedAs');
    expect(startPageAgent.mock.calls[0]?.[0]).toMatchObject({ name: 'Nucleus', ...READ_ONLY });
    expect(JSON.parse(readFileSync(record(repo), 'utf8'))).toMatchObject({ id: 's9' });
    expect(repo.git('status', '--porcelain')).toBe('');
  });

  it("opens Nucleus over a Scout session that is gone, and drops Scout's record and files", async () => {
    const repo = fresh();
    const { claude } = fakeClaude(repo.root);
    scoutConversation(repo, { agent: 'claude', id: 'old', sessionId: 'session-old' });
    const s = await service(repo, { claude });
    expect((await s.state()).conversation).toMatchObject({ state: 'gone', startedAs: 'Scout' });
    expect((await s.open({})).conversation).toMatchObject({ id: 's9', state: 'ready' });
    for (const file of scoutFiles(repo)) expect(existsSync(file)).toBe(false);
    expect(existsSync(record(repo))).toBe(true);
  });

  it("reads nucleus.json first: a Scout record beside it is not Nucleus's conversation", async () => {
    const repo = fresh();
    const { claude } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    await s.open({});
    scoutConversation(repo, { agent: 'claude', id: 'old', sessionId: 'session-old' });
    expect((await s.state()).conversation).toMatchObject({ id: 's9' });
    expect((await s.state()).conversation).not.toHaveProperty('startedAs');
  });

  it("reads a Codex Scout thread, gives it Nucleus's tools at its next message, archives it for a new one", async () => {
    const repo = fresh();
    const server = await appServer();
    const { codex } = fakeCodex(server);
    const s = await service(repo, { codex });
    await s.ask({ text: 'Where is it?' });
    // As a Scout thread recorded before NU1.
    const thread = JSON.parse(readFileSync(record(repo), 'utf8')) as Record<string, unknown>;
    rmSync(record(repo));
    scoutConversation(repo, { agent: 'codex', thread: thread['thread'] });
    expect((await s.state()).conversation).toMatchObject({ id: 'thread-1', startedAs: 'Scout' });
    server.reply('thread-1', 'Here.');
    await s.ask({ text: 'And the web?' });
    expect(server.calls.findLast((c) => c.method === 'thread/resume')?.params).toMatchObject({
      threadId: 'thread-1',
      config: { web_search: 'live' },
    });
    expect((await s.renew()).conversation).toBeNull();
    expect(server.thread('thread-1')).toMatchObject({ archived: true });
    for (const file of scoutFiles(repo)) expect(existsSync(file)).toBe(false);
  });

  it("starts on scout.model and scout.effort when Nucleus has none; a save writes Nucleus's and drops Scout's", async () => {
    const repo = fresh();
    const fake = fakeClaude(repo.root);
    fake.claude.efforts = () => Promise.resolve(LEVELS);
    fake.claude.models = () => Promise.resolve(structuredClone(MODELS));
    const config = join(repo.root, 'symbiote', 'config.json');
    const s = await service(repo, { claude: fake.claude });
    repo.write({
      'symbiote/config.json': '{ "scout": { "model": "sonnet", "effort": "medium" } }\n',
    });
    expect(await s.efforts()).toMatchObject({ effort: 'medium', model: 'sonnet' });
    expect((await s.open({})).conversation).toMatchObject({ model: 'sonnet', effort: 'medium' });
    await s.renew();
    // Nucleus's own comes first.
    repo.write({
      'symbiote/config.json':
        '{ "nucleus": { "effort": "high" }, "scout": { "model": "sonnet", "effort": "medium" } }\n',
    });
    expect((await s.open({})).conversation).toMatchObject({ model: 'sonnet', effort: 'high' });
    await s.setEffort({ effort: 'low' });
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({
      nucleus: { effort: 'low' },
      scout: { model: 'sonnet' },
    });
    await s.setModel({ model: 'opus' });
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({
      nucleus: { effort: 'low', model: 'opus' },
    });
  });

  it("takes prompts.scout as Nucleus's instructions while there is no prompts.nucleus", async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    repo.write({
      'symbiote/config.json': '{ "prompts": { "scout": "You are Scout. Be brief." } }\n',
    });
    await s.open({});
    expect(startPageAgent.mock.calls[0]?.[0].instructions).toBe('You are Scout. Be brief.');
    await s.renew();
    repo.write({
      'symbiote/config.json':
        '{ "prompts": { "nucleus": "Be brief.", "scout": "You are Scout. Be brief." } }\n',
    });
    await s.open({});
    expect(startPageAgent.mock.calls[1]?.[0].instructions).toBe('Be brief.');
  });
});

describe('Nucleus on the web (NU1, decisions 592–594)', () => {
  it('starts Claude Code with WebSearch and WebFetch, its gate given --web', async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    const s = await service(repo, { claude });
    await s.open({});
    expect(startPageAgent.mock.calls[0]?.[0].tools).toEqual([
      'Read',
      'Grep',
      'Glob',
      'Bash',
      'WebSearch',
      'WebFetch',
    ]);
    const folders = [repo.root, join(repo.root, 'symbiote', 'workspaces')];
    expect(readFileSync(join(repo.root, 'symbiote', 'nucleus-settings.json'), 'utf8')).toBe(
      pageAgentSettings({ node: '/usr/bin/node', gate: GATE, args: [...folders, '--web'] }),
    );
  });

  it('starts without them when nucleus.web is false: no web tool, a gate without --web', async () => {
    const repo = fresh();
    const { claude, startPageAgent } = fakeClaude(repo.root);
    repo.write({ 'symbiote/config.json': '{ "nucleus": { "web": false } }\n' });
    const s = await service(repo, { claude });
    await s.open({});
    expect(startPageAgent.mock.calls[0]?.[0].tools).toEqual(['Read', 'Grep', 'Glob', 'Bash']);
    expect(readFileSync(join(repo.root, 'symbiote', 'nucleus-settings.json'), 'utf8')).toBe(
      pageAgentSettings({
        node: '/usr/bin/node',
        gate: GATE,
        args: [repo.root, join(repo.root, 'symbiote', 'workspaces')],
      }),
    );
  });

  it("gives Codex's thread live web search at its start, each message and its terminal; disabled when off", async () => {
    const repo = fresh();
    const server = await appServer();
    const { codex } = fakeCodex(server);
    const { terminals } = fakeTerminals();
    const s = await service(repo, { codex, terminals });
    await s.ask({ text: 'What is new in Vite?' });
    const start = server.calls.find((c) => c.method === 'thread/start')?.params;
    // The thread stays read-only, its network off: the search runs at OpenAI.
    expect(start).toMatchObject({ config: { web_search: 'live' } });
    expect(server.thread('thread-1')).toMatchObject({ sandbox: 'read-only' });
    server.reply('thread-1', 'Vite 8.');
    await s.ask({ text: 'And 9?' });
    await s.terminal({ cols: 80, rows: 24 });
    for (const resume of server.calls.filter((c) => c.method === 'thread/resume')) {
      expect(resume.params).toMatchObject({ config: { web_search: 'live' } });
    }
    await s.renew();
    repo.write({ 'symbiote/config.json': '{ "nucleus": { "web": false } }\n' });
    await s.ask({ text: 'Offline?' });
    expect(server.calls.findLast((c) => c.method === 'thread/start')?.params).toMatchObject({
      config: { web_search: 'disabled' },
    });
  });
});
