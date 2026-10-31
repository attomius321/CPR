// D2: draws the pull requests to analyze, from git alone (no API).
// Usage: node spikes/d2-review-precision/select.mjs --repos <dir> [--per 17] [--fetch 40]
// Population: every pull request merged into the default branch from 2026-08-01 to 2026-09-30
// (first-parent subjects `… (#N)` or `Merge pull request #N`). Left out, and counted: automation
// authors, and changes with no file Symbiote reads. The rest is shuffled with a fixed seed; the
// first --per are the sample, the order after them is kept for the stopping rule.
// --fetch <n> fetches refs/pull/N/head of the first n in the shuffled order into refs/pr/N.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    repos: { type: 'string' },
    per: { type: 'string', default: '17' },
    fetch: { type: 'string', default: '0' },
  },
});
if (!values.repos) throw new Error('usage: select.mjs --repos <dir> [--per 17] [--fetch 40]');

export const PROJECTS = {
  zod: { github: 'colinhacks/zod', branch: 'main', plugins: [] },
  vite: { github: 'vitejs/vite', branch: 'main', plugins: [] },
  bitwarden: { github: 'bitwarden/clients', branch: 'main', plugins: ['angular'] },
};
const SINCE = '2026-08-01T00:00:00Z';
const UNTIL = '2026-10-01T00:00:00Z';
const SEED = 20261031;
// Automation (dependency, version and deploy bots); pull requests written by AI agents stay.
const BOT = /renovate|dependabot|github-actions|bw-ghapp|bre-deploy/i;
// What Symbiote reads, minus what it lists as ignored (design.md §7).
const READ = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css|scss)$/;
const IGNORED = /(^|\/)(fixtures|__fixtures__|__snapshots__|generated)\/|\.generated\.|\.d\.[mc]?ts$|\.min\.js$/;

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

// mulberry32: a small seeded generator, so the draw can be made again.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, seed) {
  const next = random(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const selection = { since: SINCE, until: UNTIL, seed: SEED, per: Number(values.per), projects: {} };
for (const [name, project] of Object.entries(PROJECTS)) {
  const repo = join(values.repos, name);
  const log = git(
    repo,
    'log',
    '--first-parent',
    `--since=${SINCE}`,
    `--until=${UNTIL}`,
    '--format=%H%x09%P%x09%an%x09%ae%x09%cI%x09%s',
    `origin/${project.branch}`,
  );
  const merged = [];
  let unnumbered = 0;
  for (const line of log.split('\n').filter(Boolean)) {
    const [sha, parents, author, email, date, subject] = line.split('\t');
    const number = /\(#(\d+)\)\s*$/.exec(subject)?.[1] ?? /^Merge pull request #(\d+)/.exec(subject)?.[1];
    if (!number) {
      unnumbered += 1;
      continue;
    }
    merged.push({ number: Number(number), sha, parents: parents.split(' '), author, email, date, subject });
  }
  const bots = merged.filter((pr) => BOT.test(`${pr.author} ${pr.email}`));
  const people = merged.filter((pr) => !BOT.test(`${pr.author} ${pr.email}`));
  const readable = [];
  const unreadable = [];
  for (const pr of people) {
    // The merge's own change: the same files as the pull request's net diff.
    const files = git(repo, 'diff', '--name-only', `${pr.sha}^1`, pr.sha).split('\n').filter(Boolean);
    const read = files.filter((f) => READ.test(f) && !IGNORED.test(f));
    (read.length > 0 ? readable : unreadable).push({ ...pr, files: files.length, readFiles: read.length });
  }
  const order = shuffle(
    readable.sort((a, b) => a.number - b.number),
    SEED,
  ).map((pr) => ({
    number: pr.number,
    merge: pr.sha,
    base: `${pr.sha}^1`,
    author: pr.author,
    date: pr.date,
    subject: pr.subject,
    files: pr.files,
    readFiles: pr.readFiles,
  }));
  const fetched = order.slice(0, Number(values.fetch));
  if (fetched.length > 0) {
    const refs = fetched.map((pr) => `+refs/pull/${pr.number}/head:refs/pr/${pr.number}`);
    git(repo, 'fetch', '--quiet', 'origin', ...refs);
    for (const pr of fetched) pr.head = git(repo, 'rev-parse', `refs/pr/${pr.number}`);
  }
  selection.projects[name] = {
    ...project,
    commitsInWindow: log.split('\n').filter(Boolean).length,
    unnumbered,
    merged: merged.length,
    bots: bots.length,
    noReadableFile: unreadable.length,
    population: readable.length,
    order,
  };
  console.log(
    `${name}: ${merged.length} merged (${unnumbered} first-parent commits without a number), ${bots.length} by automation, ${unreadable.length} with no file Symbiote reads, ${readable.length} drawn from`,
  );
}
mkdirSync(join(here, 'data'), { recursive: true });
writeFileSync(join(here, 'data', 'selection.json'), `${JSON.stringify(selection, null, 2)}\n`);
