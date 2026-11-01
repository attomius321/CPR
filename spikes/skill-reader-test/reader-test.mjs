// Reader test for the milestone, regression-check and viewer-check skills and CLAUDE.md:
// a fresh `claude -p` (no tools, no settings) reads only the docs and answers seven questions
// in each of four situations. Usage:
//   node spikes/skill-reader-test/reader-test.mjs <label> <docs: "main" or a checkout path> [runs] [model]
// Answers go to out/<label>.json beside this file. One situation's answers cost about $0.15 with
// Opus; the default, 2 runs of the 4 situations, about $1.20.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [label, source, runsArg, model = 'opus'] = process.argv.slice(2);
const runs = Number(runsArg ?? 2);
const repo = process.env.SYMBIOTE_REPO ?? join(here, '../..');
const FILES = [
  'CLAUDE.md',
  '.claude/skills/milestone/SKILL.md',
  '.claude/skills/regression-check/SKILL.md',
  '.claude/skills/viewer-check/SKILL.md',
];
const read = (path) =>
  source === 'main'
    ? execFileSync('git', ['-C', repo, 'show', `main:${path}`], { encoding: 'utf8' })
    : readFileSync(join(source, path), 'utf8');
const docs = FILES.map((path) => `<file path="${path}">\n${read(path)}\n</file>`).join('\n\n');

const PLAN_FIRST =
  "First write a plan: what you will change and how you will check it, then stop and wait for the person's OK before changing anything.";
const PLAN_DIRECT = "Plan it, build it and check it as the project's own instructions say.";
const HIVE =
  "Hive drives this workspace. When you end a turn with commits, Symbiote runs the check on the branch's tip (`pnpm install --frozen-lockfile`, then `pnpm check`, then `pnpm build`, then `pnpm test:e2e`) and sends you its failures; once the check passes, a reviewer runs your change in a throwaway copy and sends you the tests it proves defects with. That is up to 3 rounds; once both pass, the person lands the branch. Symbiote runs the whole check after each of your turns: before you end one, run the tests your change touches, not the whole check. Commit everything before you end a turn, end a turn only when the work is done or you need the person, and never push, merge or switch branches.";

/** The start prompt Symbiote writes for a feature workspace (prompts.ts, `startPrompt`). */
function startPrompt(plan, hive) {
  const branch = 'feature/sidenav-search';
  return [
    `You are starting a new feature in this repository. Symbiote has already made its branch and its worktree: you are in that worktree now, /home/anton/projects/Symbiote.worktrees/feature-sidenav-search, with the branch ${branch} (started from main) checked out. Work only here, on ${branch}. Do not create another branch or worktree, and do not switch branches (no \`git checkout -b\`, \`git switch\`, \`git worktree add\` or EnterWorktree), even where the project's instructions or your tools say new work gets one: this branch is the one the person reviews and merges.`,
    '',
    "The person's brief:",
    '',
    'Build V88: a search box in the sidenav that filters the workspaces by name.',
    '',
    plan,
    '',
    `Commit your work on ${branch} as you go. Push only if the project's instructions say so. When it is ready, say so: the person reviews the branch in Symbiote, and an approved commit is merged into main.`,
    '',
    ...(hive ? [hive, ''] : []),
    `This feature's record: symbiote/workspaces/${branch}.json. Reviews of the branch will be in symbiote/reviews/${branch}/; symbiote/AGENTS.md says how to act on one. Never edit anything in symbiote/.`,
  ].join('\n');
}

const SITUATIONS = {
  checkout:
    'You are Claude Code in the person\'s own checkout of the Symbiote repository, /home/anton/projects/Symbiote, on branch `main`. Symbiote did not start you: there is no start prompt, and no record for this branch in symbiote/workspaces/. The person writes: "Plan V88: a search box in the sidenav that filters the workspaces by name. I\'ll read the plan, then you build it." Later they say the plan is OK, and you build it.',
  'plan-first':
    'Symbiote started you in a workspace. Its record, symbiote/workspaces/feature/sidenav-search.json, has "kind": "feature", "planFirst": true and no "hive". Your start prompt was:\n\n' +
    startPrompt(PLAN_FIRST),
  direct:
    'Symbiote started you in a workspace. Its record, symbiote/workspaces/feature/sidenav-search.json, has "kind": "feature", "planFirst": false and no "hive". Your start prompt was:\n\n' +
    startPrompt(PLAN_DIRECT),
  hive:
    'Symbiote started you in a workspace while Hive mode was on. Its record, symbiote/workspaces/feature/sidenav-search.json, has "kind": "feature", "planFirst": true and "hive": true. Your start prompt was:\n\n' +
    startPrompt(PLAN_FIRST, HIVE),
};

const QUESTIONS = `Answer each question with one letter and one short sentence why, from what the documents and the situation say.

q1. Where do you commit this work?
  A. A new branch \`milestone/<id>-<slug>\` from \`main\`
  B. The branch you are on now, which Symbiote made for this work
  C. A new branch \`feature/<slug>\` from \`main\`
  D. Other (say what)

q2. You have written the plan, \`docs/plan/<id>-<slug>.md\`. When do you commit it?
  A. Now, as "Plan <ID>: …", and push it
  B. Not yet: give the plan in your final message and stop; commit it first thing after the person's OK
  C. Now, as "Plan <ID>: …", without pushing
  D. Other (say what)

q3. Do you push the branch's commits?
  A. Yes, as you go (\`git push -u origin <branch>\`)
  B. No, never
  C. Only once the work is finished
  D. Other (say what)

q4. The work is done and checked. How does it get into \`main\`?
  A. You ask the person; on their yes you merge it yourself (\`git merge --no-ff\`), run the checks on \`main\` and push it
  B. You say it is ready; the person reviews the branch in Symbiote, and their Approve has Symbiote's merger merge it (the merger runs the checks and pushes \`main\`)
  C. You say it is done; Hive's check and reviewer pass it, and it lands from the workspace's Review tab; you merge nothing
  D. Other (say what)

q5. After it is merged into \`main\`, who marks its row in docs/PLAN.md ✅ and its plan's Status "merged into main"?
  A. You, right after the merge, in a "Docs: <ID> merged" commit on \`main\`
  B. You, on your branch, before it is merged
  C. Not you: it is done later on \`main\`, for every merged branch at once
  D. Other (say what)

q6. While working you find a bug that has nothing to do with this work. What do you do?
  A. Fix it on a new \`fix/<slug>\` branch from \`main\`, report it, and merge it only with the person's OK
  B. Fix it on this branch
  C. Do not fix it here: report it in your final message and suggest its own workspace (a fix) to the person
  D. Other (say what)

q7. Your change touches packages/core, so you need \`main\`'s build for regression-check's before/after. How do you get it?
  A. \`git worktree add --detach /tmp/symbiote-base origin/main\`, then install and build there
  B. \`git archive\` of \`main\` into a folder of your own, then install and build there
  C. Check out \`main\` in this folder, build it, and switch back
  D. Other (say what)`;

/** The right letters per situation; a list where more than one is right. */
const EXPECTED = {
  checkout: { q1: 'A', q2: 'A', q3: 'A', q4: 'A', q5: 'A', q6: 'A', q7: 'AB' },
  'plan-first': { q1: 'B', q2: 'B', q3: 'A', q4: 'B', q5: 'C', q6: 'C', q7: 'B' },
  direct: { q1: 'B', q2: 'A', q3: 'A', q4: 'B', q5: 'C', q6: 'C', q7: 'B' },
  hive: { q1: 'B', q2: 'B', q3: 'B', q4: 'C', q5: 'C', q6: 'C', q7: 'B' },
};

const answer = {
  type: 'object',
  properties: { choice: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, why: { type: 'string' } },
  required: ['choice', 'why'],
};
const SCHEMA = JSON.stringify({
  type: 'object',
  properties: Object.fromEntries(
    ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'].map((q) => [q, answer]),
  ),
  required: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'],
});

function ask(situation) {
  const prompt = `These are a repository's instructions for its agents:\n\n${docs}\n\nThe situation:\n\n${SITUATIONS[situation]}\n\n${QUESTIONS}`;
  return new Promise((resolve) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--tools',
        '',
        '--setting-sources',
        '',
        '--no-session-persistence',
        '--model',
        model,
        '--output-format',
        'json',
        '--json-schema',
        SCHEMA,
        '--max-budget-usd',
        '1',
      ],
      { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', () => {
      try {
        const result = JSON.parse(out);
        resolve({ answers: result.structured_output, cost: result.total_cost_usd });
      } catch {
        resolve({ error: (err || out).slice(0, 500) });
      }
    });
    child.stdin.end(prompt);
  });
}

const jobs = [];
for (const situation of Object.keys(SITUATIONS)) {
  for (let run = 1; run <= runs; run++)
    jobs.push(ask(situation).then((r) => ({ situation, run, ...r })));
}
const results = await Promise.all(jobs);
mkdirSync(join(here, 'out'), { recursive: true });
writeFileSync(join(here, 'out', `${label}.json`), JSON.stringify(results, null, 2));

let right = 0;
let total = 0;
let cost = 0;
for (const r of results) {
  if (r.error) {
    console.log(`${r.situation} #${r.run}: ERROR ${r.error}`);
    continue;
  }
  cost += r.cost ?? 0;
  const row = Object.entries(EXPECTED[r.situation]).map(([q, ok]) => {
    const got = r.answers[q].choice;
    total++;
    if (ok.includes(got)) right++;
    return ok.includes(got) ? `${q} ${got}` : `${q} ${got}✗(${ok})`;
  });
  console.log(`${r.situation.padEnd(10)} #${r.run}: ${row.join('  ')}`);
}
console.log(`${label}: ${right}/${total} right, $${cost.toFixed(2)}`);
