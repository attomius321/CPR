// Hive's reviewing step (HV3): the running review of a checked commit, watched, and what it
// found sent back.
import { randomBytes } from 'node:crypto';
import { mkdir, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { git, mergeBase, type HiveReview } from '@symbiote/core';
import { hiveTestsDir, readHive, type HiveFile } from './hive-record.js';
import {
  findingsText,
  installCommands,
  readReviewerConfig,
  REVIEWER_EFFORT,
  REVIEWER_MODEL,
  reviewPrompt,
  startReview,
  type ReviewOutcome,
} from './hive-review.js';
import { hiveLogPath, hiveLogs } from './hive-live.js';
import { projectCheck } from './merge-config.js';
import { readPrompts } from './prompts.js';
import { fillPrompt } from './prompt-text.js';
import { MAX_BRIEF } from './workspace-brief.js';
import type { ReviewPlace } from './reviews.js';
import { readThreadEnd } from './thread.js';
import { symbioteFolder } from './workspace-record.js';
import type { Stop, Reviewing, HiveContext } from './hive-context.js';
import { type HiveRoundSteps, plural, slug } from './hive-round.js';

/** The reviewing step's functions. */
export function hiveReviewing(
  ctx: Pick<
    HiveContext,
    'cacheDir' | 'closed' | 'copiesOf' | 'repo' | 'reviewer' | 'reviews' | 'root' | 'workspaces'
  >,
  {
    act,
    event,
    landingOf,
    leaveTo,
    moveTo,
    nextRound,
    paced,
    roundsAgain,
    save,
    stamp,
    turnOf,
  }: Pick<
    HiveRoundSteps,
    | 'act'
    | 'event'
    | 'landingOf'
    | 'leaveTo'
    | 'moveTo'
    | 'nextRound'
    | 'paced'
    | 'roundsAgain'
    | 'save'
    | 'stamp'
    | 'turnOf'
  >,
) {
  const { cacheDir, copiesOf, repo, reviewer, reviews, root, workspaces } = ctx;
  /**
   * The running review of the commit the check passed on (HV3, decisions 674–679): its copy, the
   * reviewer and the rerun run beside the tick, as a check does. A commit reviewed and approved
   * already goes to landing as it is (decision 716).
   */
  async function reviewing(where: ReviewPlace, given: HiveFile): Promise<void> {
    let record = given;
    const summary = await workspaces.summaryOf(record.branch);
    if (!summary) return;
    const landing = await landingOf(record.branch, summary);
    if (landing) return leaveTo(where, record, landing);
    const tip = record.checked ?? summary.tip;
    if (!tip) return;
    const approved = record.reviews.findLast((r) => r.at === tip);
    if (approved?.verdict === 'approved') {
      await moveTo(where, record, { step: 'landing', checked: tip }, 'landing', {
        reviewed: approved.round,
      });
      return;
    }
    // The running reviewer is an agent: through the gate (HV5, decision 796).
    const gated = await paced(where, record);
    if (!gated) return;
    record = gated;
    const [claude, confine] = await Promise.all([reviewer.claude(), reviewer.confine()]);
    const check = await projectCheck(repo, root, tip).catch(() => null);
    const passed = record.checks.findLast((c) => c.at === tip && c.ok);
    const from = summary.from ? await mergeBase(repo, tip, summary.from).catch(() => null) : null;
    const base = from ?? summary.base;
    const diff = await git(repo.root, ['diff', base, tip]).catch(() => '');
    const last = record.reviews.at(-1);
    const thread = await readThreadEnd(symbioteFolder(where), record.branch);
    const report = thread.findLast((e) => e.kind === 'report');
    const installs = check ? installCommands(check.commands) : [];
    const before =
      last && last.verdict === 'changes' && last.round < record.round
        ? {
            round: last.round,
            findings: last.findings.filter((f) => f.kept),
            ...(report?.kind === 'report' ? { report: report.text } : {}),
          }
        : undefined;
    const prompt = reviewPrompt({
      brief: summary.brief,
      branch: record.branch,
      base,
      tip,
      diff,
      check: passed && check ? { ok: true, ms: passed.ms, commands: check.commands } : null,
      installs,
      ...(before ? { before } : {}),
    });
    const config = readReviewerConfig(root);
    const model = config.model ?? REVIEWER_MODEL;
    const effort = config.effort ?? REVIEWER_EFFORT;
    const id = `${stamp().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
    const at = stamp();
    // Its log beside the record (decisions 695, 696): what it runs, the reviewer's stream.
    const steps = hiveLogs(where, record.branch).of(id);
    let marked: Promise<void> = Promise.resolve();
    const running: Reviewing = {
      run: startReview(
        {
          source: repo.root,
          tip,
          round: record.round,
          folder: join(copiesOf(record.branch), id),
          log: join(cacheDir, 'hive-reviews', repo.id, `${slug(record.branch)}-${id}.jsonl`),
          installs,
          prompt,
          instructions: readPrompts(root).text['hive.reviewer'],
          model,
          effort,
        },
        {
          claude,
          confine,
          ...(reviewer.run ? { run: reviewer.run } : {}),
          ...(reviewer.spawn ? { spawn: reviewer.spawn } : {}),
          ...(reviewer.reviewerMs ? { reviewerMs: reviewer.reviewerMs } : {}),
          ...(reviewer.rerunMs ? { rerunMs: reviewer.rerunMs } : {}),
          steps,
          // Each process's leader in the record, for a new runner to end it (decision 655).
          onPid: (pid) => {
            marked = marked.then(async () => {
              const fresh = await readHive(where, record.branch);
              if (fresh?.step !== 'reviewing' || reviews.get(record.branch) !== running) return;
              const next: HiveFile = {
                ...fresh,
                review: { pid, started: at, at: tip, log: id },
              };
              delete next.interrupted;
              await save(where, next);
            });
          },
        },
      ),
    };
    reviews.set(record.branch, running);
    await event(where, record.branch, 'review-started', {
      round: record.round,
      commit: tip,
      model,
      effort,
    });
    return act(
      record.branch,
      running.run.done.then(async (outcome) => {
        await marked;
        if (reviews.get(record.branch) === running) reviews.delete(record.branch);
        // The branch's folder too, once it holds no other review's copy.
        await rmdir(copiesOf(record.branch)).catch(() => undefined);
        if (ctx.closed) return;
        if (running.stopped || !outcome) {
          return stoppedReview(where, record.branch, running.stopped ?? 'close');
        }
        return reviewed(where, record.branch, outcome, id);
      }),
    );
  }

  /** A review's end (decisions 674, 679): landing, the proven tests to the writer, or again. */
  async function reviewed(where: ReviewPlace, branch: string, outcome: ReviewOutcome, log: string) {
    const fresh = await readHive(where, branch);
    if (!fresh) return;
    // Its log, once anything was written in it (an unavailable reviewer writes nothing).
    const logged = await stat(hiveLogPath(where, branch, log)).then(
      () => true,
      () => false,
    );
    const review: HiveReview = { ...outcome.review, ...(logged ? { log } : {}) };
    const after: HiveFile = { ...fresh, reviews: [...fresh.reviews, review] };
    delete after.review;
    await save(where, after);
    const kept = review.findings.filter((f) => f.kept);
    await event(where, branch, 'review', {
      round: review.round,
      verdict: review.verdict,
      kept: kept.length,
      dropped: review.findings.length - kept.length,
      ms: review.ms,
      ...(review.cost !== undefined ? { cost: review.cost } : {}),
      ...(review.error ? { error: review.error } : {}),
    });
    // Merged or queued while it ran: its findings stay in the record, nothing goes to the writer.
    const landing = await landingOf(branch);
    if (landing) return leaveTo(where, after, landing);
    if (review.verdict === 'approved') {
      await moveTo(where, after, { step: 'landing', checked: review.at }, 'landing');
      return;
    }
    if (review.verdict === 'unavailable') {
      const note = `not reviewed: ${review.error ?? 'the reviewer could not run'}`;
      await moveTo(where, after, { step: 'landing', checked: review.at, note }, 'landing', {
        note,
      });
      return;
    }
    if (review.verdict === 'failed') {
      const failures = after.reviews.filter(
        (r) => r.round === review.round && r.at === review.at && r.verdict === 'failed',
      );
      if (failures.length < 2) {
        // Once more, at the next look.
        await moveTo(where, after, { step: 'reviewing' }, null);
        return;
      }
      const note = `the running review failed twice: ${review.error ?? 'no answer'}`;
      await moveTo(where, after, { step: 'landing', checked: review.at, note }, 'landing', {
        note,
      });
      return;
    }
    // Defects proven: their tests kept beside the record, and sent to the writer.
    const folder = hiveTestsDir(where, branch, review.round);
    for (const [path, text] of outcome.files) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await writeFile(join(folder, path), text);
    }
    const values = {
      count: plural(kept.length, 'defect'),
      branch,
      at: review.at.slice(0, 7),
      round: String(review.round),
      rounds: String(after.rounds),
      folder,
    };
    const template = readPrompts(root).text['hive.review'];
    const room = MAX_BRIEF - fillPrompt(template, { ...values, findings: '' }).length - 200;
    await nextRound(
      where,
      after,
      'hive.review',
      { ...values, findings: findingsText(review.findings, outcome.files, folder, room) },
      (rounds) => `the reviewer proved defects in ${rounds} rounds`,
    );
  }

  /**
   * A review stopped before its end: no result, its copies gone; the step kept, the person's, or
   * the branch's landing.
   */
  async function stoppedReview(where: ReviewPlace, branch: string, why: Stop): Promise<void> {
    const record = await readHive(where, branch);
    if (!record || record.step === 'landed') return;
    if (why === 'merged' || why === 'queued') {
      return leaveTo(where, record, why, { stopped: 'review' });
    }
    if (why === 'took-over') {
      const turn = await turnOf(where, branch, record.since);
      await roundsAgain(where, record, turn?.prompt?.at ?? stamp());
      return;
    }
    const kept: HiveFile = { ...record, interrupted: true };
    delete kept.review;
    await save(where, kept);
    await event(where, branch, 'review-stopped', { why });
  }

  /**
   * While a review runs: the branch's landing stops it (decision 717), as does a message the writer
   * got (the person took over).
   */
  async function watchReview(where: ReviewPlace, record: HiveFile): Promise<void> {
    const running = reviews.get(record.branch);
    if (!running || running.stopped) return;
    const landing = await landingOf(record.branch);
    if (reviews.get(record.branch) !== running || running.stopped) return;
    if (landing) {
      running.stopped = landing;
      running.run.stop();
      return;
    }
    const thread = await readThreadEnd(symbioteFolder(where), record.branch);
    const prompt = thread.findLast((e) => e.kind === 'prompt');
    if (prompt && prompt.at > record.since) {
      running.stopped = 'took-over';
      running.run.stop();
    }
  }

  return { reviewing, watchReview };
}

export type HiveReviewSteps = ReturnType<typeof hiveReviewing>;
