// HV9b: the classifier as `symbiote view` runs it: its refusals (Hive off, no forge, a pull
// request's number, no hive.issues.about, one at a time, no Claude Code), the record
// `symbiote/issues/<number>.json` and its events (decision 1007), read back.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo, type AgentModel } from '@symbiote/core';
import { GitHubForge, type Env } from '@symbiote/forge';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { mockApi, type Reply } from '../../forge/test/mock-api.js';
import { originForge } from '../src/hive-request.js';
import { IssueRefused, issueClassifier } from '../src/issue-classifier.js';
import type { ClassifierAnswer } from '../src/issue-classify.js';
import {
  readIssueEvents,
  readIssueRecord,
  writeIssueRecord,
  type IssueRecord,
} from '../src/issue-record.js';

const CLAUDE_MODELS = JSON.parse(
  readFileSync(new URL('./fixtures/advice-claude-models.json', import.meta.url), 'utf8'),
) as AgentModel[];
const ANSWERS = JSON.parse(
  readFileSync(new URL('./fixtures/classifier/opus-p2-answers.json', import.meta.url), 'utf8'),
) as Record<string, { answer: ClassifierAnswer }>;

const ISSUE = {
  number: 3,
  title: 'Forge errors log the Authorization header',
  html_url: 'https://github.com/acme/app/issues/3',
  user: { login: 'ada', type: 'User' },
  labels: [{ name: 'bug' }],
  state: 'open',
  comments: 0,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
  author_association: 'NONE',
  body: 'The logged error keeps the request headers.',
};

const repos: TestRepo[] = [];
const dirs: string[] = [];
let api: Awaited<ReturnType<typeof mockApi>> | undefined;
afterEach(async () => {
  for (const repo of repos.splice(0)) repo.cleanup();
  await api?.close();
  api = undefined;
});

function repository(config?: unknown, origin = 'git@github.com:acme/app.git') {
  const repo = createRepo();
  repo.write({ 'a.txt': 'a\n' });
  repo.commit('A');
  if (origin) repo.git('remote', 'add', 'origin', origin);
  if (config !== undefined) {
    mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
    writeFileSync(join(repo.root, 'symbiote', 'config.json'), JSON.stringify(config));
  }
  repos.push(repo);
  return repo;
}

const ABOUT = { hive: { issues: { about: 'A web app. Hive may take bug fixes.' } } };

const make = (url: string, env: Env) =>
  new GitHubForge('github.com', 'acme/app', { ...env, GITHUB_API_URL: api?.url }, () => undefined);

async function serve(answer: (path: string) => Reply | undefined) {
  api = await mockApi({}, (request) => answer(request.path.split('?')[0] ?? ''));
}

const result = (structured: unknown) =>
  JSON.stringify({ stop_reason: 'end_turn', total_cost_usd: 0.03, structured_output: structured });

async function classifier(
  repo: TestRepo,
  {
    hive = true,
    claude = true,
    answers = [result(ANSWERS.a01!.answer)],
    wait,
  }: { hive?: boolean; claude?: boolean; answers?: string[]; wait?: Promise<void> } = {},
) {
  const cacheDir = tempDir();
  dirs.push(cacheDir);
  const git = await openRepo(repo.root);
  const runs: string[] = [];
  return {
    runs,
    service: issueClassifier({
      root: repo.root,
      folder: () => Promise.resolve(join(repo.root, 'symbiote')),
      cacheDir,
      hive: () => Promise.resolve(hive),
      forge: () => originForge(git, {}, make),
      claude: () =>
        Promise.resolve(
          claude ? { command: '/bin/claude', models: CLAUDE_MODELS, version: '2.1.323' } : null,
        ),
      checks: () => Promise.resolve(['npm test']),
      markers: () => Promise.resolve([{ name: 'email', value: 'person@example.com' }]),
      now: () => Date.parse('2026-11-13T18:00:00.000Z'),
      runInput: async (_command, _args, { input }) => {
        runs.push(input);
        await wait;
        return { code: 0, stdout: answers.shift() ?? '', stderr: '' };
      },
    }),
  };
}

const refusal = async (task: Promise<unknown>) => {
  try {
    await task;
  } catch (error) {
    if (error instanceof IssueRefused) return { status: error.status, message: error.message };
    throw error;
  }
  throw new Error('not refused');
};

describe('the classifier in symbiote view (HV9b)', () => {
  it('classifies an issue, writes its record and an event, and reads it back', async () => {
    await serve((path) => (path === '/repos/acme/app/issues/3' ? { body: ISSUE } : undefined));
    const repo = repository(ABOUT);
    const answers = [result(ANSWERS.a01!.answer), result(ANSWERS.a01!.answer)];
    const { service, runs } = await classifier(repo, { answers });
    const record = await service.classify(3);
    expect(record).toMatchObject({
      forge: { kind: 'github', host: 'github.com', project: 'acme/app' },
      number: 3,
      url: 'https://github.com/acme/app/issues/3',
      title: ISSUE.title,
      state: 'open',
      decision: 'take',
      classifier: { model: 'opus', effort: 'high', version: '2.1.323' },
    });
    // The card is the repository's own: its project, its check, the person's text.
    expect(runs[0]).toContain('Repository: acme/app on GitHub (github.com).');
    expect(runs[0]).toContain('Check: npm test.');
    expect(runs[0]).toContain('A web app. Hive may take bug fixes.');
    const file = join(repo.root, 'symbiote', 'issues', '3.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(record);
    expect(await service.record(3)).toEqual(record);
    expect(await service.record(4)).toBeNull();
    await service.classify(3);
    expect((await readIssueEvents(join(repo.root, 'symbiote'), 3)).map((e) => e.event)).toEqual([
      'classified',
      'classified-again',
    ]);
  });

  it('records a failed classification as an event, and as the record', async () => {
    await serve((path) => (path === '/repos/acme/app/issues/3' ? { body: ISSUE } : undefined));
    const repo = repository(ABOUT);
    const { service } = await classifier(repo, { answers: ['', ''] });
    expect(await service.classify(3)).toMatchObject({ decision: 'failed', failed: 'no answer' });
    expect((await readIssueEvents(join(repo.root, 'symbiote'), 3)).map((e) => e.event)).toEqual([
      'failed',
    ]);
  });

  it('refuses with Hive off, before reading the forge', async () => {
    await serve(() => undefined);
    const { service } = await classifier(repository(ABOUT), { hive: false });
    expect(await refusal(service.classify(3))).toEqual({
      status: 409,
      message: 'Hive mode is off: the classifier runs only while it is on',
    });
    expect(api?.requests).toEqual([]);
  });

  it('refuses with no forge: no origin, or origin on neither GitHub nor GitLab', async () => {
    const none = await classifier(repository(ABOUT, ''));
    expect(await refusal(none.service.classify(3))).toMatchObject({ status: 409 });
    const elsewhere = await classifier(repository(ABOUT, 'https://example.com/acme/app.git'));
    expect(await refusal(elsewhere.service.classify(3))).toMatchObject({ status: 409 });
  });

  it('refuses a pull request’s number, with the forge’s words', async () => {
    await serve((path) =>
      path === '/repos/acme/app/issues/4'
        ? { body: { ...ISSUE, number: 4, pull_request: {} } }
        : undefined,
    );
    const { service, runs } = await classifier(repository(ABOUT));
    expect(await refusal(service.classify(4))).toEqual({
      status: 409,
      message: '#4 is a pull request, not an issue',
    });
    expect(runs).toEqual([]);
  });

  it('refuses without hive.issues.about: the card would say nothing of the project (1038)', async () => {
    await serve((path) => (path === '/repos/acme/app/issues/3' ? { body: ISSUE } : undefined));
    for (const config of [undefined, { hive: { issues: { about: '   ' } } }]) {
      const { service } = await classifier(repository(config));
      expect(await refusal(service.classify(3))).toEqual({
        status: 409,
        message:
          'Write what the project is and what Hive may take on first: hive.issues.about in symbiote/config.json',
      });
    }
  });

  it('refuses without Claude Code, and a second classification of an issue meanwhile', async () => {
    await serve((path) => (path === '/repos/acme/app/issues/3' ? { body: ISSUE } : undefined));
    const none = await classifier(repository(ABOUT), { claude: false });
    expect(await refusal(none.service.classify(3))).toMatchObject({ status: 409 });
    let release = () => undefined as void;
    const wait = new Promise<void>((resolve) => (release = resolve));
    const { service } = await classifier(repository(ABOUT), { wait });
    const first = service.classify(3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await refusal(service.classify(3))).toEqual({
      status: 409,
      message: 'Issue #3 is being classified',
    });
    release();
    expect(await first).toMatchObject({ decision: 'take' });
  });
});

describe('the record (decision 1007)', () => {
  const RECORD = {
    forge: { kind: 'github', host: 'github.com', project: 'acme/app' },
    number: 7,
    url: 'https://github.com/acme/app/issues/7',
    title: 'T',
    state: 'open',
    decision: 'ask',
  } as unknown as IssueRecord;

  it('is never read for another origin', async () => {
    const root = tempDir();
    dirs.push(root);
    const folder = join(root, 'symbiote');
    await writeIssueRecord(folder, RECORD);
    expect(existsSync(join(folder, 'issues', '7.jsonl'))).toBe(true);
    expect(await readIssueRecord(folder, 7, RECORD.forge)).toMatchObject({ number: 7 });
    const other = { ...RECORD.forge, project: 'acme/other' };
    expect(await readIssueRecord(folder, 7, other)).toBeNull();
    expect(await readIssueRecord(folder, 8, RECORD.forge)).toBeNull();
  });

  it('starts with what agents must know, and an event a line', async () => {
    const root = tempDir();
    dirs.push(root);
    const event = await writeIssueRecord(join(root, 'symbiote'), RECORD);
    expect(event).toMatchObject({ event: 'classified', decision: 'ask' });
    const written = JSON.parse(
      readFileSync(join(root, 'symbiote', 'issues', '7.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(written)[0]).toBe('about');
    const lines = readFileSync(join(root, 'symbiote', 'issues', '7.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(1);
  });
});
