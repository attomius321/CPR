import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UsageSubscription } from '@cpr/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { codexServer } from '../src/app-server.js';
import type { Codex } from '../src/codex.js';
import {
  CLAUDE_USAGE_URL,
  readClaudeUsage,
  readCodexUsage,
  usageService,
  type UsageRead,
} from '../src/usage.js';
import { fakeAppServer, type FakeAppServer } from './fake-app-server.js';

// Subscription usage (V29c): Claude Code's from the endpoint its /usage reads, with the token it
// stored, read only (decision 172); Codex's from its app server; a 5-min copy in `cpr view`.
const NOW = Date.parse('2026-10-20T16:15:00Z');
const MIN = 60_000;
const HOUR = 3_600_000;

let home: string;
const servers: FakeAppServer[] = [];
beforeEach(() => {
  home = tempDir();
});
afterEach(async () => {
  rmSync(home, { recursive: true, force: true });
  for (const server of servers.splice(0)) await server.close();
});

/** Claude Code's answer as measured (V29 decisions): 59 % of the session, 66 % of the week. */
const CLAUDE_ANSWER = {
  five_hour: { utilization: 59, resets_at: '2026-10-20T20:00:00.484682+00:00' },
  seven_day: { utilization: 66, resets_at: '2026-10-25T22:00:00.484701+00:00' },
  // A code name: CPR cannot say what it limits, and shows nothing of it.
  iguana_necktie: { utilization: 100, resets_at: '2026-11-05T07:59:00+00:00' },
  limits: [
    {
      kind: 'session',
      group: 'session',
      percent: 59,
      severity: 'normal',
      resets_at: '2026-10-20T20:00:00.484682+00:00',
      scope: null,
      is_active: false,
    },
    {
      kind: 'weekly_all',
      group: 'weekly',
      percent: 66,
      severity: 'normal',
      resets_at: '2026-10-25T22:00:00.484701+00:00',
      scope: null,
      is_active: true,
    },
  ],
};

/** Claude Code's files in `home`: its token (valid `expiresIn` ms more) and its config. */
function claudeFiles({
  expiresIn = HOUR,
  cached,
  organizationType = 'claude_pro',
  accountUuid = 'account-a',
  dir = join(home, '.claude'),
  config = join(home, '.claude.json'),
}: {
  expiresIn?: number | null;
  cached?: { fetchedAtMs: number; utilization: unknown };
  organizationType?: string;
  accountUuid?: string;
  dir?: string;
  config?: string;
} = {}) {
  mkdirSync(dir, { recursive: true });
  const credentials = join(dir, '.credentials.json');
  if (expiresIn !== null) {
    writeFileSync(
      credentials,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'stored-access-token',
          refreshToken: 'stored-refresh-token',
          expiresAt: NOW + expiresIn,
          scopes: ['user:inference'],
          subscriptionType: 'pro',
        },
      }),
    );
  }
  writeFileSync(
    config,
    JSON.stringify({
      oauthAccount: { organizationType, accountUuid, emailAddress: 'person@example.com' },
      ...(cached ? { cachedUsageUtilization: { accountUuid: 'a', ...cached } } : {}),
    }),
  );
  return { credentials };
}

interface Asked {
  url: string;
  headers: Record<string, string>;
  method: string;
}

/** A fake `fetch`: what it was asked, and `answer` for each request. */
function fakeFetch(answer: () => Response | Promise<Response>) {
  const asked: Asked[] = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    asked.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      method: init?.method ?? 'GET',
    });
    return answer();
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Where CPR keeps its last read of Claude's usage: the test's cache. */
const lastFile = () => join(home, 'cpr-cache', 'usage', 'claude.json');

const claude = (fetch: typeof globalThis.fetch, env: Record<string, string> = {}, now = NOW) =>
  readClaudeUsage({
    installed: () => Promise.resolve(true),
    env,
    home,
    platform: 'linux',
    fetch,
    lastFile: lastFile(),
    now: () => now,
  });

/** Claude Code's copy from the last time its /usage was opened: CPR never shows it. */
const CLAUDE_CODE_COPY = {
  fetchedAtMs: NOW - HOUR,
  utilization: { five_hour: { utilization: 40, resets_at: '2026-10-20T18:00:00Z' } },
};

describe('readClaudeUsage', () => {
  it('reads the live windows from the endpoint /usage reads, with the stored token', async () => {
    claudeFiles();
    const server = fakeFetch(() => json(CLAUDE_ANSWER));
    const read = await claude(server.fetch);
    expect(read).toEqual({
      subscription: {
        agent: 'claude',
        plan: 'Pro',
        windows: [
          { minutes: 300, usedPercent: 59, resetsAt: '2026-10-20T20:00:00.484Z' },
          { minutes: 10_080, usedPercent: 66, resetsAt: '2026-10-25T22:00:00.484Z' },
        ],
        at: new Date(NOW).toISOString(),
        source: 'live',
      },
    });
    expect(server.asked).toEqual([
      {
        url: CLAUDE_USAGE_URL,
        method: 'GET',
        headers: {
          authorization: 'Bearer stored-access-token',
          'anthropic-beta': 'oauth-2025-04-20',
        },
      },
    ]);
    expect(CLAUDE_USAGE_URL).toBe('https://api.anthropic.com/api/oauth/usage');
    // The token stays in CPR's server: nothing of it in what the page is given.
    expect(JSON.stringify(read)).not.toMatch(/stored-(access|refresh)-token|person@example/);
  });

  it('takes the 5-hour and weekly windows when the answer has no limits list', async () => {
    claudeFiles({ organizationType: 'claude_max' });
    const older = { five_hour: CLAUDE_ANSWER.five_hour, seven_day: CLAUDE_ANSWER.seven_day };
    const read = await claude(fakeFetch(() => json(older)).fetch);
    expect(read.subscription?.plan).toBe('Max');
    expect(read.subscription?.windows.map((w) => [w.minutes, w.usedPercent])).toEqual([
      [300, 59],
      [10_080, 66],
    ]);
  });

  it('keeps Claude\'s own warning on a window: 79 % read "warning" in real use', async () => {
    claudeFiles();
    const answer = {
      limits: [{ ...CLAUDE_ANSWER.limits[0], percent: 79, severity: 'warning' }],
    };
    const read = await claude(fakeFetch(() => json(answer)).fetch);
    expect(read.subscription?.windows).toEqual([
      { minutes: 300, usedPercent: 79, resetsAt: '2026-10-20T20:00:00.484Z', warning: true },
    ]);
  });

  it("keeps a model's own weekly limit apart, and leaves out what it cannot read", async () => {
    claudeFiles();
    const answer = {
      limits: [
        ...CLAUDE_ANSWER.limits,
        {
          kind: 'weekly_opus',
          group: 'weekly',
          percent: 12,
          resets_at: '2026-10-25T22:00:00Z',
          scope: 'opus',
        },
        { kind: 'monthly_spend', group: 'spend', percent: 3, resets_at: '2026-11-01T00:00:00Z' },
        { kind: 'session', group: 'session', percent: 'lots' },
      ],
    };
    const read = await claude(fakeFetch(() => json(answer)).fetch);
    expect(read.subscription?.windows).toEqual([
      { minutes: 300, usedPercent: 59, resetsAt: '2026-10-20T20:00:00.484Z' },
      { minutes: 10_080, usedPercent: 66, resetsAt: '2026-10-25T22:00:00.484Z' },
      { minutes: 10_080, usedPercent: 12, resetsAt: '2026-10-25T22:00:00.000Z', scope: 'opus' },
    ]);
  });

  it("never refreshes an expired token: no request, CPR's last read, its age, why", async () => {
    claudeFiles({ cached: CLAUDE_CODE_COPY });
    const live = await claude(fakeFetch(() => json(CLAUDE_ANSWER)).fetch);
    const { credentials } = claudeFiles({ expiresIn: -HOUR, cached: CLAUDE_CODE_COPY });
    const before = readFileSync(credentials, 'utf8');
    const server = fakeFetch(() => json(CLAUDE_ANSWER));
    // 4 h later: the 5-hour window reset at 20:00, and its 59 % says nothing now.
    const read = await claude(server.fetch, {}, NOW + 4 * HOUR);
    expect(server.asked).toEqual([]);
    expect(readFileSync(credentials, 'utf8')).toBe(before);
    const note = "Claude Code's token has expired (CPR never renews it)";
    expect(read).toEqual({
      subscription: { ...live.subscription, windows: [live.subscription?.windows[1]], note },
      failed: note,
    });
  });

  it("gives CPR's last read when a request fails, never Claude Code's copy; a 429 backs off", async () => {
    claudeFiles({ cached: CLAUDE_CODE_COPY });
    // Before any read of CPR's: nothing to show, and why.
    const first = await claude(fakeFetch(() => json({}, 429)).fetch);
    expect(first).toEqual({
      subscription: null,
      failed: "Claude's usage asked to wait (429)",
      backoff: true,
    });
    const live = await claude(fakeFetch(() => json(CLAUDE_ANSWER)).fetch);
    expect(live.subscription?.source).toBe('live');
    const failed = await claude(fakeFetch(() => json({ error: 'x' }, 500)).fetch);
    expect(failed).toEqual({
      subscription: { ...live.subscription, note: "Claude's usage answered 500" },
      failed: "Claude's usage answered 500",
    });
    const limited = await claude(fakeFetch(() => json({}, 429)).fetch);
    expect(limited.backoff).toBe(true);
    expect(limited.subscription).toMatchObject({ at: live.subscription?.at, source: 'live' });
    const offline = await claude(
      fakeFetch(() => Promise.reject(new TypeError('fetch failed'))).fetch,
    );
    expect(offline.subscription?.note).toBe("Claude's usage did not answer: fetch failed");
  });

  it('keeps its last read in its cache, for the account it was read for', async () => {
    claudeFiles();
    const live = await claude(fakeFetch(() => json(CLAUDE_ANSWER)).fetch);
    // Another cpr view, or the next run: the file is what they share.
    expect(JSON.parse(readFileSync(lastFile(), 'utf8'))).toEqual({
      account: 'account-a',
      subscription: live.subscription,
    });
    expect(readFileSync(lastFile(), 'utf8')).not.toMatch(/stored-(access|refresh)-token/);
    claudeFiles({ accountUuid: 'account-b' });
    const other = await claude(fakeFetch(() => json({}, 500)).fetch);
    expect(other).toEqual({ subscription: null, failed: "Claude's usage answered 500" });
  });

  it('lists nothing when Claude Code is not installed or not signed in to a subscription', async () => {
    const server = fakeFetch(() => json(CLAUDE_ANSWER));
    // No token, no read of CPR's: an API key, or never signed in.
    expect((await claude(server.fetch)).subscription).toBeNull();
    claudeFiles();
    const missing = await readClaudeUsage({
      installed: () => Promise.resolve(false),
      env: {},
      home,
      platform: 'linux',
      fetch: server.fetch,
      now: () => NOW,
    });
    expect(missing).toEqual({ subscription: null });
    expect(server.asked).toEqual([]);
  });

  it("reads Claude Code's folder from CLAUDE_CONFIG_DIR, as Claude Code does", async () => {
    const dir = join(home, 'elsewhere');
    claudeFiles({ dir, config: join(dir, '.claude.json') });
    const read = await claude(fakeFetch(() => json(CLAUDE_ANSWER)).fetch, {
      CLAUDE_CONFIG_DIR: dir,
    });
    expect(read.subscription?.source).toBe('live');
  });

  it('sends the token to api.anthropic.com only: another URL is taken for this machine alone', async () => {
    claudeFiles();
    const server = fakeFetch(() => json(CLAUDE_ANSWER));
    await claude(server.fetch, { CPR_CLAUDE_USAGE_URL: 'https://example.com/usage' });
    await claude(server.fetch, { CPR_CLAUDE_USAGE_URL: 'http://127.0.0.1:4100/api/oauth/usage' });
    expect(server.asked.map((a) => a.url)).toEqual([
      CLAUDE_USAGE_URL,
      'http://127.0.0.1:4100/api/oauth/usage',
    ]);
  });
});

/** A Codex whose app server is `server` (none: null), signed in as `account`. */
function fakeCodex(server: FakeAppServer | null, account = 'your ChatGPT account'): Codex {
  return {
    command: 'codex',
    server: () => Promise.resolve(server ? codexServer(server.address) : null),
    account: () => Promise.resolve(account),
  } as Partial<Codex> as Codex;
}

const codexUsage = (agent: Codex | null, env: Record<string, string> = {}) =>
  readCodexUsage({ codex: () => Promise.resolve(agent), env, home, now: () => NOW });

const socket = () => join(home, `s${servers.length}.sock`);

describe('readCodexUsage', () => {
  it("reads a Go plan's one 30-day window from Codex's app server", async () => {
    const server = await fakeAppServer(socket());
    servers.push(server);
    const read = await codexUsage(fakeCodex(server));
    expect(read).toEqual({
      subscription: {
        agent: 'codex',
        plan: 'Go',
        windows: [{ minutes: 43_200, usedPercent: 0, resetsAt: '2026-11-19T00:00:00.000Z' }],
        at: new Date(NOW).toISOString(),
        source: 'live',
      },
    });
  });

  it('reads both windows of a plan that has two, and says when a limit is reached', async () => {
    const server = await fakeAppServer(socket());
    servers.push(server);
    server.rateLimits = {
      primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: NOW / 1000 + 3_600 },
      secondary: { usedPercent: 41, windowDurationMins: 10_080, resetsAt: NOW / 1000 + 86_400 },
      planType: 'plus',
      rateLimitReachedType: 'primary',
    };
    server.account = { type: 'chatgpt', planType: 'plus' };
    const read = await codexUsage(fakeCodex(server));
    expect(read.subscription).toMatchObject({
      plan: 'Plus',
      windows: [
        { minutes: 300, usedPercent: 100 },
        { minutes: 10_080, usedPercent: 41 },
      ],
      limited: true,
    });
  });

  it('lists nothing for an API-key login, or without Codex', async () => {
    const server = await fakeAppServer(socket());
    servers.push(server);
    server.account = { type: 'apiKey' };
    expect(await codexUsage(fakeCodex(server))).toEqual({ subscription: null });
    expect(await codexUsage(null)).toEqual({ subscription: null });
  });

  it("without its app server: the newest session's windows, as a copy with its time", async () => {
    const day = join(home, '.codex', 'sessions', '2026', '10', '18');
    mkdirSync(day, { recursive: true });
    const line = (timestamp: string, used: number) =>
      JSON.stringify({
        timestamp,
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: {
            primary: { used_percent: used, window_minutes: 43_200, resets_at: 1_794_926_092 },
            secondary: null,
            plan_type: 'go',
            rate_limit_reached_type: null,
          },
        },
      });
    writeFileSync(
      join(day, 'rollout-2026-10-18T10-00-00-a.jsonl'),
      `${line('2026-10-18T10:00:05.000Z', 1)}\n`,
    );
    writeFileSync(
      join(day, 'rollout-2026-10-18T17-34-49-b.jsonl'),
      `{"type":"session_meta"}\n${line('2026-10-18T14:34:53.549Z', 2)}\n${line('2026-10-18T14:40:00.000Z', 3)}\n`,
    );
    const read = await codexUsage(fakeCodex(null));
    expect(read.subscription).toEqual({
      agent: 'codex',
      plan: 'Go',
      windows: [{ minutes: 43_200, usedPercent: 3, resetsAt: '2026-11-17T14:34:52.000Z' }],
      at: '2026-10-18T14:40:00.000Z',
      source: 'cached',
      note: "Codex's app server did not answer: the numbers of its last session",
    });
    // Signed in with an API key: none.
    expect(await codexUsage(fakeCodex(null, 'an API key'))).toEqual({ subscription: null });
  });
});

describe('usageService', () => {
  const sub = (agent: 'claude' | 'codex', usedPercent: number): UsageSubscription => ({
    agent,
    windows: [{ minutes: 300, usedPercent }],
    at: new Date(NOW).toISOString(),
    source: 'live',
  });

  /** A reader whose answers the test gives, one per read, and how often it was read. */
  function reader(...answers: (UsageRead | Error)[]) {
    let reads = 0;
    const read = () => {
      const answer = answers[Math.min(reads, answers.length - 1)];
      reads += 1;
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer as UsageRead);
    };
    return { read, reads: () => reads };
  }

  it('answers from its copy, read again in the background once older than 5 min, one read at a time', async () => {
    let now = NOW;
    const claude = reader({ subscription: sub('claude', 10) }, { subscription: sub('claude', 20) });
    const codex = reader({ subscription: sub('codex', 1) });
    const usage = usageService({ claude: claude.read, codex: codex.read }, { now: () => now });
    expect((await usage.report()).subscriptions.map((s) => s.windows[0]?.usedPercent)).toEqual([
      10, 1,
    ]);
    // Read every minute, two cpr views were refused by Claude's endpoint for 5 of 6 minutes.
    now += 4 * MIN;
    await usage.report();
    expect(claude.reads()).toBe(1);
    now += MIN + 1_000;
    // Older than 5 min: the copy now, the new numbers on the next ask.
    const [first, second] = await Promise.all([usage.report(), usage.report()]);
    expect(first.subscriptions[0]?.windows[0]?.usedPercent).toBe(10);
    expect(second.subscriptions[0]?.windows[0]?.usedPercent).toBe(10);
    await usage.settled();
    expect(claude.reads()).toBe(2);
    expect((await usage.report()).subscriptions[0]?.windows[0]?.usedPercent).toBe(20);
  });

  it('backs off for 5 minutes after a 429, and keeps the last numbers through an error', async () => {
    let now = NOW;
    const claude = reader(
      { subscription: sub('claude', 10) },
      { subscription: sub('claude', 11), backoff: true },
      { subscription: sub('claude', 30) },
    );
    const codex = reader({ subscription: sub('codex', 1) }, new Error('socket closed'));
    // Read every minute: the backoff is what waits.
    const usage = usageService(
      { claude: claude.read, codex: codex.read },
      { now: () => now, maxAgeMs: MIN },
    );
    await usage.report();
    now += 61_000;
    await usage.report();
    await usage.settled();
    // The copy given with the 429, and Codex's last numbers.
    expect((await usage.report()).subscriptions.map((s) => s.windows[0]?.usedPercent)).toEqual([
      11, 1,
    ]);
    now += 120_000;
    await usage.report();
    await usage.settled();
    expect(claude.reads()).toBe(2);
    now += 300_000;
    await usage.report();
    await usage.settled();
    expect(claude.reads()).toBe(3);
  });

  /** Claude's live numbers read at `at`: the session's window resets at `fiveHourResets`. */
  const live = (usedPercent: number, at: number, fiveHourResets = NOW + 2 * HOUR) =>
    ({
      agent: 'claude',
      windows: [
        { minutes: 300, usedPercent, resetsAt: new Date(fiveHourResets).toISOString() },
        { minutes: 10_080, usedPercent: 18, resetsAt: '2026-10-25T21:59:59.000Z' },
      ],
      at: new Date(at).toISOString(),
      source: 'live',
    }) satisfies UsageSubscription;
  /** Claude Code's copy as a failed read gives it: the day before, its 5-hour window long reset. */
  const copy = (note: string, at = NOW - 10 * HOUR): UsageSubscription => ({
    agent: 'claude',
    windows: [{ minutes: 10_080, usedPercent: 22, resetsAt: '2026-10-25T21:59:59.000Z' }],
    at: new Date(at).toISOString(),
    source: 'cached',
    note,
  });

  it('keeps its last numbers over an older copy given with a 429 or a failure, and says why', async () => {
    // Real use: a 429 gave Claude Code's copy of the day before, and the bar lost its 5h for the
    // 5 minutes of the backoff.
    let now = NOW;
    const claude = reader(
      { subscription: live(30, NOW) },
      { subscription: copy("Claude's usage asked to wait (429)"), backoff: true },
      { subscription: copy("Claude's usage answered 500") },
      { subscription: live(35, NOW + 16 * MIN) },
    );
    const codex = reader({ subscription: null });
    const usage = usageService({ claude: claude.read, codex: codex.read }, { now: () => now });
    const shown = async () => {
      await usage.report();
      await usage.settled();
      return (await usage.report()).subscriptions;
    };
    await usage.report();
    now += 5 * MIN + 1_000;
    expect(await shown()).toEqual([
      { ...live(30, NOW), note: "Claude's usage asked to wait (429)" },
    ]);
    now += 5 * MIN;
    expect(await shown()).toEqual([{ ...live(30, NOW), note: "Claude's usage answered 500" }]);
    now += 5 * MIN;
    expect(await shown()).toEqual([live(35, NOW + 16 * MIN)]);
    expect(claude.reads()).toBe(4);
  });

  it('takes a copy newer than its numbers, and leaves out a window that reset since they were read', async () => {
    let now = NOW;
    const claude = reader(
      { subscription: live(30, NOW, NOW + 4 * MIN) },
      { subscription: copy("Claude's usage answered 500") },
      // /usage opened in Claude Code since: its copy is the newest.
      { subscription: copy("Claude's usage answered 500", NOW + 8 * MIN) },
    );
    const codex = reader({ subscription: null });
    const usage = usageService({ claude: claude.read, codex: codex.read }, { now: () => now });
    await usage.report();
    now += 5 * MIN + 1_000;
    await usage.report();
    await usage.settled();
    // The session's window reset a minute ago: its 30 % says nothing now.
    expect((await usage.report()).subscriptions).toEqual([
      {
        ...live(30, NOW),
        windows: [live(30, NOW).windows[1]],
        note: "Claude's usage answered 500",
      },
    ]);
    now += 5 * MIN;
    await usage.report();
    await usage.settled();
    expect((await usage.report()).subscriptions).toEqual([
      copy("Claude's usage answered 500", NOW + 8 * MIN),
    ]);
  });

  it('keeps its last numbers through a failed read that gives none, with why', async () => {
    let now = NOW;
    const claude = reader(
      { subscription: live(30, NOW) },
      { subscription: null, failed: "Claude's usage answered 500" },
    );
    const codex = reader({ subscription: null });
    const usage = usageService({ claude: claude.read, codex: codex.read }, { now: () => now });
    await usage.report();
    now += 5 * MIN + 1_000;
    await usage.report();
    await usage.settled();
    expect((await usage.report()).subscriptions).toEqual([
      { ...live(30, NOW), note: "Claude's usage answered 500" },
    ]);
  });

  it('reads nothing with CPR_USAGE=off', async () => {
    const claude = reader({ subscription: sub('claude', 10) });
    const usage = usageService({ claude: claude.read, codex: claude.read }, { off: true });
    expect(await usage.report()).toEqual({ subscriptions: [], off: true });
    expect(claude.reads()).toBe(0);
  });
});
