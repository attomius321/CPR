// HV9b: the classifier as `symbiote view` runs it: its refusals (Hive off, no forge, a pull
// request's number, no hive.issues.about, one at a time, no Claude Code), the record
// `symbiote/issues/<number>.json` and its events (decision 1007), read back.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo, type AgentModel, type ClassifierAnswer, type IssueRecord } from '@symbiote/core';
import { GitHubForge, type Env } from '@symbiote/forge';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { mockApi, type Reply } from '../../forge/test/mock-api.js';
import { originForge } from '../src/hive-request.js';
import { IssueRefused, issueClassifier } from '../src/issue-classifier.js';
import { readIssueEvents, readIssueRecord, writeIssueRecord } from '../src/issue-record.js';

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

  it('an ask is due to be answered on the issue, its question cleaned; a take is not (HV11)', async () => {
    await serve((path) => (path === '/repos/acme/app/issues/3' ? { body: ISSUE } : undefined));
    const repo = repository(ABOUT);
    const ask = ANSWERS.h21!.answer;
    const { service } = await classifier(repo, { answers: [result(ask), result(ask)] });
    const record = await service.classify(3);
    const events = await readIssueEvents(join(repo.root, 'symbiote'), 3);
    expect(events.map((e) => e.event)).toEqual(['classified', 'due']);
    expect(events[1]).toMatchObject({
      key: `asked:${record.snapshot.hash}`,
      forge: { kind: 'github', host: 'github.com', project: 'acme/app' },
      step: { step: 'asked', hash: record.snapshot.hash },
    });
    const question = (events[1] as { step: { question: string } }).step.question;
    expect(question).toContain('Would it work for you if we fixed the flakiness in');
    expect(question).not.toContain('`');
    expect(
      readFileSync(join(repo.root, 'symbiote', 'issues', 'answers.jsonl'), 'utf8').trim(),
    ).toBe(JSON.stringify({ number: 3, key: `asked:${record.snapshot.hash}`, at: events[1]!.at }));
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

describe("the page's decisions and Settings' Issues group (HV9c)", () => {
  const FORGE = { kind: 'github', host: 'github.com', project: 'acme/app' } as const;
  const record = (number: number, more: Partial<IssueRecord>): IssueRecord =>
    ({
      forge: FORGE,
      number,
      url: `https://github.com/acme/app/issues/${number}`,
      title: `Issue ${number}`,
      state: 'open',
      decision: 'take',
      classifier: { identity: 'old' },
      run: { at: `2026-11-1${number % 10}T10:00:00.000Z`, ms: 1, cost: 0.03, tries: 1 },
      ...more,
    }) as IssueRecord;

  it("lists each record of origin's forge as a row's decision, by number (1055)", async () => {
    await serve((path) => (path === '/repos/acme/app/issues/3' ? { body: ISSUE } : undefined));
    const repo = repository(ABOUT);
    const folder = join(repo.root, 'symbiote');
    await writeIssueRecord(folder, record(9, { decision: 'refuse', refusal: 'unsafe' }));
    await writeIssueRecord(folder, record(5, { decision: 'take', held: ['new-dependency'] }));
    await writeIssueRecord(folder, record(6, { decision: 'failed', failed: 'no answer' }));
    // Another origin's record, and a file that is not one: never listed.
    await writeIssueRecord(folder, record(8, { forge: { ...FORGE, project: 'acme/other' } }));
    writeFileSync(join(folder, 'issues', 'notes.json'), 'not JSON');
    const { service } = await classifier(repo);
    const classified = await service.classify(3);
    const answer = await service.decisions();
    expect(answer).toEqual({
      decisions: [
        { number: 3, decision: 'take', at: '2026-11-13T18:00:00.000Z' },
        { number: 5, decision: 'take', held: ['new-dependency'], at: '2026-11-15T10:00:00.000Z' },
        { number: 6, decision: 'failed', at: '2026-11-16T10:00:00.000Z' },
        { number: 9, decision: 'refuse', refusal: 'unsafe', at: '2026-11-19T10:00:00.000Z' },
      ],
      about: true,
      // The identity a classification gets now: one function for both (1041).
      identity: classified.classifier.identity,
    });
  });

  it('says when hive.issues.about is missing, with no identity to count under', async () => {
    const { service } = await classifier(repository({}));
    expect(await service.decisions()).toEqual({ decisions: [], about: false });
    const none = await classifier(repository(ABOUT, ''));
    expect(await none.service.decisions()).toEqual({ decisions: [], about: true });
  });

  it("reads Settings' group: the text, the model and effort, Claude Code's choices", async () => {
    const repo = repository({
      hive: {
        issues: { about: 'A web app. Hive may take bug fixes.' },
        classifier: { model: 'sonnet', effort: 'medium' },
      },
    });
    const { service } = await classifier(repo);
    const settings = await service.settings();
    expect(settings).toMatchObject({
      about: 'A web app. Hive may take bug fixes.',
      maxAbout: 4_000,
      levels: {
        model: 'sonnet',
        effort: 'medium',
        file: 'symbiote/config.json',
        agents: [
          {
            kind: 'claude',
            models: CLAUDE_MODELS,
            defaultModel: { id: 'opus', by: 'symbiote' },
            efforts: { default: 'high', by: 'symbiote' },
          },
        ],
      },
    });
    // The levels on the model it runs on: Sonnet's own.
    const sonnet = CLAUDE_MODELS.find((m) => m.id === 'sonnet');
    expect(settings.levels.agents[0]?.efforts?.levels).toEqual(sonnet?.efforts?.levels);
  });

  it('counts the standing under the current identity: the records, the judged takes (1059)', async () => {
    await serve((path) => (path === '/repos/acme/app/issues/3' ? { body: ISSUE } : undefined));
    const repo = repository(ABOUT);
    const folder = join(repo.root, 'symbiote');
    const { service } = await classifier(repo);
    const taken = await service.classify(3);
    const identity = taken.classifier.identity;
    await writeIssueRecord(folder, record(5, { classifier: taken.classifier, held: ['cut'] }));
    await writeIssueRecord(folder, record(6, { decision: 'ask', classifier: taken.classifier }));
    // Under another identity: not counted.
    await writeIssueRecord(folder, record(7, { decision: 'refuse', refusal: 'too-large' }));
    // How takes ended (HV10 writes these): under this identity, and under another.
    const judged = (number: number, line: object) =>
      appendFileSync(join(folder, 'issues', `${number}.jsonl`), `${JSON.stringify(line)}\n`);
    judged(3, {
      event: 'judged',
      at: '2026-11-14T10:00:00Z',
      identity,
      right: true,
      why: 'landed',
    });
    judged(5, {
      event: 'judged',
      at: '2026-11-14T11:00:00Z',
      identity,
      right: false,
      why: 'declined',
    });
    judged(7, {
      event: 'judged',
      at: '2026-11-14T12:00:00Z',
      identity: 'old',
      right: true,
      why: 'landed',
    });
    const { standing, why } = await service.settings();
    expect(why).toBeUndefined();
    expect(standing).toEqual({
      identity,
      since: '2026-11-13T18:00:00.000Z',
      classified: { take: 2, held: 1, ask: 1, refuse: 0, failed: 0 },
      judged: { right: 1, wrong: 1 },
      bar: { takes: 20, right: 0.95 },
      hostile: null,
      meets: false,
    });
  });

  it('says why there is no standing: no text of the project, no forge, no Claude Code', async () => {
    const { service } = await classifier(repository({}));
    expect(await service.settings()).toMatchObject({
      about: null,
      standing: null,
      why: 'Write what the project is and what Hive may take on first: hive.issues.about in symbiote/config.json',
    });
    const none = await classifier(repository(ABOUT), { claude: false });
    expect(await none.service.settings()).toMatchObject({
      standing: null,
      why: 'Claude Code is not found: the classifier runs on it',
      levels: { agents: [] },
    });
    const elsewhere = await classifier(repository(ABOUT, ''));
    expect((await elsewhere.service.settings()).why).toMatch(/^No forge to read issues from/);
  });

  it('saves hive.issues.about: at most 4,000 characters, refused with words past it (1060)', async () => {
    const repo = repository({ merge: { checks: ['npm test'] } });
    const { service } = await classifier(repo);
    const config = () =>
      JSON.parse(readFileSync(join(repo.root, 'symbiote', 'config.json'), 'utf8')) as Record<
        string,
        unknown
      >;
    expect((await service.setAbout('  A shop. Hive may fix bugs.  ')).about).toBe(
      'A shop. Hive may fix bugs.',
    );
    expect(config()).toEqual({
      merge: { checks: ['npm test'] },
      hive: { issues: { about: 'A shop. Hive may fix bugs.' } },
    });
    expect(await refusal(service.setAbout('x'.repeat(4_001)))).toEqual({
      status: 400,
      message: 'At most 4,000 characters: this text has 4,001',
    });
    expect((await service.setAbout('   ')).about).toBeNull();
    expect(config()).toEqual({ merge: { checks: ['npm test'] } });
    await service.setAbout('A shop.');
    expect((await service.setAbout(null)).about).toBeNull();
  });

  it("saves the classifier's model and effort from Claude Code's own list", async () => {
    const repo = repository(ABOUT);
    const { service } = await classifier(repo);
    expect((await service.setModel('sonnet')).levels.model).toBe('sonnet');
    expect((await service.setEffort('max')).levels.effort).toBe('max');
    const hive = () =>
      (
        JSON.parse(readFileSync(join(repo.root, 'symbiote', 'config.json'), 'utf8')) as {
          hive: unknown;
        }
      ).hive;
    expect(hive()).toEqual({ ...ABOUT.hive, classifier: { model: 'sonnet', effort: 'max' } });
    expect(await refusal(service.setModel('gpt-6'))).toEqual({
      status: 400,
      message: 'Claude Code lists no model gpt-6: pick one it lists',
    });
    expect(await refusal(service.setModel('--evil'))).toMatchObject({ status: 400 });
    expect(await refusal(service.setEffort('Max!'))).toMatchObject({ status: 400 });
    expect(await refusal(service.setEffort('ultra'))).toMatchObject({ status: 400 });
    await service.setModel(null);
    await service.setEffort(null);
    expect(hive()).toEqual(ABOUT.hive);
    const none = await classifier(repository(ABOUT), { claude: false });
    expect(await refusal(none.service.setModel('sonnet'))).toEqual({
      status: 409,
      message: 'Claude Code is not found: the classifier runs on it',
    });
  });
});
