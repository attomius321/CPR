// Scribe's gate (V41, decision 275): what Scribe's Claude Code may do, decided by Symbiote before
// Claude Code's own rules. Read, Grep and Glob pass to those rules; Bash runs only git's read
// commands, as Nucleus's (`gitReadProblem`); Write and Edit only for a file in a skill's folder of
// the checkout's skills, or of the skill library's (SK1, decision 430), by its real path, and then
// Claude Code's own rules ask the person; every other tool is denied. Like Nucleus's gate, it runs once per tool call in Claude
// Code's process tree (`scribe-hook.ts`), so it uses nothing but Node's modules.
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { gitReadProblem, type GateDecision } from './nucleus-gate.js';

const READS = ['Read', 'Grep', 'Glob'];
const WRITES = ['Write', 'Edit', 'MultiEdit'];

/** `path`'s real path: its nearest folder that exists, made real, then the rest as written. */
function realTarget(path: string): string {
  const rest: string[] = [];
  let head = path;
  for (;;) {
    try {
      return join(realpathSync(head), ...rest);
    } catch {
      // Not there yet: a new skill's folder, a new file.
    }
    const up = dirname(head);
    if (up === head) return path;
    rest.unshift(basename(head));
    head = up;
  }
}

/** The folders of skills given: one, or the checkout's then the library's. */
const listOf = (skills: string | readonly string[]): readonly string[] =>
  typeof skills === 'string' ? [skills] : skills;

/**
 * Why Scribe may not write `path`, or null when it may: an absolute path, without `..`, whose real
 * path is in a skill's folder of one of `skills` (`<skills>/<name>/…`).
 */
export function writeProblem(path: unknown, skills: string | readonly string[]): string | null {
  if (typeof path !== 'string' || path === '') return 'no file given';
  if (!isAbsolute(path)) return `${path} is not an absolute path`;
  if (path.split(/[\\/]/).includes('..')) return `${path} holds "..": give the file's own path`;
  const folders = listOf(skills);
  const target = realTarget(path);
  for (const folder of folders) {
    const inside = relative(realTarget(folder), target);
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) continue;
    if (!inside.includes(sep)) return `${path} is not in a skill's folder (${folder}/<name>/…)`;
    return null;
  }
  return `${path} is outside ${folders.join(' and ')}`;
}

/** The gate's decision on one tool call (Claude Code's PreToolUse input); null: its own rules. */
export function scribeDecision(input: unknown, skills: string | readonly string[]): GateDecision {
  const where = listOf(skills).join(' or ');
  if (!input || typeof input !== 'object') return null;
  const v = input as { hook_event_name?: unknown; tool_name?: unknown; tool_input?: unknown };
  if (v.hook_event_name !== 'PreToolUse' || typeof v.tool_name !== 'string') return null;
  if (READS.includes(v.tool_name)) return null;
  const toolInput = (v.tool_input ?? {}) as { command?: unknown; file_path?: unknown };
  if (v.tool_name === 'Bash') {
    const command = toolInput.command;
    const problem =
      typeof command === 'string' ? gitReadProblem(command.trim()) : 'no command given';
    if (problem === null) return { allow: true };
    return {
      allow: false,
      reason:
        "Scribe runs only git's read commands (git log, show, blame, diff, shortlog, grep, " +
        'rev-parse, merge-base, ls-files, ls-tree), one at a time, piped into head, tail, wc or ' +
        `grep at most: ${problem}. Read, Grep and Glob read files; Write and Edit write a skill.`,
    };
  }
  if (WRITES.includes(v.tool_name)) {
    const problem = writeProblem(toolInput.file_path, skills);
    if (problem === null) return null;
    return {
      allow: false,
      reason: `Scribe writes only skills, files in a skill's folder in ${where}: ${problem}.`,
    };
  }
  return {
    allow: false,
    reason: `Scribe reads files (Read, Grep, Glob) and git's history, and writes skills in ${where} (Write, Edit); nothing else (${v.tool_name}).`,
  };
}
