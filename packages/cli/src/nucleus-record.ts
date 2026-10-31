// Nucleus's gate's side of its record (NU2, decisions 605, 608): the call's start and the gate's
// decision, appended in the gate's own process before it answers, every string redacted. The gate
// runs on every tool call: this module loads only Node's `fs` and `path` and the types-only tool
// line (`tool-activity.ts`); the rest of the record is `nucleus-activity.ts`, loaded for the
// events Claude Code runs in the background.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NucleusActivityLine, NucleusCall } from '@symbiote/core';
import { gateDecision, gateOptions, hookOutput, type GateDecision } from './nucleus-gate.js';
import { activityEntry, MAX_COMMAND } from './tool-activity.js';

/**
 * Words in a variable's name that say it holds a secret, besides the forges' tokens Symbiote reads.
 * Matched by string, not a case-insensitive regex: one costs ~1.3 ms at a process's start, and the
 * gate starts with every call.
 */
const SECRET_WORDS = ['TOKEN', 'SECRET', 'PASSWORD', 'PASSWD', 'CREDENTIAL', 'COOKIE', 'PRIVATE'];
const secretName = (name: string) => {
  const upper = name.toUpperCase();
  if (SECRET_WORDS.some((word) => upper.includes(word))) return true;
  const parts = upper.split('_');
  return parts.includes('KEY') || parts.includes('APIKEY');
};
const FORGE_TOKENS = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GITLAB_TOKEN',
  'CI_JOB_TOKEN',
];
/** Shorter values are too common to be told from ordinary words. */
const MIN_SECRET = 8;

/** Tokens by their shape: GitHub's, GitLab's, Anthropic's and OpenAI's, Slack's, AWS's keys. */
const SHAPES = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];
const BEARER = /(\bBearer\s+)[A-Za-z0-9._~+/=-]{6,}/g;
const URL_PASSWORD = /(\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/g;
const QUERY = /([?&])([A-Za-z_]+)=([^&\s#"']+)/g;
/** Query parameters that carry a secret, by their name in lower case. */
const SECRET_PARAMS = new Set([
  'access_token',
  'refresh_token',
  'token',
  'api_key',
  'apikey',
  'key',
  'secret',
  'client_secret',
  'password',
  'sig',
  'signature',
]);

/** The values to hide, longest first (one may hold another), by the variable's name. */
export function secretsOf(env: Readonly<Record<string, string | undefined>>): [string, string][] {
  return Object.entries(env)
    .filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' &&
        entry[1].length >= MIN_SECRET &&
        (FORGE_TOKENS.includes(entry[0]) || secretName(entry[0])),
    )
    .sort((a, b) => b[1].length - a[1].length);
}

/**
 * `text` without secrets (decision 608): the values of secret-named variables in `env` as
 * `[redacted: NAME]`, tokens by their shape, a bearer, a URL's password and secret query
 * parameters as `[redacted]`.
 */
export function redact(text: string, env: Readonly<Record<string, string | undefined>>): string {
  return redactWith(text, secretsOf(env));
}

export function redactWith(text: string, secrets: readonly [string, string][]): string {
  let out = text;
  for (const [name, value] of secrets) out = out.split(value).join(`[redacted: ${name}]`);
  for (const shape of SHAPES) out = out.replace(shape, '[redacted]');
  return out
    .replace(BEARER, '$1[redacted]')
    .replace(URL_PASSWORD, '$1[redacted]@')
    .replace(QUERY, (whole, mark: string, name: string) =>
      SECRET_PARAMS.has(name.toLowerCase()) ? `${mark}${name}=[redacted]` : whole,
    );
}

/** A value with every string in it redacted. */
export function redactDeep(value: unknown, secrets: readonly [string, string][]): unknown {
  if (typeof value === 'string') return redactWith(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, redactDeep(v, secrets)]),
    );
  }
  return value;
}

/** Appends `lines` to `file`, redacted; one write, as the gate waits for it. */
export function appendActivity(
  file: string,
  lines: readonly NucleusActivityLine[],
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (lines.length === 0) return;
  const secrets = secretsOf(env);
  const text = lines.map((line) => `${JSON.stringify(redactDeep(line, secrets))}\n`).join('');
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, text);
}

/** Who a hook's line is for: its session, Nucleus's conversation on Claude Code. */
export const ofSession = (session: string) => ({ conversation: session, agent: 'claude' as const });

/**
 * The gate's line for a PreToolUse hook's input (decision 605): the call's start, as a workspace's
 * hook records it (V73), its input whole for any tool, and the gate's decision; null without a
 * session, a tool or a call ID.
 */
export function gateLine(
  input: unknown,
  decision: GateDecision,
  at: string,
  checkout: string,
): NucleusCall | null {
  const entry = activityEntry(input, at, checkout);
  if (!entry || entry.phase !== 'start') return null;
  const given = (input as { tool_input?: unknown }).tool_input;
  const shown =
    entry.input === undefined && given && typeof given === 'object'
      ? JSON.stringify(given).slice(0, MAX_COMMAND)
      : undefined;
  const reason = decision?.reason;
  return {
    ...entry,
    ...ofSession(entry.session),
    ...(shown && shown !== '{}' ? { input: shown } : {}),
    gate: decision
      ? { decision: decision.allow ? 'allow' : 'deny', ...(reason ? { reason } : {}) }
      : { decision: 'agent' },
  };
}

/** The activity file named by the hook's `--activity=<file>` argument (decision 605). */
export const activityArg = (args: readonly string[]) =>
  args.find((arg) => arg.startsWith('--activity='))?.slice('--activity='.length) || undefined;

/**
 * The gate's part of the hook (`nucleus-hook.ts`): for PreToolUse, or without `--activity`, the
 * gate's answer, the call's start and its decision recorded first; null for any other event, which
 * `recordHook` records. Recording never fails a call.
 */
export function gateHook(
  input: unknown,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  at: string,
): string | null {
  const file = activityArg(args);
  const event = (input as { hook_event_name?: unknown } | null)?.hook_event_name;
  if (file && event !== 'PreToolUse') return null;
  const options = gateOptions(args);
  const decision = gateDecision(input, options);
  if (file) {
    try {
      const line = gateLine(input, decision, at, checkoutOf(args, input));
      if (line) appendActivity(file, [line], env);
    } catch {
      // The call goes on unrecorded.
    }
  }
  return hookOutput(decision, options.name);
}

/** The checkout paths are written from: the gate's first argument, else the hook's `cwd`. */
export function checkoutOf(args: readonly string[], input: unknown): string {
  const cwd = (input as { cwd?: unknown } | null)?.cwd;
  return args.find((arg) => !arg.startsWith('--')) ?? (typeof cwd === 'string' ? cwd : '');
}
