// AR1: what each kind of message cost. Each request in a workspace's transcripts is charged to the
// last prompt before it (the start prompt, the person's message by its label, a background task's
// notification, Hive's or a verdict's message). Labels: rules below plus a hand list (scope grown
// after a build was reported, read in coverage/activity-review/later.txt).
// Usage: node phases.mjs <load output.json> <transcripts.json> [exclude...]
import { readFileSync } from 'node:fs';
const [file, tfile, ...rest] = process.argv.slice(2);
const cutoff = rest.find((x) => /^\d{4}-/.test(x)) ?? '9999';
const exclude = rest.filter((x) => x !== cutoff);
const { workspaces } = JSON.parse(readFileSync(file, 'utf8'));
const transcripts = JSON.parse(readFileSync(tfile, 'utf8'));

// The person's later asks that grew a workspace's scope after its build was reported (hand list).
const SCOPE = [
  ['feature/extend-view-with-wrapper', /^(i would also like a way to make the install faster|on linux|i had to install it manually|1\. Write here on this branch)/i],
  ['feature/hive-honeycomb-background', /^(Can you make the font sizes smaller|Please check first how VSCode|Yes, we should change everything|Good, go for it)/i],
  ['feature/hive-mode-setting', /^(\[Image #1\] should me more like this|YES\. Do it|Also change the icon)/i],
  ['feature/hive-tentacles', /^(I like the Carnage one|But remake the plan|And the tendrils|Turning Hive on - remove|Go$)/i],
  ['feature/review-merge-layout', /^Ok, need one more thing from you/i],
  ['feature/skills-page-revamp', /^Also, i want a Open in VS Code/i],
  ['feature/tauri-integration', /^Yes, plan go with Electron\. Also/i],
];
export function label(w, p, planReplyAt) {
  const t = p.text.trim();
  if (/^<agent-message/.test(t)) return 'subagent hand-back';
  if (/^(Bro\.\.\.\s*)?<pasted_content/.test(t) && /\bfailed\b|FAIL|Error/.test(t)) return 'merge check failure, pasted';
  if (SCOPE.some(([b, re]) => b === w.branch && re.test(t))) return 'scope grown after a build';
  if (/after (you|the) (consolidate the )?plan|make the plan,? and start|you have my bel?s+ing to start/i.test(t)) return 'go on after the plan';
  if (/^(wyd\??|continue|you still work\??|what have you done ?\??|what are you monitoring\??|ok\.\.\.continue)$/i.test(t)) return 'status or continue';
  if (/merge (main|it) |merge main into|resolve conflicts|solve conflicts|merged into main already/i.test(t)) return 'merge or conflicts';
  if (p.at === planReplyAt) return 'answer to the plan';
  return 'other message';
}

const totals = {};
const per = {};
const messages = {};
let all = 0;
for (const w of workspaces) {
  if (exclude.includes(w.branch) || !w.transcript) continue;
  const reqs = transcripts[w.worktreeDir]?.requests ?? [];
  const firstReport = w.reportTexts[0]?.at;
  const planReplyAt = w.planFirst && firstReport ? w.personMsgs.find((p) => p.at > firstReport)?.at : null;
  // Every prompt of the thread, labelled.
  const prompts = [];
  for (const p of w.personMsgs) {
    const l = label(w, p, planReplyAt);
    prompts.push({ at: p.at, label: l });
    messages[l] = (messages[l] ?? 0) + 1;
  }
  for (const t of w.turns) if (t.from !== 'person') prompts.push({ at: t.at, label: t.from === 'start' ? 'start prompt, to the first report' : t.from === 'task' ? 'a background task ended' : t.from });
  prompts.sort((a, b) => (a.at < b.at ? -1 : 1));
  for (const [at, cost] of reqs.filter(([at]) => at <= cutoff)) {
    const p = [...prompts].reverse().find((x) => x.at <= at);
    const l = p?.label ?? 'before any recorded prompt';
    totals[l] = (totals[l] ?? 0) + cost;
    (per[l] ??= new Set()).add(w.branch);
    all += cost;
  }
}
console.log(`| What the work answered | the person's messages | API-equivalent $ | share | workspaces |\n|---|---|---|---|---|`);
for (const [l, c] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(`| ${l} | ${messages[l] ?? '–'} | ${c.toFixed(0)} | ${Math.round((100 * c) / all)} % | ${per[l].size} |`);
console.log(`| all | ${all.toFixed(0)} | | |`);
