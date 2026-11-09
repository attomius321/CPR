// `symbiote merge`: an approved branch queued, merged, checked and landed by the merger (V26).
import {
  defaultCacheDir,
  MERGE_STRATEGIES,
  openRepo,
  type MergeEntry,
  type MergeStrategy,
} from '@symbiote/core';
import { merger } from './merges.js';
import { MergeRefused } from './merge-context.js';
import type { CliContext } from './command-context.js';
import { UsageError, parse } from './command-args.js';
import { agentFinder, codexFinder, mergerFinder, levelsFinder } from './command-agents.js';

const MERGE_HELP = `Usage: symbiote merge <branch> [options]

Merges the commit your Symbiote review of <branch> approved into a target branch, as Merge
in Symbiote does: with --no-ff, in a worktree in Symbiote's cache, never in your checkout. Then
it runs the check (merge.checks in symbiote/config.json, else the one guessed from the
target's files) and moves the target by fast-forward: in the worktree that has it
checked out, else its ref. merge.push: true pushes it after. Without a check, the
merge waits for --land. A conflict goes to a merger agent (Claude Code or Codex,
merge.agent, merge.model) that answers each region; Symbiote writes its answer, and the
merge waits for your --approve. With --strategy fast-forward, nothing is merged: the target
moves to the approved commit itself once its check passes, if the target's tip is in it.

Options:
  --into <branch>      Branch to merge into (default: the branch its workspace started
                       from, else the one the approval names, else the default branch)
  --strategy <how>     merge (a merge commit) or fast-forward (default: merge.strategy in
                       symbiote/config.json, else merge). --strategy merge on a fast-forward
                       its target can no longer take merges it with a merge commit instead
  --land               Land the branch's merge that waits for it
  --approve            Approve the merger agent's resolution of a conflict: it lands
  --again <words>      Ask the merger agent again, with what to change in its resolution
                       or your answer to what it asked
  -h, --help           Show this help
`;

/** A merge's state as `symbiote merge` prints it, one line each. */
function mergeLine(entry: MergeEntry): string {
  const check = entry.check;
  const time = check?.ms === undefined ? '' : ` (${(check.ms / 1000).toFixed(1)} s)`;
  // An approved resolution lands whatever its check said; a failed one is still said.
  const failed = check?.ok === false ? `; its check failed: ${check.failed ?? ''}` : '';
  const fastForward = entry.strategy === 'fast-forward';
  switch (entry.state) {
    case 'queued':
      return `queued: ${entry.head.slice(0, 7)} into ${entry.into}${fastForward ? ', by fast-forward' : ''}${entry.message ? ` (${entry.message})` : ''}`;
    case 'merging':
      return fastForward
        ? `fast-forwarding ${entry.into} from ${entry.base?.slice(0, 7) ?? '?'}`
        : `merging into ${entry.into} at ${entry.base?.slice(0, 7) ?? '?'}`;
    case 'resolving':
      return `resolving: ${entry.conflicts?.length ?? 0} conflicting file(s), asked of the merger agent`;
    case 'checking':
      return `checking: ${check?.commands.join(' && ') ?? ''} (${check?.source ?? ''})`;
    case 'needs-you': {
      const regions = entry.resolution?.regions ?? [];
      if (regions.length > 0 && entry.merge) {
        const by = entry.resolution?.model ?? entry.resolution?.agent ?? '';
        const tokens = entry.resolution?.usage
          ? `, ${entry.resolution.usage.input} tokens in, ${entry.resolution.usage.output} out`
          : '';
        const checked = failed || (check?.ok ? `; checked${time}` : '');
        const lines = regions.map(
          (r) =>
            `  ${r.path}:${r.line}${r.note ? ` — ${r.note}` : ''}\n${r.text.replace(/^/gm, '    | ')}`,
        );
        return `needs you: review the resolution (${by}${tokens})${checked}\n${lines.join('\n')}\n  then --approve, or --again "<what to change>"`;
      }
      // What the agent asked about, each region numbered as its prompt numbered it.
      const asked = entry.resolution?.needsYou ? (entry.resolution.asked ?? []) : [];
      if (asked.length > 0) {
        const sides = asked.map((r, i) =>
          [
            `  Region ${i + 1} · ${r.path}:${r.line}`,
            ...r.ours.map((line) => `    ${entry.into} | ${line}`),
            ...r.theirs.map((line) => `    ${entry.branch} | ${line}`),
          ].join('\n'),
        );
        return `needs you: ${entry.message ?? ''}\n${sides.join('\n')}\n  then --again "<your answer>"`;
      }
      // A fast-forward its target can no longer take (V67).
      if (entry.behind)
        return `needs you: ${entry.message ?? ''}\n  then --strategy merge for a merge commit`;
      return `needs you: ${entry.message ?? ''}${entry.conflicts ? `\n  ${entry.conflicts.join('\n  ')}` : ''}`;
    }
    case 'ready':
      return `ready to land${time}${entry.message ? `: ${entry.message}` : ''}${failed}`;
    case 'landed': {
      const pushed = entry.pushed
        ? entry.pushed.ok
          ? `, pushed to ${entry.pushed.remote}`
          : `; not pushed: ${entry.pushed.error}`
        : '';
      const at = entry.merge?.slice(0, 7) ?? entry.head.slice(0, 7);
      const moved = fastForward && entry.merge ? `fast-forwarded to ${at}` : `is at ${at}`;
      return `landed: ${entry.into} ${moved}${time}${pushed}${failed}${entry.message ? ` (${entry.message})` : ''}`;
    }
    case 'failed':
      return check?.ok === false
        ? `failed: ${check.failed ?? ''}${time}\n${check.output ?? ''}`
        : `failed: ${entry.message ?? ''}`;
  }
}

/** `symbiote merge <branch>`: queued, merged, checked and landed, or one step of it; its exit code. */
export async function merge(argv: string[], ctx: CliContext): Promise<number> {
  const { values, positionals } = parse(
    {
      args: argv,
      allowPositionals: true,
      options: {
        into: { type: 'string' },
        strategy: { type: 'string' },
        land: { type: 'boolean', default: false },
        approve: { type: 'boolean', default: false },
        again: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    },
    MERGE_HELP,
  );
  if (values.help) {
    ctx.stdout(MERGE_HELP);
    return 0;
  }
  const [branch, ...extra] = positionals;
  if (!branch || extra.length > 0) throw new UsageError('one branch to merge', MERGE_HELP);
  const strategy = values.strategy as MergeStrategy | undefined;
  if (strategy !== undefined && !MERGE_STRATEGIES.includes(strategy)) {
    throw new UsageError(
      `--strategy: ${MERGE_STRATEGIES.join(' or ')}, got '${String(strategy)}'`,
      MERGE_HELP,
    );
  }
  const repo = await openRepo(ctx.cwd);
  let last = '';
  const print = (entry: MergeEntry) => {
    const line = mergeLine(entry);
    if (line !== last) ctx.stdout(`${line}\n`);
    last = line;
  };
  const cacheDir = defaultCacheDir(ctx.env);
  const merges = merger(repo, cacheDir, {
    onChange: print,
    mergerAgent: mergerFinder(repo.root, ctx.env),
    levels: levelsFinder(
      agentFinder(repo.root, ctx.env, cacheDir),
      codexFinder(repo.root, ctx.env),
    ),
  });
  const done = (entry: MergeEntry | undefined) => (entry?.state === 'landed' ? 0 : 1);
  try {
    const targets = await merges.targets(branch);
    if (values.approve || values.again !== undefined) {
      const entry = targets.entry;
      if (entry?.state !== 'needs-you' || !entry.resolution) {
        ctx.stderr(`symbiote merge: ${branch} has no resolution to review\n`);
        return 1;
      }
      const after = values.approve
        ? await merges.approve(entry.id)
        : await merges.requestChanges(entry.id, values.again ?? '');
      print(after);
      await merges.idle();
      const now = (await merges.list()).merges.find((e) => e.id === entry.id);
      if (now) print(now);
      return done(now);
    }
    if (values.land) {
      if (targets.entry?.state !== 'ready') {
        ctx.stderr(`symbiote merge: ${branch} has no merge waiting to land\n`);
        return 1;
      }
      const entry = await merges.land(targets.entry.id);
      print(entry);
      await merges.idle();
      return done(entry);
    }
    // A fast-forward its target could not take, asked again with a merge commit (V67).
    if (targets.entry?.behind && strategy === 'merge') {
      const entry = await merges.mergeCommit(targets.entry.id);
      print(entry);
      await merges.idle();
      const now = (await merges.list()).merges.find((e) => e.id === entry.id);
      if (now) print(now);
      return done(now);
    }
    const into = values.into ?? targets.into;
    if (!into) throw new UsageError('no default branch: name one with --into', MERGE_HELP);
    const queued = await merges.enqueue({ branch, into, ...(strategy ? { strategy } : {}) });
    print(queued);
    await merges.idle();
    // Another Symbiote process (\`symbiote view\`) merges in this repository: its progress, from
    // the queue.
    for (;;) {
      const entry = (await merges.list()).merges.find((e) => e.id === queued.id);
      if (!entry || !['queued', 'merging', 'resolving', 'checking'].includes(entry.state)) {
        if (entry) print(entry);
        return done(entry);
      }
      print(entry);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } catch (error) {
    if (error instanceof MergeRefused) {
      ctx.stderr(`symbiote merge: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
