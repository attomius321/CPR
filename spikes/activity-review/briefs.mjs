// AR1: briefs against results, per workspace: the plan's answer, work before the OK, the person's
// later asks, approvals while the agent's own background run was pending, "not verified" in reports.
// Reads load.mjs's output and the raw activity (for edits before the OK). Prints JSON lines.
// Usage: node briefs.mjs <load output.json> <repo root> [exclude...]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [file, repo, ...exclude] = process.argv.slice(2);
const { workspaces } = JSON.parse(readFileSync(file, 'utf8'));
const BARE = /^\s*(ok(ay)?|yes|go|go ahead|continue|do it|proceed|approved?|lgtm|sounds good|perfect|great|ok,? go( for it)?|yes,? go|ok,? (do it|proceed|continue))[\s.!,]*(go[.!]*)?\s*$/i;
const ANSWERS = /^\s*(\d+[.)]\s*(yes|no|ok|recommended|agreed?|a|b|c)\b[^\n]{0,40}\s*)+(go[.!]*)?\s*$/i;
for (const w of workspaces) {
  if (exclude.includes(w.branch) || !w.first) continue;
  const reports = w.reportTexts;
  const persons = w.personMsgs;
  const firstReport = reports[0];
  const reply = firstReport ? persons.find((p) => p.at > firstReport.at) : null;
  // Edits to the worktree and commits before the person's first reply (plan first kept?).
  let editsBefore = null;
  let commitsBefore = null;
  const actFile = join(repo, 'symbiote', 'activity', `${w.branch}.jsonl`);
  if (w.planFirst && w.hasCalls && existsSync(actFile) && reply) {
    const acts = readFileSync(actFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a.phase === 'start' && a.at < reply.at);
    const wt = w.branch.replace('/', '-');
    editsBefore = acts.filter((a) => ['Edit', 'Write'].includes(a.tool) && String(a.input ?? a.subject ?? '').includes(`Symbiote.worktrees/${wt}/`) && !/\/(docs\/plan|docs\/journal|coverage)\//.test(String(a.input ?? a.subject))).length;
    commitsBefore = acts.filter((a) => a.tool === 'Bash' && /\bgit commit\b/.test(String(a.input ?? a.subject ?? ''))).length;
  }
  // Approvals while a background run the agent started was still pending.
  const pendingAtApprove = w.verdicts.filter((v) => v.event === 'approve').filter((v) => w.suiteRuns.some((s) => s.ms != null && s.at < v.at && new Date(s.at).getTime() + s.ms > new Date(v.at).getTime())).length;
  const notVerified = reports.filter((r) => /not verified|did not verify|didn't verify|not checked|could not (check|verify|run)|unverified/i.test(r.text)).length;
  console.log(JSON.stringify({
    branch: w.branch, kind: w.kind, planFirst: w.planFirst, hasCalls: w.hasCalls, reports: reports.length,
    person: persons.length,
    reply: reply ? reply.text.replace(/\s+/g, ' ').slice(0, 300) : null,
    replyKind: !reply ? null : BARE.test(reply.text) ? 'bare-ok' : ANSWERS.test(reply.text) ? 'answers' : 'more',
    replyMin: reply ? +((new Date(reply.at) - new Date(firstReport.at)) / 6e4).toFixed(1) : null,
    editsBefore, commitsBefore, pendingAtApprove, notVerified,
    later: persons.filter((p) => !reply || p.at > reply.at).map((p) => p.text.replace(/\s+/g, ' ').slice(0, 220)),
  }));
}
