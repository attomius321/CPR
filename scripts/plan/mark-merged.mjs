#!/usr/bin/env node
// Marks merged work as merged in the docs, on `main`: each row of docs/PLAN.md's index whose
// branch is merged gets ✅, its plan's Status "merged into `main` on <date>", and its journal
// "Merged into main (<date>)." Symbiote's merger merges a workspace's branch after the person's
// Approve and leaves the docs as they were, so the index fell behind (70 rows on 2026-10-30,
// fixed by hand on chore/plan-index-status).
//
//   node scripts/plan/mark-merged.mjs            # lists what it would mark; changes nothing
//   node scripts/plan/mark-merged.mjs --write    # marks it; commit the result as "Docs: merged"
//   --into <ref>                                 # another target than main
//
// A row's branch is the one its plan's Status names (`on branch \`feature/x\``), else the first
// one its journal names. It is merged when its tip is in `main`; a branch that is gone, when a
// merge on `main`'s first-parent line names it (`Merge feature/x: …`, the merger's subject). Only
// rows that say the work is built, in review or merged change; a merged row that says "planned"
// or "measured" is listed for a person to read. A row already ✅ gets its plan's Status fixed
// when that still says "ready for review".
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const write = args.includes('--write');
const into = args.includes('--into') ? args[args.indexOf('--into') + 1] : 'main';

const git = (...command) =>
  execFileSync('git', command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (...command) => {
  try {
    return git(...command);
  } catch {
    return null;
  }
};

const docs = join(git('rev-parse', '--show-toplevel'), 'docs');
const indexPath = join(docs, 'PLAN.md');

/** A row's status that says the work waits only for its merge: the rows marked ✅. */
const WAITING = /ready for review|in review|^built\b|^merged\b/i;
/** Words in a plan's Status that say it waits for review. */
const REVIEW = /(?:ready\s+for|in)\s+review/i;
/** The first branch a text names: "on branch `feature/x`", "(2026-10-29, branch `fix/y`)". */
const BRANCH = /branch\s+`([^`\s]+)`/;

const firstParent = git('rev-list', '--first-parent', into).split('\n');
const merges = git('log', '--first-parent', '--merges', '--format=%H %cs %s', into)
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [sha, date, ...subject] = line.split(' ');
    return { sha, date, subject: subject.join(' ') };
  });

/**
 * When `branch` reached `into`: the date of the first first-parent commit holding its tip; for a
 * branch that is gone, or that moved on after a merge, the newest merge naming it, with `later`
 * the branch's commits since that are not in `into`. Null when it never reached `into`.
 */
function mergedOn(branch) {
  const tip =
    tryGit('rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`) ??
    tryGit('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}^{commit}`);
  if (tip && tryGit('merge-base', '--is-ancestor', tip, into) !== null) {
    const after = new Set(
      (tryGit('rev-list', '--ancestry-path', `${tip}..${into}`) ?? '').split('\n'),
    );
    after.add(tip);
    // The first-parent line runs newest first: the last one holding the tip is where it landed.
    const landed = firstParent.findLast((sha) => after.has(sha));
    return landed ? { date: git('show', '-s', '--format=%cs', landed), later: 0 } : null;
  }
  const named = merges.find(
    (m) =>
      m.subject.startsWith(`Merge ${branch}:`) ||
      m.subject === `Merge ${branch}` ||
      m.subject.startsWith(`Merge branch '${branch}'`),
  );
  if (!named) return null;
  const later = tip ? Number(git('rev-list', '--count', `${into}..${tip}`)) : 0;
  return { date: named.date, later };
}

/** Where a plan's Status paragraph is: from `**Status:**` to the first blank line. */
function statusAt(text) {
  const start = text.indexOf('**Status:**');
  if (start < 0) return null;
  const end = text.indexOf('\n\n', start);
  return { start, end: end < 0 ? text.length : end };
}

/** Whether a Status already says its own work is merged (not another branch's, in passing). */
const saysMerged = (status) =>
  /^\*\*Status:\*\*\s+merged\b/i.test(status) ||
  /merged into `main` on \d{4}-\d{2}-\d{2}/.test(status);

/** The Status marked merged on `date`, in the words chore/plan-index-status used. */
function markStatus(status, date) {
  const merged = `merged into \`main\` on ${date}`;
  const dated = /(?:built,\s+)?(?:ready\s+for|in)\s+review\s+\((\d{4}-\d{2}-\d{2})\)/i;
  // "built, ready for review (D), on branch …" → "merged into `main` on M (built D), on branch …"
  if (dated.test(status)) return status.replace(dated, `${merged} (built $1)`);
  if (REVIEW.test(status)) return status.replace(REVIEW, merged);
  return status.replace(/^\*\*Status:\*\*\s*/, `**Status:** ${merged}; `);
}

/** The journal with "Merged into main (<date>)." at its end, unless its last entry has it. */
function markJournal(text, date) {
  const last = text.lastIndexOf('\n## ');
  if (/^Merged into main/m.test(text.slice(Math.max(last, 0)))) return null;
  return `${text.replace(/\s*$/, '')}\n\nMerged into main (${date}).\n`;
}

const lines = readFileSync(indexPath, 'utf8').split('\n');
const edits = new Map(); // path → its new text
const marked = [];
const statuses = [];
const notes = [];
const current = (path) => edits.get(path) ?? readFileSync(path, 'utf8');

/** Marks the plan's Status merged on `date`; whether it changed. */
function editStatus(path, date) {
  const text = current(path);
  const at = statusAt(text);
  if (!at) return false;
  const status = text.slice(at.start, at.end);
  if (saysMerged(status)) return false;
  edits.set(path, text.slice(0, at.start) + markStatus(status, date) + text.slice(at.end));
  return true;
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.startsWith('| ') || line.startsWith('| ID ')) continue;
  const cells = line.split(/(?<!\\)\|/).slice(1, -1);
  if (cells.length < 5) continue;
  const status = cells[2].trim();
  const done = status.startsWith('✅');

  const id = cells[0].trim().replace(/^\[([^\]]+)\].*$/, '$1');
  const planLink = cells[0].match(/\(plan\/([^)#]+\.md)(#[^)]*)?\)/);
  const journalLink = cells[4].match(/\(journal\/([^)#]+\.md)(#[^)]*)?\)/);
  // A plan's Status and a journal's end are the row's own only when it links the whole file.
  const planPath = planLink && !planLink[2] ? join(docs, 'plan', planLink[1]) : null;
  const journalPath = journalLink ? join(docs, 'journal', journalLink[1]) : null;
  const planText = planPath && existsSync(planPath) ? current(planPath) : null;
  const at = planText ? statusAt(planText) : null;
  const planStatus = at ? planText.slice(at.start, at.end) : null;
  // A row marked by hand needs only its plan's Status, and only when that fell behind.
  if (done && !(planStatus && REVIEW.test(planStatus) && !saysMerged(planStatus))) continue;

  const journalText = journalPath && existsSync(journalPath) ? current(journalPath) : null;
  const branch = planStatus?.match(BRANCH)?.[1] ?? journalText?.match(BRANCH)?.[1];
  if (!branch || branch === into) continue;
  const merged = mergedOn(branch);
  if (!merged) continue;
  const { date, later } = merged;
  if (later > 0) {
    const commits = later === 1 ? '1 later commit is' : `${later} later commits are`;
    notes.push(`${id}  ${branch}  merged ${date}, but ${commits} not in ${into}: left as it is`);
    continue;
  }

  if (done) {
    if (editStatus(planPath, date)) statuses.push(`${id}  plan/${planLink[1]}  merged ${date}`);
    continue;
  }
  if (!WAITING.test(status)) {
    notes.push(`${id}  ${branch}  merged ${date}, but its row says "${status}": left as it is`);
    continue;
  }
  lines[i] = `|${[cells[0], cells[1], ' ✅ ', ...cells.slice(3)].join('|')}|`;
  marked.push(`${id}  ${branch}  merged ${date}`);
  if (planPath && planStatus) editStatus(planPath, date);
  if (journalText && !journalLink[2]) {
    const next = markJournal(journalText, date);
    if (next !== null) edits.set(journalPath, next);
  }
}

const verb = write ? 'marked' : 'would mark';
if (marked.length + statuses.length === 0)
  console.log('Nothing to mark: every merged row says ✅.');
for (const line of marked) console.log(`${verb}  ${line}`);
for (const line of statuses) console.log(`${verb} Status  ${line}`);
for (const line of notes) console.log(`note  ${line}`);

if (marked.length + statuses.length > 0) {
  const what = `${marked.length} rows, ${statuses.length} more Status lines`;
  if (write) {
    writeFileSync(indexPath, lines.join('\n'));
    for (const [path, text] of edits) writeFileSync(path, text);
    console.log(`\n${what} marked. Commit them on ${into} as "Docs: merged".`);
  } else {
    console.log(`\n${what} to mark: run again with --write.`);
  }
}
