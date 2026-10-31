// D2: prints each AI reviewer's top-level inline comment with what shows whether it was right and
// acted on: the thread's replies, and whether the lines it commented on changed before the merge.
// Usage: node spikes/d2-review-precision/ai-context.mjs --repos <dir> [--pr bitwarden#22260] [--json]
// Keys: `ai:<project>#<number>/<comment id>`.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: { repos: { type: 'string' }, pr: { type: 'string' }, json: { type: 'boolean', default: false } },
});
export const AI = /^(pullfrog\[bot\]|claude\[bot\]|copilot-pull-request-reviewer\[bot\]|Copilot|graphite-app\[bot\]|github-code-quality\[bot\])$/;
const git = (repo, ...args) => {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};

/** Whether lines around `line` of `path` at `from` changed by `to` (a hunk of the diff overlaps them). */
function changedAfter(repo, from, to, path, line) {
  if (!line) return null;
  const diff = git(repo, 'diff', '-U0', from, to, '--', path);
  if (diff === null) return null;
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (start <= line + 3 && start + Math.max(count, 1) - 1 >= line - 3) return true;
  }
  return false;
}

const out = [];
for (const file of readdirSync(join(here, 'data', 'forge')).sort()) {
  const [project, number] = file.replace('.json', '').split('-');
  if (values.pr && values.pr !== `${project}#${number}`) continue;
  const pr = JSON.parse(readFileSync(join(here, 'data', 'forge', file), 'utf8'));
  const repo = join(values.repos, project);
  for (const c of pr.inline.filter((c) => AI.test(c.user.login) && !c.replyTo)) {
    const replies = pr.inline.filter((r) => r.replyTo === c.id).map((r) => ({ user: r.user.login, body: r.body.replace(/<!--[\s\S]*$/, '').trim() }));
    out.push({
      key: `ai:${project}#${number}/${c.id}`,
      project,
      number: Number(number),
      reviewer: c.user.login,
      path: c.path,
      line: c.originalLine,
      commit: c.originalCommit,
      url: c.url,
      body: c.body.replace(/<!--[\s\S]*$/, '').trim(),
      hunk: c.diffHunk.split('\n').slice(-8).join('\n'),
      replies,
      changedBeforeMerge: changedAfter(repo, c.originalCommit, pr.headSha, c.path, c.originalLine),
    });
  }
}
for (const c of out) {
  if (values.json) {
    console.log(JSON.stringify(c));
    continue;
  }
  console.log(`\n=== ${c.key} · ${c.reviewer} · ${c.path}:${c.line} @ ${c.commit.slice(0, 8)} · lines changed before merge: ${c.changedBeforeMerge}`);
  console.log(c.body.slice(0, 1600));
  console.log(`--- hunk\n${c.hunk}`);
  for (const r of c.replies) console.log(`--- reply ${r.user}: ${r.body.slice(0, 400)}`);
}
