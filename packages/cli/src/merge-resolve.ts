// A conflict resolved (V26c): the merger agent answers each conflicting region, given what
// each side changed; its effort and model as Settings shows them.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  abortMerge,
  commitResolution,
  commitSubject,
  conflictKinds,
  mergeBase,
  MergeStepRefused,
  type AgentKind,
  type MergeEntry,
  type MergeConflict,
  type MergeRegion,
  type AgentLevels,
} from '@symbiote/core';
import { AGENT_NAMES, levelsOn } from './agent-levels.js';
import {
  aroundOf,
  applyAnswer,
  conflictRegions,
  mergerInstructions,
  mergerPrompt,
  parseAnswer,
  type ConflictRegion,
  type MergerAnswer,
  type MergerInput,
} from './merge-agent.js';
import { readPrompts } from './prompts.js';
import { type MergerContext, mergeMessage, short, plural } from './merge-context.js';
import type { MergeTargetSteps } from './merge-targets.js';
import { readMergeConfig, MERGER_CLAUDE_MODEL, modelOf } from './merge-config.js';

/** `4.0 s`, `1 min 21 s`: as the page says a time. */
const seconds = (ms: number) => {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
};

/** Tokens, short: `950`, `3.1K`. */
export const tokens = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}K`);

/**
 * Writes the merger agent's answer into the merge's worktree (V26c): in each conflicted file, each
 * region's text in place of its markers, in the answer's order; the regions as the entry keeps
 * them, each with its note.
 */
async function writeAnswer(
  worktree: string,
  perFile: { path: string; text: string; regions: ConflictRegion[] }[],
  answer: Extract<MergerAnswer, { texts: string[] }>,
): Promise<MergeRegion[]> {
  const regions = conflictsOf(perFile);
  let n = 0;
  for (const file of perFile) {
    const texts = file.regions.map((_, i) => answer.texts[n + i] ?? '');
    n += file.regions.length;
    await writeFile(join(worktree, file.path), applyAnswer(file.text, file.regions, texts));
  }
  return regions.map((region, i) => {
    const note = answer.notes[i];
    return { ...region, text: answer.texts[i] ?? '', ...(note ? { note } : {}) };
  });
}

/**
 * The regions as the agent was given them, in its prompt's order: each with the lines around it,
 * which stay in the file (fix/merge-viewer-on-conflict).
 */
function conflictsOf(
  perFile: { path: string; text: string; regions: ConflictRegion[] }[],
): MergeConflict[] {
  return perFile.flatMap((file) =>
    file.regions.map((region) => ({
      path: file.path,
      line: region.start + 1,
      ours: region.ours,
      base: region.base,
      theirs: region.theirs,
      around: aroundOf(file.text, region, { inFile: true }),
    })),
  );
}

/** The merger's resolve steps. */
export function mergeResolve(
  {
    changedSymbols,
    levels,
    logs,
    mergerAgent,
    models,
    repo,
    root,
    set,
    worktree,
  }: Pick<
    MergerContext,
    | 'changedSymbols'
    | 'levels'
    | 'logs'
    | 'mergerAgent'
    | 'models'
    | 'repo'
    | 'root'
    | 'set'
    | 'worktree'
  >,
  { recordsOf }: Pick<MergeTargetSteps, 'recordsOf'>,
) {
  /** Each side's title: a workspace's title and goal, else its last commit's subject. */
  async function sidesOf(entry: MergeEntry, base: string): Promise<MergerInput['sides']> {
    const { workspace } = await recordsOf(entry.branch);
    const goal = workspace?.parts?.goal?.trim().split('\n')[0];
    const branch = workspace?.title
      ? `${workspace.title}${goal ? ` — ${goal}` : ''}`
      : await commitSubject(repo, entry.head);
    return { into: await commitSubject(repo, base), branch };
  }

  /** The symbols both sides changed in `files` since their merge base; none when unknown. */
  async function bothChanged(
    base: string,
    head: string,
    files: string[],
  ): Promise<NonNullable<MergerInput['symbols']>> {
    try {
      const ancestor = await mergeBase(repo, base, head);
      if (!ancestor) return [];
      const [ours, theirs] = await Promise.all([
        changedSymbols(ancestor, base, files),
        changedSymbols(ancestor, head, files),
      ]);
      return ours.flatMap((o) => {
        const t = theirs.find((x) => x.path === o.path && x.name === o.name);
        return t
          ? [{ path: o.path, name: o.name, kind: o.kind, into: o.status, branch: t.status }]
          : [];
      });
    } catch {
      return [];
    }
  }

  /**
   * The merger agent's resolution of a conflicted merge left in the worktree (V26c): its answer
   * written between each region's markers and the merge committed, its SHA; else the merge
   * aborted and the entry at `needs-you`, saying why, and null.
   */
  async function resolve(
    entry: MergeEntry,
    base: string,
    conflicts: string[],
  ): Promise<string | null> {
    const { id } = entry;
    const log = logs.of(id);
    log.step('resolve', 'Merger agent');
    /** `said`: the log's words, when they are not the entry's message. */
    const stop = async (message: string, fields: Partial<MergeEntry> = {}, said = message) => {
      log.out(`${said.charAt(0).toUpperCase()}${said.slice(1)}\n`);
      log.end(false);
      await abortMerge(worktree);
      await set(id, { state: 'needs-you', conflicts, message, again: undefined, ...fields });
      return null;
    };
    const kinds = await conflictKinds(worktree);
    const kept = [...kinds].filter(([, kind]) => kind !== 'text');
    if (kept.length > 0) {
      const words = {
        deleted: 'is deleted on one side',
        submodule: 'is a submodule',
        binary: 'is binary',
      };
      return stop(
        `${kept.map(([path, kind]) => `${path} ${words[kind as keyof typeof words]}`).join('; ')}: not given to the merger agent. Merge ${entry.into} into ${entry.branch}, resolve it there, and review it again`,
        {
          unresolvable: kept.map(([path, kind]) => ({ path, kind: kind as keyof typeof words })),
        },
      );
    }
    const config = readMergeConfig(root);
    const agent = await mergerAgent(config.agent);
    if (!agent) {
      return stop(
        `${entry.head.slice(0, 7)} conflicts with ${entry.into}: merge ${entry.into} into ${entry.branch}, resolve it there, and review it again (no merger agent: install Claude Code or Codex)`,
      );
    }
    const model = modelOf(agent.kind, config);
    await set(id, { state: 'resolving', conflicts });
    const files = await Promise.all(
      conflicts.map(async (path) => ({ path, text: await readFile(join(worktree, path), 'utf8') })),
    );
    const rules = await readFile(join(root, 'symbiote', 'merge.md'), 'utf8').catch(() => undefined);
    const analysed = Date.now();
    const symbols = await bothChanged(base, entry.head, conflicts);
    log.out(
      `Symbols both sides changed in ${conflicts.join(', ')}: ${symbols.length} (${seconds(Date.now() - analysed)})\n`,
    );
    const prompt = mergerPrompt({
      branch: entry.branch,
      into: entry.into,
      head: entry.head,
      base,
      sides: await sidesOf(entry, base),
      files,
      symbols,
      ...(rules ? { rules } : {}),
      ...(entry.again ? { again: entry.again } : {}),
    });
    const regionCount = files.reduce((n, f) => n + conflictRegions(f.text).length, 0);
    log.out(
      `Asking ${AGENT_NAMES[agent.kind]}${model ? ` (${model})` : ''}: ${plural(regionCount, 'region')} in ${plural(files.length, 'file')}, ${prompt.length.toLocaleString('en-US')} characters\n`,
    );
    const effort = await effortOf(agent.kind, config.effort, model, (line) => log.out(line));
    const run = await agent.run({
      cwd: worktree,
      prompt,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      instructions: mergerInstructions(readPrompts(root).text.merger),
      // What it does as it works (V46b), in its step.
      onEvent: (event) => log.agent(event),
    });
    if (!run.ok) return stop(`the merger agent did not answer: ${run.error}`);
    log.out(
      `Answered in ${seconds(run.ms)}${run.usage ? ` · ${tokens(run.usage.input)} tokens in, ${tokens(run.usage.output)} out` : ''}\n`,
    );
    const about = {
      agent: agent.kind,
      ...(model ? { model } : {}),
      ...(run.usage ? { usage: run.usage } : {}),
      ms: run.ms,
    };
    const perFile = files.map((file) => ({ ...file, regions: conflictRegions(file.text) }));
    const count = perFile.reduce((n, f) => n + f.regions.length, 0);
    const answer = parseAnswer(run.text, count);
    if ('needsYou' in answer) {
      // What it asked about is kept for the person to read and answer.
      const asked = conflictsOf(perFile);
      return stop(
        `the merger agent: ${answer.needsYou}`,
        { resolution: { ...about, regions: [], needsYou: answer.needsYou, asked } },
        `it says you must decide: ${answer.needsYou}`,
      );
    }
    if ('error' in answer) return stop(`the merger agent's answer: ${answer.error}`);
    const regions = await writeAnswer(worktree, perFile, answer);
    let merged: string;
    try {
      merged = await commitResolution(worktree, conflicts, mergeMessage(entry));
    } catch (error) {
      if (error instanceof MergeStepRefused) return stop(error.message);
      throw error;
    }
    log.out(
      `Wrote ${plural(regions.length, 'region')} in ${plural(perFile.length, 'file')}; committed the merge ${short(merged)}\n`,
    );
    log.end(true);
    await set(id, { conflicts, resolution: { ...about, regions }, again: undefined });
    return merged;
  }

  /**
   * The level the merger agent is asked at (V46d): `merge.effort` when the agent takes it on
   * `model` (V47: that model's levels when the agent lists it, its default's otherwise), none
   * otherwise, as Nucleus's (the project's file may name another agent's level). `say` is told which.
   */
  async function effortOf(
    kind: AgentKind,
    effort: string | undefined,
    model: string | undefined,
    say: (line: string) => void,
  ): Promise<string | undefined> {
    if (!effort) return undefined;
    const name = AGENT_NAMES[kind];
    const on = model ? (await models(kind))?.models.find((m) => m.id === model) : undefined;
    if (on && !on.efforts) {
      say(`merge.effort is ${effort}, which ${on.name} does not take: its own level\n`);
      return undefined;
    }
    const listed = (on?.efforts ?? (await levels(kind)))?.levels;
    if (!listed) {
      say(`Symbiote cannot read ${name}'s effort levels: its own level\n`);
      return undefined;
    }
    if (!listed.includes(effort)) {
      say(`merge.effort is ${effort}, which ${on?.name ?? name} does not list: its own level\n`);
      return undefined;
    }
    say(`Effort: ${effort} (merge.effort)\n`);
    return effort;
  }

  async function efforts(): Promise<AgentLevels> {
    const config = readMergeConfig(root);
    const agent = await mergerAgent(config.agent);
    const about = {
      ...(config.effort ? { effort: config.effort } : {}),
      ...(config.model ? { model: config.model } : {}),
      file: readPrompts(root).file,
    };
    if (!agent) return { agents: [], ...about };
    const [fallback, listed] = await Promise.all([levels(agent.kind), models(agent.kind)]);
    // Its levels on the model it runs on (V47).
    const efforts = levelsOn(listed?.models, modelOf(agent.kind, config), fallback);
    // Without merge.model: Symbiote's for Claude Code (V26c), Codex's configured one.
    const fixed = agent.kind === 'claude' ? MERGER_CLAUDE_MODEL : listed?.default;
    const by = agent.kind === 'claude' ? ('symbiote' as const) : ('agent' as const);
    return {
      agents: [
        {
          kind: agent.kind,
          ...(efforts ? { efforts } : {}),
          ...(listed ? { models: listed.models } : {}),
          ...(listed && fixed ? { defaultModel: { id: fixed, by } } : {}),
        },
      ],
      ...about,
    };
  }

  return { resolve, efforts };
}

export type MergeResolveSteps = ReturnType<typeof mergeResolve>;
