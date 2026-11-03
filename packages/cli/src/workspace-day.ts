// `GET /api/workspaces/day?since=` (V91, decision 852): what Symbiote and git recorded since the
// Overview's local midnight six days back — the threads' asks, reports and the person's messages,
// Hive's events and its records with their writer's timed totals, git's merges into the default
// branch, and the workspaces' starts. Read, never written; a file not modified since `since` holds
// nothing since and is not read, and a file read is kept until it changes.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  defaultBranch,
  git,
  listRefs,
  type CostPoint,
  type DayEvent,
  type DayMerge,
  type GitRepo,
  type HiveDayRecord,
  type ThreadEntry,
  type WorkspaceDay,
} from '@symbiote/core';
import { readPacingConfig, spendOf, transcriptPoints, writerTranscripts } from './hive-pacing.js';
import { hiveDir, hiveEventsPath, hivePath, parseHive, type HiveFile } from './hive-record.js';
import { reviewPlace } from './reviews.js';
import { threadEntries, threadPath } from './thread.js';
import {
  readWorkspace,
  symbioteFolder,
  workspacePath,
  workspacesDir,
  type WorkspaceFile,
} from './workspace-record.js';

/** The Overview's read of the days. */
export interface WorkspaceDayService {
  read(since: string): Promise<WorkspaceDay>;
}

/** A thread's words as the feed takes them: the first line, at most 200 characters. */
const FIRST_LINE = 200;
const firstLine = (text: string) => (text.split('\n')[0] ?? '').slice(0, FIRST_LINE);

/** Prompts that are not the person's answer (V89's `planAnswered`): Symbiote's start, a job's end. */
const NOT_AN_ANSWER = new Set(['start', 'task', 'subagent']);

/** How long the default branch and the records' place are kept before git is asked again. */
const INTO_MS = 60_000;

/** Hive's steps in flight or stopped: listed whatever their time. */
const OPEN_STEPS = new Set(['writing', 'checking', 'reviewing', 'landing', 'stuck']);

/** A thread's entries since `since`, as the day's events: asks, reports, the person's prompts. */
export function threadEvents(branch: string, entries: readonly ThreadEntry[], since: number) {
  const events: DayEvent[] = [];
  let reported = false;
  let answered = false;
  for (const entry of entries) {
    const at = Date.parse(entry.at);
    if (entry.kind === 'report') {
      if (at >= since) {
        events.push({
          at: entry.at,
          branch,
          source: 'thread',
          kind: 'report',
          text: firstLine(entry.text),
          // A report after the person answered the first (the plan, with plan first) is not one.
          data: { answered: reported && answered },
        });
      }
      reported = true;
    } else if (entry.kind === 'prompt' && !NOT_AN_ANSWER.has(entry.from ?? 'person')) {
      if (reported) answered = true;
      if (at >= since && (entry.from ?? 'person') === 'person') {
        events.push({
          at: entry.at,
          branch,
          source: 'thread',
          kind: 'prompt',
          text: firstLine(entry.text),
        });
      }
    } else if (entry.kind === 'asks' && at >= since) {
      const question = entry.questions?.map((q) => q.question).join('; ');
      events.push({
        at: entry.at,
        branch,
        source: 'thread',
        kind: 'asks',
        ...(question ? { text: firstLine(question) } : {}),
        data: { tool: entry.tool },
      });
    }
  }
  return events;
}

/** A Hive log's lines since `since`: its time and kind, the rest as written. */
export function hiveEvents(branch: string, text: string, since: number): DayEvent[] {
  const events: DayEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const { at, kind, ...data } = value as Record<string, unknown>;
    if (typeof at !== 'string' || typeof kind !== 'string' || !(Date.parse(at) >= since)) continue;
    events.push({
      at,
      branch,
      source: 'hive',
      kind,
      ...(Object.keys(data).length > 0 ? { data } : {}),
    });
  }
  return events;
}

/**
 * The merger's subject, `Merge <branch>: <title>`, or git's own, `Merge branch '<branch>'`: the
 * branch merged; none for another subject.
 */
export function mergedBranch(subject: string): string | undefined {
  return /^Merge ([^\s:']+): /.exec(subject)?.[1] ?? /^Merge branch '([^']+)'/.exec(subject)?.[1];
}

/**
 * Each file's parse, made again only once its size or time changed; null for a file not modified
 * since `since` (nothing in it is) or not there.
 */
function parsedFiles<T>(parse: (text: string) => T) {
  const files = new Map<string, { size: number; mtimeMs: number; value: T }>();
  return async (path: string, since: number): Promise<T | null> => {
    const file = await stat(path).catch(() => null);
    if (!file || file.mtimeMs < since) return null;
    const kept = files.get(path);
    if (kept && kept.size === file.size && kept.mtimeMs === file.mtimeMs) return kept.value;
    const text = await readFile(path, 'utf8').catch(() => null);
    if (text === null) return null;
    const value = parse(text);
    files.set(path, { size: file.size, mtimeMs: file.mtimeMs, value });
    return value;
  };
}

/** Every workspace record in `dir`, each read again only once its file changed. */
function workspaceRecords() {
  const files = new Map<string, { size: number; mtimeMs: number; record: WorkspaceFile | null }>();
  return async (dir: string): Promise<WorkspaceFile[]> => {
    const names = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
    const read = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => {
          const path = join(dir, name);
          const file = await stat(path).catch(() => null);
          if (!file?.isFile()) return null;
          let kept = files.get(path);
          if (!kept || kept.size !== file.size || kept.mtimeMs !== file.mtimeMs) {
            kept = { size: file.size, mtimeMs: file.mtimeMs, record: await readWorkspace(path) };
            files.set(path, kept);
          }
          // The file must be the branch's, as `readRecords` has it.
          const { record } = kept;
          return record && relative(dir, workspacePath(dir, record.branch)) === name
            ? record
            : null;
        }),
    );
    return read.filter((record): record is WorkspaceFile => record !== null);
  };
}

/** The day read of `repo`'s records, kept where its reviews are (`reviewPlace`). */
export function workspaceDay(
  repo: GitRepo,
  cacheDir: string,
  { root = repo.root }: { root?: string } = {},
): WorkspaceDayService {
  const threads = parsedFiles(threadEntries);
  const logs = parsedFiles((text) => text);
  const readWorkspaces = workspaceRecords();
  const points = transcriptPoints();
  /** Hive's records, each parsed again only once its file changed. */
  const records = new Map<string, { mtimeMs: number; size: number; record: HiveFile | null }>();

  async function hiveRecords(
    where: Parameters<typeof hiveDir>[0],
  ): Promise<{ record: HiveFile; mtimeMs: number }[]> {
    const dir = hiveDir(where);
    const names = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
    const read = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => {
          const path = join(dir, name);
          const file = await stat(path).catch(() => null);
          if (!file?.isFile()) return null;
          let kept = records.get(path);
          if (!kept || kept.mtimeMs !== file.mtimeMs || kept.size !== file.size) {
            const record = await readFile(path, 'utf8').then(
              (body) => parseHive(JSON.parse(body)),
              () => null,
            );
            kept = { mtimeMs: file.mtimeMs, size: file.size, record };
            records.set(path, kept);
          }
          // The record must be its branch's: a copied file, or a run's file beside it, is not.
          const { record } = kept;
          return record && relative(dir, hivePath(where, record.branch)) === name
            ? { record, mtimeMs: file.mtimeMs }
            : null;
        }),
    );
    return read.filter((r): r is { record: HiveFile; mtimeMs: number } => r !== null);
  }

  /** The writer's totals since `since`, and each transcript's last before it. */
  async function writerPoints(symbiote: string, branch: string, since: number) {
    // Its transcripts are named from its first entries on: the whole thread, as last parsed.
    const thread = (await threads(threadPath(symbiote, branch), 0)) ?? [];
    const out: CostPoint[] = [];
    for (const [transcript, path] of writerTranscripts(thread).entries()) {
      const all = await points.of(path);
      const before = all.findLastIndex((p) => Date.parse(p.at) < since);
      for (const point of all.slice(Math.max(0, before))) out.push({ transcript, ...point });
    }
    return out;
  }

  /** git's first-parent merges into `into` since `since`; pushed when `origin/<into>` has them. */
  async function merges(into: string, since: string): Promise<DayMerge[]> {
    const log = (ref: string) =>
      git(repo.root, [
        'log',
        ref,
        '--first-parent',
        '--merges',
        `--since=${since}`,
        '--format=%H%x09%cI%x09%s',
      ]);
    // Both at once: each spawn of git costs 5–9 ms here. No `origin/<into>`: pushed is not known.
    const [text, remote] = await Promise.all([
      log(into).catch(() => ''),
      log(`origin/${into}`).catch(() => null),
    ]);
    const onOrigin =
      remote === null ? null : new Set(remote.split('\n').map((line) => line.split('\t')[0]));
    return text
      .split('\n')
      .filter(Boolean)
      .map((line): DayMerge => {
        const [sha = '', at = '', ...rest] = line.split('\t');
        const subject = rest.join('\t');
        const branch = mergedBranch(subject);
        return {
          sha,
          at: new Date(at).toISOString(),
          subject,
          into,
          ...(branch ? { branch } : {}),
          ...(onOrigin ? { pushed: onOrigin.has(sha) } : {}),
        };
      })
      .reverse();
  }

  /** The default branch, asked of git again after a minute: listing the refs costs ~25 ms. */
  let defaultOf: { at: number; into: Promise<string | null> } | null = null;
  const intoNow = () => {
    if (!defaultOf || Date.now() - defaultOf.at > INTO_MS) {
      const into = listRefs(repo).then((refs) => defaultBranch(repo, refs));
      defaultOf = { at: Date.now(), into };
      into.catch(() => {
        defaultOf = null;
      });
    }
    return defaultOf.into;
  };

  /** Where the records are, asked again after a minute: `reviewPlace` asks git for the email. */
  let placeOf: { at: number; where: ReturnType<typeof reviewPlace> } | null = null;
  const whereNow = () => {
    if (!placeOf || Date.now() - placeOf.at > INTO_MS) {
      const where = reviewPlace(repo, cacheDir);
      placeOf = { at: Date.now(), where };
      where.catch(() => {
        placeOf = null;
      });
    }
    return placeOf.where;
  };

  return {
    async read(since) {
      const from = Date.parse(since);
      if (!Number.isFinite(from)) throw new Error(`since is not a time: ${since}`);
      const where = await whereNow();
      const symbiote = symbioteFolder(where);
      const [workspaces, { into, merged }] = await Promise.all([
        readWorkspaces(workspacesDir(where)),
        intoNow().then(async (into) => ({ into, merged: into ? await merges(into, since) : [] })),
      ]);
      const named = new Map(workspaces.map((w) => [w.branch, w]));

      const events: DayEvent[] = (
        await Promise.all(
          workspaces.map(async (workspace) => {
            const entries = await threads(threadPath(symbiote, workspace.branch), from);
            return entries ? threadEvents(workspace.branch, entries, from) : [];
          }),
        )
      ).flat();

      const { budget } = readPacingConfig(root);
      const records = await Promise.all(
        (await hiveRecords(where)).map(async ({ record, mtimeMs }) => {
          const log = await logs(hiveEventsPath(where, record.branch), from);
          const logged = log === null ? [] : hiveEvents(record.branch, log, from);
          const touched = mtimeMs >= from || logged.length > 0;
          if (!touched && !OPEN_STEPS.has(record.step)) return { logged, day: null };
          const workspace = named.get(record.branch);
          const writer = await writerPoints(symbiote, record.branch, from).catch(() => []);
          const day: HiveDayRecord = {
            branch: record.branch,
            ...(workspace?.title ? { title: workspace.title } : {}),
            ...(workspace?.kind ? { kind: workspace.kind } : {}),
            ...(workspace?.finished ? { finished: workspace.finished } : {}),
            started: record.started,
            step: record.step,
            round: record.round,
            rounds: record.rounds,
            ...(record.note ? { note: record.note } : {}),
            ...(record.landings?.length ? { landings: record.landings } : {}),
            ...(record.pushed ? { pushed: record.pushed } : {}),
            ...(record.request ? { request: record.request } : {}),
            reviews: record.reviews.map((r) => ({
              round: r.round,
              kept: r.findings.filter((f) => f.kept).length,
              ...(r.cost !== undefined ? { cost: r.cost } : {}),
            })),
            spend: spendOf(record, record.spent?.writer, budget),
            ...(writer.length > 0 ? { writer } : {}),
          };
          return { logged, day };
        }),
      );
      for (const { logged } of records) events.push(...logged);
      const hive = records
        .flatMap(({ day }) => (day ? [day] : []))
        .sort((a, b) => a.started.localeCompare(b.started));

      const started: Record<string, string> = {};
      const mergedBranches = new Set(merged.flatMap((m) => (m.branch ? [m.branch] : [])));
      for (const workspace of workspaces) {
        if (Date.parse(workspace.created) >= from || mergedBranches.has(workspace.branch)) {
          started[workspace.branch] = workspace.created;
        }
      }
      events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      return { since, into, events, merges: merged, started, hive };
    },
  };
}
