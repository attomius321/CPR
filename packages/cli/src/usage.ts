// Subscription usage (V29c): each window of use the vendors report for the agents Symbiote starts.
// Claude Code's from the endpoint its `/usage` reads, with the token Claude Code stored, read
// only (decision 172), else Symbiote's own last read; Codex's from its app server, else its newest
// session. Both sources are undocumented or `[experimental]`: every field is checked as it is
// read, and what Symbiote cannot read is left out, never guessed. `symbiote view` keeps a copy for 5 min
// (`usageService`).
import { mkdir, open, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { UsageReport, UsageSubscription, UsageWindow } from '@symbiote/core';
import type { Codex } from './codex.js';
import { runProgram, type Run } from './workspaces.js';

type Env = Readonly<Record<string, string | undefined>>;

/** What a read gave: a subscription (none: nothing to show), and whether to wait 5 min. */
export interface UsageRead {
  subscription: UsageSubscription | null;
  /** The read failed, and why: the last numbers are kept, with it. */
  failed?: string;
  /** The vendor answered 429: the next read waits `backoffMs`. */
  backoff?: true;
}

/** Where Claude Code's `/usage` reads the account's windows. */
export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const SESSION_MINUTES = 300;
const WEEK_MINUTES = 10_080;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const percentOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const isoOf = (value: unknown): string | undefined => {
  const time =
    typeof value === 'string'
      ? Date.parse(value)
      : typeof value === 'number' && Number.isFinite(value)
        ? value * 1000
        : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};

/** A plan's name from the vendor's code for it: `claude_pro` → Pro, `go` → Go. */
function planName(code: unknown): string | undefined {
  if (typeof code !== 'string') return undefined;
  const words = code
    .replace(/^claude_/, '')
    .replace(/_/g, ' ')
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : undefined;
}

/** The windows that have not reset by `now`: a reset window's number says nothing now. */
const notReset = (windows: UsageWindow[], now: number): UsageWindow[] =>
  windows.filter((w) => !w.resetsAt || Date.parse(w.resetsAt) > now);

/** A file's JSON, or null when it is missing or not JSON. */
async function jsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * The windows of an answer of Claude's usage endpoint: its `limits` list — the session (5 hours) and the weeks, a model's own week with its `scope` — else
 * `five_hour` and `seven_day`. Code-named keys (one at 100 % in the spike) are not read.
 */
export function claudeWindows(answer: unknown): UsageWindow[] {
  if (!isObject(answer)) return [];
  const windows: UsageWindow[] = [];
  const add = (
    minutes: number,
    percent: unknown,
    resets: unknown,
    scope?: string,
    warning = false,
  ) => {
    const usedPercent = percentOf(percent);
    if (usedPercent === undefined) return;
    const resetsAt = isoOf(resets);
    windows.push({
      minutes,
      usedPercent,
      ...(resetsAt ? { resetsAt } : {}),
      ...(scope ? { scope } : {}),
      ...(warning ? { warning: true as const } : {}),
    });
  };
  if (Array.isArray(answer.limits)) {
    for (const limit of answer.limits) {
      if (!isObject(limit) || typeof limit.kind !== 'string') continue;
      const minutes =
        limit.kind === 'session' || limit.group === 'session'
          ? SESSION_MINUTES
          : limit.kind.startsWith('weekly') || limit.group === 'weekly'
            ? WEEK_MINUTES
            : undefined;
      if (minutes === undefined) continue;
      const scope =
        typeof limit.scope === 'string' && limit.scope !== ''
          ? limit.scope
          : limit.kind !== 'session' && limit.kind !== 'weekly_all'
            ? limit.kind.replace(/^weekly_/, '')
            : undefined;
      // Its own word for a window near the limit; other words are not read.
      add(minutes, limit.percent, limit.resets_at, scope, limit.severity === 'warning');
    }
    return windows;
  }
  for (const [key, minutes] of [
    ['five_hour', SESSION_MINUTES],
    ['seven_day', WEEK_MINUTES],
  ] as const) {
    const window = answer[key];
    if (isObject(window)) add(minutes, window.utilization, window.resets_at);
  }
  return windows;
}

/** The token Claude Code stored: its file, or on macOS its Keychain entry. */
async function claudeToken(
  dir: string,
  platform: NodeJS.Platform,
  run: Run,
): Promise<{ accessToken: string; expiresAt: number } | null> {
  let stored: unknown = await jsonFile(join(dir, '.credentials.json'));
  if (!stored && platform === 'darwin') {
    try {
      const found = await run(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { cwd: dir, timeoutMs: 10_000 },
      );
      stored = found.code === 0 ? (JSON.parse(found.stdout) as unknown) : null;
    } catch {
      stored = null;
    }
  }
  const oauth = isObject(stored) ? stored.claudeAiOauth : null;
  if (!isObject(oauth) || typeof oauth.accessToken !== 'string' || oauth.accessToken === '') {
    return null;
  }
  const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : 0;
  return { accessToken: oauth.accessToken, expiresAt };
}

/** The usage URL: Claude's, or one on this machine (`SYMBIOTE_CLAUDE_USAGE_URL`, for tests). */
function claudeUsageUrl(env: Env): string {
  const custom = env.SYMBIOTE_CLAUDE_USAGE_URL?.trim();
  if (!custom) return CLAUDE_USAGE_URL;
  try {
    const url = new URL(custom);
    // The token goes to Anthropic only: another host is this machine's, never a third party's.
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      ? custom
      : CLAUDE_USAGE_URL;
  } catch {
    return CLAUDE_USAGE_URL;
  }
}

/** Symbiote's last read of Claude's usage, in `file`, if it was read for `account`; else null. */
async function lastRead(file: string, account: string | null): Promise<UsageSubscription | null> {
  const kept = await jsonFile(file);
  if (!isObject(kept) || kept.account !== account || !isObject(kept.subscription)) return null;
  const { subscription } = kept;
  return subscription.agent === 'claude' &&
    Array.isArray(subscription.windows) &&
    typeof subscription.at === 'string'
    ? (subscription as unknown as UsageSubscription)
    : null;
}

/** Keeps a live read in `file` for the next run and other `symbiote view`s; a failure loses nothing. */
async function keepRead(file: string, account: string | null, subscription: UsageSubscription) {
  const next = `${file}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(next, JSON.stringify({ account, subscription }));
    // Renamed into place: a reader never sees half a file.
    await rename(next, file);
  } catch {
    // Kept in memory still (`usageService`).
  }
}

/**
 * Claude Code's subscription (decision 172): `GET` Claude's usage endpoint with the access token
 * Claude Code stored, which Symbiote never refreshes and never sends elsewhere. Each live read is kept
 * in `lastFile` (Symbiote's cache) for its account; an expired or missing token, or a failed request,
 * gives that last read, without the windows that have reset since, and why — never the copy
 * Claude Code keeps of its /usage (the person's choice: it was a day old). Nothing when Claude
 * Code is not installed, or before Symbiote's first read.
 */
export async function readClaudeUsage({
  installed,
  env,
  home,
  platform = process.platform,
  fetch = globalThis.fetch,
  run = runProgram,
  lastFile,
  now = Date.now,
}: {
  installed: () => Promise<boolean>;
  env: Env;
  home: string;
  platform?: NodeJS.Platform;
  fetch?: typeof globalThis.fetch;
  run?: Run;
  /** Where Symbiote keeps its last read: none, nothing kept. */
  lastFile?: string;
  now?: () => number;
}): Promise<UsageRead> {
  if (!(await installed())) return { subscription: null };
  // Claude Code keeps its files in CLAUDE_CONFIG_DIR when set, its config beside them.
  const custom = env.CLAUDE_CONFIG_DIR?.trim();
  const dir = custom || join(home, '.claude');
  const config = await jsonFile(custom ? join(dir, '.claude.json') : join(home, '.claude.json'));
  const account = isObject(config) && isObject(config.oauthAccount) ? config.oauthAccount : {};
  const accountId = typeof account.accountUuid === 'string' ? account.accountUuid : null;
  const plan = planName(account.organizationType);

  /** A read that failed: Symbiote's last for this account, without reset windows, and why. */
  const failed = async (note: string, backoff = false): Promise<UsageRead> => {
    const last = lastFile ? await lastRead(lastFile, accountId) : null;
    return {
      subscription: last ? { ...last, windows: notReset(last.windows, now()), note } : null,
      failed: note,
      ...(backoff ? { backoff: true as const } : {}),
    };
  };

  const token = await claudeToken(dir, platform, run);
  if (!token) return failed("Claude Code's token could not be read");
  if (token.expiresAt <= now()) {
    return failed("Claude Code's token has expired (Symbiote never renews it)");
  }
  let response: Response;
  try {
    response = await fetch(claudeUsageUrl(env), {
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return failed(`Claude's usage did not answer: ${(error as Error).message}`);
  }
  if (response.status === 429) return failed("Claude's usage asked to wait (429)", true);
  if (!response.ok) return failed(`Claude's usage answered ${response.status}`);
  const windows = claudeWindows(await response.json().catch(() => null));
  if (windows.length === 0)
    return failed("Claude's usage answered without a window Symbiote reads");
  const subscription: UsageSubscription = {
    agent: 'claude',
    ...(plan ? { plan } : {}),
    windows,
    at: new Date(now()).toISOString(),
    source: 'live',
  };
  if (lastFile) await keepRead(lastFile, accountId, subscription);
  return { subscription };
}

/** The windows Codex reports, in its app server's names or its sessions' (`used_percent`). */
export function codexWindows(limits: unknown): { windows: UsageWindow[]; limited: boolean } {
  if (!isObject(limits)) return { windows: [], limited: false };
  const windows: UsageWindow[] = [];
  for (const key of ['primary', 'secondary']) {
    const window = limits[key];
    if (!isObject(window)) continue;
    const usedPercent = percentOf(window.usedPercent ?? window.used_percent);
    const minutes = window.windowDurationMins ?? window.window_minutes;
    if (usedPercent === undefined || typeof minutes !== 'number' || !(minutes > 0)) continue;
    const resetsAt = isoOf(window.resetsAt ?? window.resets_at);
    windows.push({ minutes, usedPercent, ...(resetsAt ? { resetsAt } : {}) });
  }
  const reached = limits.rateLimitReachedType ?? limits.rate_limit_reached_type;
  return { windows, limited: typeof reached === 'string' && reached !== '' };
}

/** A file's last `bytes`: a session runs to megabytes, and its newest numbers are last. */
async function tail(path: string, bytes: number): Promise<string> {
  const file = await open(path);
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await file.read(buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    await file.close();
  }
}

/** The newest `rate_limits` in Codex's sessions (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*`). */
async function newestSessionLimits(
  root: string,
): Promise<{ limits: Record<string, unknown>; at: string } | null> {
  const newestFirst = async (dir: string) => {
    try {
      return (await readdir(dir)).sort().reverse();
    } catch {
      return [];
    }
  };
  let looked = 0;
  for (const year of await newestFirst(root)) {
    for (const month of await newestFirst(join(root, year))) {
      for (const day of await newestFirst(join(root, year, month))) {
        const folder = join(root, year, month, day);
        for (const file of await newestFirst(folder)) {
          if (!/^rollout-.*\.jsonl$/.test(file) || ++looked > 10) continue;
          const text = await tail(join(folder, file), 262_144);
          const lines = text.split('\n').filter((line) => line.includes('"rate_limits"'));
          for (const line of lines.reverse()) {
            try {
              const event = JSON.parse(line) as { timestamp?: unknown; payload?: unknown };
              const limits = isObject(event.payload) ? event.payload.rate_limits : null;
              const at = isoOf(event.timestamp);
              if (isObject(limits) && at) return { limits, at };
            } catch {
              // A line cut by the 256 KB: the next one.
            }
          }
        }
        if (looked > 10) return null;
      }
    }
  }
  return null;
}

/**
 * Codex's subscription: on its app server, the account (a ChatGPT login has windows, an API key
 * none) and its windows, as many as the plan has (one of 30 days on Go). Without the app server,
 * a ChatGPT login's newest session's numbers, as a copy. Nothing without Codex.
 */
export async function readCodexUsage({
  codex,
  env,
  home,
  now = Date.now,
}: {
  codex: () => Promise<Codex | null>;
  env: Env;
  home: string;
  now?: () => number;
}): Promise<UsageRead> {
  const agent = await codex();
  if (!agent) return { subscription: null };
  const server = await agent.server().catch(() => null);
  if (server) {
    const answer = await server.limits().catch(() => undefined);
    if (answer === null) return { subscription: null };
    if (answer) {
      const { windows, limited } = codexWindows(answer.rateLimits);
      const plan = planName(answer.plan);
      return {
        subscription: {
          agent: 'codex',
          ...(plan ? { plan } : {}),
          windows,
          at: new Date(now()).toISOString(),
          source: 'live',
          ...(limited ? { limited: true as const } : {}),
        },
      };
    }
  }
  if ((await agent.account()) !== 'your ChatGPT account') return { subscription: null };
  const root = join(env.CODEX_HOME?.trim() || join(home, '.codex'), 'sessions');
  const found = await newestSessionLimits(root);
  if (!found) return { subscription: null };
  const { windows, limited } = codexWindows(found.limits);
  const plan = planName(found.limits.plan_type);
  return {
    subscription: {
      agent: 'codex',
      ...(plan ? { plan } : {}),
      windows,
      at: found.at,
      source: 'cached',
      ...(limited ? { limited: true as const } : {}),
      note: "Codex's app server did not answer: the numbers of its last session",
    },
  };
}

/** `GET /api/usage`: the copy, read again in the background once older than 5 min. */
export interface UsageService {
  report(): Promise<UsageReport>;
  /** Resolves once the read under way (if any) is done: for tests. */
  settled(): Promise<void>;
}

const AGENTS = ['claude', 'codex'] as const;

/** The last numbers, kept through a failed read: without the windows reset since, and why. */
const keptThrough = (last: UsageSubscription, now: number, note?: string): UsageSubscription => ({
  ...last,
  windows: notReset(last.windows, now),
  ...(note ? { note } : {}),
});

/**
 * What to show after a read: its subscription, unless it is older than the one kept (a copy an
 * agent kept, given when the read failed: Codex's last session); with none, the last numbers if
 * the read failed. In real use a day-old copy shown through a 429 lost the 5-hour window.
 */
function shown(last: UsageSubscription | null, read: UsageRead, now: number) {
  const { subscription } = read;
  if (!subscription)
    return read.failed !== undefined && last ? keptThrough(last, now, read.failed) : null;
  if (!last || Date.parse(subscription.at) >= Date.parse(last.at)) return subscription;
  return keptThrough(last, now, subscription.note ?? read.failed);
}

/**
 * The subscriptions `readers` give, kept in memory (decision 175): the first ask waits for them;
 * after that each ask answers from the copy and reads again in the background once it is older
 * than `maxAgeMs` (5 min: at 60 s, two `symbiote view`s were refused by Claude's endpoint), one read at
 * a time. A 429 waits `backoffMs`; an error, a failed read, or a copy older than the last numbers
 * keeps the last numbers, with their time. `off` (`SYMBIOTE_USAGE=off`) reads nothing.
 */
export function usageService(
  readers: Record<(typeof AGENTS)[number], () => Promise<UsageRead>>,
  {
    off = false,
    now = Date.now,
    maxAgeMs = 300_000,
    backoffMs = 300_000,
  }: { off?: boolean; now?: () => number; maxAgeMs?: number; backoffMs?: number } = {},
): UsageService {
  const kept = new Map<string, { subscription: UsageSubscription | null; readAt: number }>();
  const waitUntil = new Map<string, number>();
  let reading: Promise<void> | null = null;

  /** Reads the subscriptions whose copy is old (and not told to wait), one read at a time. */
  const readAll = (): Promise<void> => {
    if (reading) return reading;
    const due = AGENTS.filter((agent) => {
      const last = kept.get(agent);
      return (!last || now() - last.readAt >= maxAgeMs) && (waitUntil.get(agent) ?? 0) <= now();
    });
    if (due.length === 0) return Promise.resolve();
    reading = Promise.all(
      due.map(async (agent) => {
        const last = kept.get(agent)?.subscription ?? null;
        try {
          const read = await readers[agent]();
          if (read.backoff) waitUntil.set(agent, now() + backoffMs);
          kept.set(agent, { subscription: shown(last, read, now()), readAt: now() });
        } catch {
          kept.set(agent, { subscription: last, readAt: now() });
        }
      }),
    ).then(() => {
      reading = null;
    });
    return reading;
  };
  const report = (): UsageReport => ({
    subscriptions: AGENTS.flatMap((agent) => {
      const subscription = kept.get(agent)?.subscription;
      return subscription ? [subscription] : [];
    }),
  });
  return {
    async report() {
      if (off) return { subscriptions: [], off: true };
      if (kept.size === 0) await readAll();
      else void readAll();
      return report();
    },
    settled: () => reading ?? Promise.resolve(),
  };
}
