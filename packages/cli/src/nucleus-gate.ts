// Nucleus's gate (V35, decision 236): what Nucleus's Claude Code may run, decided by Symbiote before
// Claude Code's own rules. Read, Grep and Glob pass to those rules, but in an open workspace's
// worktree, which the gate opens (V80, decisions 596-597); Bash runs the shell's read commands on
// the checkout and those worktrees, and with the web the network's reads (`nucleus-shell.ts`, NU9,
// decisions 917-922), git's as before (`git-read.ts`, decision 598); without the folders (a
// settings file from before V80), git's read commands only. Symbiote's own MCP tools pass (MC1: the asked
// ones wait for the person in Symbiote); WebSearch and WebFetch pass when Symbiote gives it the web
// (NU1, decision 592); every other tool, and every other server's, is denied. Claude Code's allow
// rules cannot do this: `Bash(git log *)` matches `git log --output=<file>`. The hook runs once per
// tool call in Claude Code's process tree (`nucleus-hook.ts`), so this module uses nothing but
// Node's modules.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { gitReadProblem, realTarget, within } from './git-read.js';
import { shellCheck } from './nucleus-shell.js';

export { gitReadProblem, realTarget } from './git-read.js';

/** What the gate says of one tool call: allowed (and why, when not one of git's read commands),
 * denied with the reason, or null: Claude Code's own rules decide. */
export type GateDecision =
  { allow: true; reason?: string } | { allow: false; reason: string } | null;

/**
 * The open workspaces' worktrees (V80, decision 596), as real paths: the folder of each record in
 * `records` (`symbiote/workspaces/<branch>.json`) without `finished`, that git lists as a linked
 * worktree of `checkout`'s repository. Not the folder holding them, which a setting may put
 * anywhere; read at each tool call, so a workspace started during a conversation is in.
 */
export function openWorktrees(checkout: string, records: string): string[] {
  const named = new Set<string>();
  let files: string[];
  try {
    files = readdirSync(records, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const v = JSON.parse(readFileSync(join(records, file), 'utf8')) as Record<string, unknown>;
      const { branch, worktree } = v;
      // The file must be the branch's, as Symbiote reads them (`readRecords`).
      if (typeof branch !== 'string' || file !== `${branch.split('/').join(sep)}.json`) continue;
      if (typeof worktree !== 'string' || !isAbsolute(worktree) || v.finished !== undefined) {
        continue;
      }
      named.add(realpathSync(worktree));
    } catch {
      // Not a record, or its folder is gone.
    }
  }
  if (named.size === 0) return [];
  let listed: string;
  try {
    listed = execFileSync('git', ['-C', checkout, 'worktree', 'list', '--porcelain', '-z'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
  } catch {
    return [];
  }
  const found: string[] = [];
  // The first is the main worktree: the checkout, never a workspace's.
  for (const line of listed
    .split('\0')
    .filter((l) => l.startsWith('worktree '))
    .slice(1)) {
    try {
      const folder = realpathSync(line.slice('worktree '.length));
      if (named.has(folder)) found.push(folder);
    } catch {
      // Listed, and gone: `git worktree prune` would remove it.
    }
  }
  return found;
}

/** What Nucleus reads besides the checkout (V80): the open workspaces' worktrees. */
export interface NucleusReach {
  /** The checkout it runs in: a path there is Claude Code's to decide, as before. */
  checkout: string;
  /** The open workspaces' worktrees, real paths (`openWorktrees`). */
  worktrees: () => readonly string[];
}

/**
 * The reach the hook's arguments give: the checkout and the records folder, from Nucleus's settings
 * file; without both (a file written before V80), none: the checkout only. Read once, when asked.
 */
export function nucleusReach(args: readonly string[]): NucleusReach | undefined {
  // Its two folders come first; `--web` (NU1) is a flag after them.
  const [checkout, records] = args.filter((arg) => !arg.startsWith('--'));
  if (!checkout || !records) return undefined;
  let found: readonly string[] | undefined;
  return { checkout, worktrees: () => (found ??= openWorktrees(checkout, records)) };
}

/**
 * What the gate is told by its arguments in the settings file: the worktrees Nucleus reads (V80),
 * and whether it has the web (NU1).
 */
export interface GateOptions {
  reach?: NucleusReach;
  web?: boolean;
  /** The name the conversation started under when not Nucleus (Alpha Ceph, decision 686). */
  name?: string;
}

/**
 * The gate's options from its arguments: the checkout and the records folder (V80), `--web`
 * when the conversation was started with the web (NU1), and `--name=` when it was started under
 * another name than Nucleus's (Alpha Ceph, decision 686). A settings file written before NU1, or
 * with `nucleus.web` false, gives no web; one written before V80, no reach.
 */
export function gateOptions(args: readonly string[]): GateOptions {
  const reach = nucleusReach(args);
  const name = args.find((arg) => arg.startsWith(NAME_ARG))?.slice(NAME_ARG.length);
  return { ...(reach ? { reach } : {}), web: args.includes('--web'), ...(name ? { name } : {}) };
}

/** The gate's argument naming the conversation (decision 686): `--name=Alpha Ceph`. */
export const NAME_ARG = '--name=';

/** Claude Code's tools on the web (NU1): a search at Anthropic, a page read by GET from here. */
const WEB = ['WebSearch', 'WebFetch'];

const READS = ['Read', 'Grep', 'Glob'];

/**
 * Read (`file_path`), Grep and Glob (`path`) in an open workspace's worktree (V80, decision 597):
 * allowed when the path is absolute, holds no `..` (Node takes it before links), and its real path
 * is there (Read follows links). Anything else is Claude Code's to decide: the checkout, read as
 * before; elsewhere, denied in `dontAsk`.
 */
function readDecision(
  tool: string,
  input: { file_path?: unknown; path?: unknown },
  reach: NucleusReach | undefined,
): GateDecision {
  const path = tool === 'Read' ? input.file_path : input.path;
  if (!reach || typeof path !== 'string' || !isAbsolute(path)) return null;
  if (path.split(/[\\/]/).includes('..')) return null;
  const target = realTarget(path);
  // The checkout's own: no record read.
  if (within(realTarget(reach.checkout), target)) return null;
  return reach.worktrees().some((w) => within(w, target))
    ? { allow: true, reason: "a workspace's worktree" }
    : null;
}

/**
 * The gate's answer to one PreToolUse hook's input (Claude Code's documented fields): `reach`, the
 * worktrees Nucleus reads besides the checkout (V80); `web`, whether it has the web (NU1).
 */
export function gateDecision(
  input: unknown,
  { reach, web = false, name: who = 'Nucleus' }: GateOptions = {},
): GateDecision {
  if (!input || typeof input !== 'object') return null;
  const v = input as { hook_event_name?: unknown; tool_name?: unknown; tool_input?: unknown };
  if (v.hook_event_name !== 'PreToolUse' || typeof v.tool_name !== 'string') return null;
  if (READS.includes(v.tool_name)) {
    return readDecision(v.tool_name, v.tool_input ?? {}, reach);
  }
  if (v.tool_name === 'Bash') {
    const command = (v.tool_input as { command?: unknown } | null)?.command;
    if (reach) return shellDecision(command, (input as { cwd?: unknown }).cwd, reach, web, who);
    const problem =
      typeof command === 'string'
        ? gitReadProblem(command.trim(), undefined, who)
        : 'no command given';
    if (problem === null) return { allow: true };
    return {
      allow: false,
      reason:
        `${who} runs only git's read commands (git log, show, blame, diff, shortlog, grep, ` +
        'rev-parse, merge-base, ls-files, ls-tree), one at a time, piped into head, tail, wc or ' +
        `grep at most: ${problem}. Read, Grep and Glob read files.`,
    };
  }
  if (v.tool_name.startsWith('mcp__')) {
    if (v.tool_name.startsWith(SYMBIOTE_TOOLS) && v.tool_name.length > SYMBIOTE_TOOLS.length) {
      return { allow: true };
    }
    return {
      allow: false,
      reason: `${who} acts only through Symbiote's tools (${SYMBIOTE_TOOLS}…), not ${v.tool_name}.`,
    };
  }
  if (WEB.includes(v.tool_name)) {
    if (web) return { allow: true, reason: 'the web, as its agent reads it (NU1)' };
    return {
      allow: false,
      reason: `${who} has no web in this conversation (${v.tool_name}): nucleus.web is false in symbiote/config.json, or the conversation started before ${who} had it. A new conversation takes the setting.`,
    };
  }
  return {
    allow: false,
    reason: `${who} changes no file: it reads files (Read, Grep, Glob) and git's history, and acts only through Symbiote's tools (${v.tool_name}).`,
  };
}

/** The reasons an allowed command is recorded with (NU9); git's alone keeps its words. */
const KIND_REASONS = {
  read: 'a read command (NU9)',
  network: 'a read on the network (NU9)',
} as const;

/**
 * The gate's answer to a Bash call with its folders (NU9, decision 917): the shell's read
 * commands on the checkout and the open worktrees, from the call's folder (`cwd`, else the
 * checkout); with `web`, the network's reads.
 */
function shellDecision(
  command: unknown,
  cwd: unknown,
  reach: NucleusReach,
  web: boolean,
  who: string,
): GateDecision {
  const folder = typeof cwd === 'string' && isAbsolute(cwd) ? cwd : reach.checkout;
  const check =
    typeof command === 'string'
      ? shellCheck(command, { cwd: folder, reach, web, who })
      : { ok: false as const, problem: 'no command given' };
  if (check.ok)
    return check.kind === 'git'
      ? { allow: true }
      : { allow: true, reason: KIND_REASONS[check.kind] };
  return {
    allow: false,
    reason:
      `${who} runs only read commands (cat, head, tail, wc, ls, stat, du, file, nl, cut, tr, ` +
      "uniq, sort, grep, rg, find, sed, jq, date, echo, and git's read commands, here or with " +
      "-C <a workspace's worktree>; no git diff in a worktree, git diff-index -p HEAD there), " +
      "joined by &&, ||, ; and pipes, on files in this checkout and the open workspaces' " +
      `worktrees${web ? ", and the web with curl (GET), gh's reads and git ls-remote" : ''}, ` +
      `nothing that writes or runs another program: ${check.problem}. Read, Grep and Glob read files.`,
  };
}

/** The MCP tools Nucleus's session is given (MC1): Symbiote's server's, and no other's. */
const SYMBIOTE_TOOLS = 'mcp__symbiote__';

/**
 * The hook's output: Claude Code's PreToolUse decision, or nothing to leave it to its rules; `who`
 * is the agent whose gate let a command through (Nucleus's, or Scribe's since V41).
 */
export function hookOutput(decision: GateDecision, who = 'Nucleus'): string {
  if (!decision) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.allow ? 'allow' : 'deny',
      permissionDecisionReason: decision.allow
        ? `${who}: ${decision.reason ?? "one of git's read commands"}`
        : decision.reason,
    },
  });
}
