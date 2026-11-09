// A page agent's files (V35, NU1): its record, read and asked, the settings and MCP files its
// Claude Code session reads, a former name's files dropped.
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MODEL_ID } from '@symbiote/core';
import { prepareSymbioteFolder, type ReviewPlace } from './reviews.js';
import { shellWord } from './claude-code.js';
import { writeFileWhole } from './file-write.js';
import type { PageAgentRecord, ReadRecord, PageAgentContext } from './page-agent-context.js';
import { isLevel } from './page-agent-levels.js';

/** A name a record may keep (decision 686): letters, digits and spaces, as Alpha Ceph. */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ]{0,39}$/u;

/** The young generation the recording gate starts with, in MB (NU2). */
const SEMI_SPACE_MB = 4;

/** The events Nucleus's activity records besides the gate's (NU2): Claude Code's, in the background. */
const RECORDED_EVENTS = [
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
  'PostCompact',
  'Notification',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionDenied',
] as const;

/**
 * A page agent's settings file for Claude Code: the gate before every tool. With `activity`
 * (Nucleus's, NU2, decision 605, which revisits 238), the gate records each call and its decision
 * there, and the other events run it in the background (`async`) to record them.
 */
export function pageAgentSettings(
  where: { node: string; gate: string; args?: readonly string[]; activity?: string },
  platform: NodeJS.Platform = process.platform,
  more: Readonly<Record<string, unknown>> = {},
): string {
  const command = [
    where.node,
    // Recording takes the gate's heap past V8's first young-generation limit: one 3.5 ms scavenge
    // on every call (NU2 measured), which a larger start avoids for ~0.7 ms.
    ...(where.activity ? [`--min-semi-space-size=${SEMI_SPACE_MB}`] : []),
    where.gate,
    ...(where.args ?? []),
    ...(where.activity ? [`--activity=${where.activity}`] : []),
  ]
    .map((p) => shellWord(p, platform))
    .join(' ');
  const hooks: Record<string, unknown[]> = {
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 30 }] }],
  };
  if (where.activity) {
    for (const event of RECORDED_EVENTS) {
      const tools = event.includes('Tool') || event === 'PermissionDenied';
      hooks[event] = [
        {
          ...(tools ? { matcher: '*' } : {}),
          hooks: [{ type: 'command', command, timeout: 30, async: true }],
        },
      ];
    }
  }
  return `${JSON.stringify({ ...more, hooks }, null, 2)}\n`;
}

/** A page agent's MCP servers' file for Claude Code (MC1): Symbiote's, through its bridge. */
export function symbioteMcpConfig(server: { command: string; args: readonly string[] }): string {
  const symbiote = { type: 'stdio', command: server.command, args: server.args };
  return `${JSON.stringify({ mcpServers: { symbiote } }, null, 2)}\n`;
}

/** Writes a file of Nucleus's in `symbiote/`, its `.gitignore` first: the checkout stays clean. */
export async function put(where: ReviewPlace, path: string, text: string): Promise<void> {
  await prepareSymbioteFolder(where, { agents: false });
  await writeFileWhole(path, text);
}

/** The page agent's files. */
export function pageAgentFiles({
  folder,
  formerPaths,
  gate,
  node,
  recordPath,
  root,
  spec,
  symbioteServer,
}: Pick<
  PageAgentContext,
  'folder' | 'formerPaths' | 'gate' | 'node' | 'recordPath' | 'root' | 'spec' | 'symbioteServer'
>) {
  /** Its record; while there is none, the one under its former name (decision 591). */
  async function readRecord(where: ReviewPlace): Promise<ReadRecord | null> {
    const own = await readRecordAt(recordPath(where));
    if (own || !spec.former) return own;
    const former = await readRecordAt(join(folder(where), spec.former.record));
    return former ? { ...former, former: true } : null;
  }

  async function readRecordAt(path: string): Promise<PageAgentRecord | null> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return null;
    }
    const v = (value && typeof value === 'object' ? value : {}) as Partial<PageAgentRecord>;
    const text = (x: unknown) => (typeof x === 'string' && x !== '' ? x : undefined);
    const started = text(v.started) ?? '';
    const level = {
      ...(isLevel(v.effort) ? { effort: v.effort } : {}),
      ...(typeof v.model === 'string' && MODEL_ID.test(v.model) ? { model: v.model } : {}),
      ...(v.fresh === true ? { fresh: true as const } : {}),
      // A name, words only: it goes into the gate's arguments and the page (decision 686).
      ...(typeof v.name === 'string' && NAME.test(v.name) ? { name: v.name } : {}),
    };
    if (v.agent === 'claude' && text(v.id)) {
      const sessionId = text(v.sessionId);
      return {
        about: spec.about,
        agent: 'claude',
        id: v.id,
        ...(sessionId ? { sessionId } : {}),
        ...level,
        started,
      };
    }
    if (v.agent === 'codex' && text(v.thread)) {
      return { about: spec.about, agent: 'codex', thread: v.thread, ...level, started };
    }
    return null;
  }

  /**
   * Nucleus's settings file, written when its text differs or it is gone: a session that wakes reads
   * it again, and does not start without it (V18c spike); `as`, the name the conversation started
   * under (decision 686). Its path.
   */
  async function settingsFile(where: ReviewPlace, as: string): Promise<string> {
    const path = join(folder(where), spec.settings);
    const text = pageAgentSettings(
      {
        node,
        gate,
        args: spec.gateArgs(root, where, as),
        ...(spec.activity ? { activity: join(folder(where), spec.activity) } : {}),
      },
      process.platform,
      spec.claudeSettings,
    );
    if ((await readFile(path, 'utf8').catch(() => null)) !== text) await put(where, path, text);
    return path;
  }

  /**
   * Its MCP servers' file for Claude Code (MC1), written as the settings file is, before a start
   * and each wake; its path, or undefined for an agent without Symbiote's server.
   */
  async function mcpFile(where: ReviewPlace): Promise<string | undefined> {
    if (!spec.mcp || !symbioteServer) return undefined;
    const path = join(folder(where), spec.mcp.file);
    const text = symbioteMcpConfig(symbioteServer);
    if ((await readFile(path, 'utf8').catch(() => null)) !== text) await put(where, path, text);
    return path;
  }

  /** The record written again without `fresh`, where it was read: a turn was seen (V50). */
  async function asked(where: ReviewPlace, record: ReadRecord): Promise<void> {
    const rest: ReadRecord = { ...record };
    delete rest.fresh;
    delete rest.former;
    const path =
      record.former && spec.former ? join(folder(where), spec.former.record) : recordPath(where);
    await put(where, path, `${JSON.stringify(rest, null, 2)}\n`).catch(() => {});
  }

  /** A conversation under the former name is over: its record and its files go (decision 591). */
  async function dropFormer(where: ReviewPlace): Promise<void> {
    await Promise.all(formerPaths(where).map((path) => rm(path, { force: true })));
  }

  return { readRecord, settingsFile, mcpFile, asked, dropFormer };
}

export type PageAgentFiles = ReturnType<typeof pageAgentFiles>;
