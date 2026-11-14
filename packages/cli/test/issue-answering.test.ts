// HV11b (decisions 1020–1023, 1071, 1073–1076): the steps due on an issue and Hive's runner
// writing them on the fake forge — each step once, the sixth comment the last, nothing on a closed
// or locked issue (the landing's own close aside), a failed write tried 3 times a minute apart
// and never thrown, `hive.issues.answer` off. Nothing leaves the machine.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo } from '@symbiote/core';
import { GitHubForge, GitLabForge, type Forge } from '@symbiote/forge';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, tempDir } from '../../core/test/helpers/git-repo.js';
import { fakeForge, type FakeForge, type FakeIssue } from '../../forge/test/fake-forge.js';
import { clearConditional } from '../../forge/src/http.js';
import { clearKnownLabels } from '../../forge/src/issues.js';
import type { AnswerStep } from '../src/issue-answer.js';
import {
  answerOfHiveEvent,
  dueAnswer,
  hiveAnsweringService,
  issueAnswerer,
} from '../src/issue-answering.js';
import { readIssueEvents, type IssueEvent } from '../src/issue-record.js';

const GITHUB = { kind: 'github' as const, host: 'github.com', project: 'acme/app' };
const GITLAB = { kind: 'gitlab' as const, host: 'gitlab.com', project: 'acme/app' };

let fake: FakeForge | undefined;
afterEach(async () => {
  await fake?.close_();
  fake = undefined;
  clearConditional();
  clearKnownLabels();
});

interface Setup {
  root: string;
  folder: string;
  fake: FakeForge;
  forge: Forge;
  clock: { at: number };
  answerer: ReturnType<typeof issueAnswerer>;
  due(step: AnswerStep, number?: number): Promise<boolean>;
  events(number?: number): Promise<IssueEvent[]>;
  /** Writes the forge got: every call but a read. */
  writes(): string[];
}

async function setup({
  kind = 'github',
  config = {},
  issue = {},
  token = true,
}: {
  kind?: 'github' | 'gitlab';
  config?: unknown;
  issue?: Partial<FakeIssue>;
  token?: boolean;
} = {}): Promise<Setup> {
  const root = tempDir();
  mkdirSync(join(root, 'symbiote'), { recursive: true });
  writeFileSync(join(root, 'symbiote', 'config.json'), JSON.stringify(config));
  const folder = join(root, 'symbiote');
  const made = await fakeForge(kind);
  fake = made;
  made.issues.push({
    number: 3,
    title: 'Forge errors log the Authorization header',
    body: 'It does.',
    state: 'open',
    author: 'grace',
    updated: '2026-11-14T10:00:00Z',
    ...issue,
  });
  const forge: Forge =
    kind === 'github'
      ? new GitHubForge(
          'github.com',
          'acme/app',
          { GITHUB_API_URL: made.url, ...(token ? { GITHUB_TOKEN: 'ghp_x' } : {}) },
          () => undefined,
        )
      : new GitLabForge('gitlab.com', 'acme/app', {
          GITLAB_API_URL: made.url,
          ...(token ? { GITLAB_TOKEN: 'glpat-x' } : {}),
        });
  const clock = { at: Date.parse('2026-11-14T10:00:00Z') };
  const now = () => new Date(clock.at);
  const answerer = issueAnswerer({
    folder: () => Promise.resolve(folder),
    root,
    forge: () => Promise.resolve({ forge }),
    now,
  });
  return {
    root,
    folder,
    fake: made,
    forge,
    clock,
    answerer,
    due: (step, number = 3) =>
      dueAnswer(folder, number, step, {
        root,
        forge: kind === 'github' ? GITHUB : GITLAB,
        at: now().toISOString(),
      }),
    events: (number = 3) => readIssueEvents(folder, number),
    writes: () => made.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`),
  };
}

const kinds = (events: IssueEvent[]) => events.map((e) => e.event);

describe('each step written once (decisions 1020, 1022)', () => {
  it('taken: a comment and the working label; a second tick and a second due write nothing', async () => {
    const s = await setup();
    expect(await s.due({ step: 'taken', branch: 'fix/3-forge-errors' })).toBe(true);
    expect(await s.due({ step: 'taken', branch: 'fix/3-forge-errors' })).toBe(false);
    await s.answerer.tick();
    const issue = s.fake.issues[0]!;
    expect(issue.comments).toEqual([
      { author: 'ada', body: "Symbiote's Hive is working on this in `fix/3-forge-errors`." },
    ]);
    expect(issue.labels?.map((l) => l.name)).toEqual(['symbiote: working']);
    expect(s.fake.labels).toEqual([
      {
        name: 'symbiote: working',
        color: '6e56cf',
        description: "Symbiote's Hive is working on this",
      },
    ]);
    const written = s.writes().length;
    await s.answerer.tick();
    await s.answerer.tick();
    expect(s.writes()).toHaveLength(written);
    const events = await s.events();
    expect(kinds(events)).toEqual(['due', 'answered', 'labelled']);
    expect(events[1]).toMatchObject({
      key: 'taken:fix/3-forge-errors',
      url: 'https://github.com/acme/app/issues/3#issuecomment-1',
    });
  });

  it('landed through the queue: the comment, every label removed, closed as completed', async () => {
    const s = await setup({ issue: { labels: [{ name: 'symbiote: working', color: '6e56cf' }] } });
    await s.due({
      step: 'landed',
      branch: 'fix/3-x',
      via: 'queue',
      into: 'main',
      sha: 'abcdef0123',
    });
    await s.answerer.tick();
    const issue = s.fake.issues[0]!;
    expect(issue.comments?.map((c) => c.body)).toEqual(['Landed in `main` at abcdef0.']);
    expect(issue.labels).toEqual([]);
    expect(issue).toMatchObject({ state: 'closed', closedBy: 'api', stateReason: 'completed' });
    expect((await s.events()).at(-1)).toMatchObject({ event: 'closed', by: 'symbiote' });
  });

  it('landed on an issue its own Closes #n closed: commented, labels removed, the forge’s close recorded (1073)', async () => {
    const s = await setup({
      issue: { state: 'closed', labels: [{ name: 'symbiote: working', color: '6e56cf' }] },
    });
    await s.due({
      step: 'landed',
      branch: 'fix/3-x',
      via: 'queue',
      into: 'main',
      sha: 'abcdef0123',
    });
    await s.answerer.tick();
    const issue = s.fake.issues[0]!;
    expect(issue.comments?.map((c) => c.body)).toEqual(['Landed in `main` at abcdef0.']);
    expect(issue.labels).toEqual([]);
    expect(issue.closedBy).toBeUndefined();
    expect((await s.events()).at(-1)).toMatchObject({ event: 'closed', by: 'forge' });
  });

  it('landed through a request: no comment; a poll after, closed by Symbiote if still open (1074)', async () => {
    const s = await setup({ kind: 'gitlab' });
    await s.due({ step: 'landed', branch: 'fix/3-x', via: 'request', into: 'release', number: 12 });
    await s.answerer.tick();
    expect(s.fake.issues[0]?.state).toBe('open');
    expect(s.fake.issues[0]?.comments ?? []).toEqual([]);
    s.clock.at += 60_000;
    await s.answerer.tick();
    expect(s.fake.issues[0]).toMatchObject({ state: 'closed', closedBy: 'api' });
    expect((await s.events()).at(-1)).toMatchObject({ event: 'closed', by: 'symbiote' });
  });

  it('landed through a request the forge closed by its keyword: recorded, not closed again', async () => {
    const s = await setup();
    await s.due({ step: 'landed', branch: 'fix/3-x', via: 'request', into: 'main', number: 12 });
    s.fake.issues[0]!.state = 'closed';
    s.fake.issues[0]!.closedBy = 'keyword';
    s.clock.at += 60_000;
    await s.answerer.tick();
    expect(s.writes().filter((w) => w.startsWith('PATCH'))).toEqual([]);
    expect((await s.events()).at(-1)).toMatchObject({ event: 'closed', by: 'forge' });
  });

  it('a request opened: its link; stopped: the stop’s sentence and label', async () => {
    const s = await setup();
    await s.due({ step: 'request', number: 12, url: 'https://github.com/acme/app/pull/12' });
    await s.due({ step: 'stopped', branch: 'fix/3-x', stop: 'budget', at: '2026-11-14T11:00:00Z' });
    await s.answerer.tick();
    expect(s.fake.issues[0]?.comments?.map((c) => c.body)).toEqual([
      'A pull request is open: https://github.com/acme/app/pull/12.',
      'Symbiote stopped work on this: it reached its budget.',
    ]);
    expect(s.fake.issues[0]?.labels?.map((l) => l.name)).toEqual(['symbiote: stopped']);
  });
});

describe('the limits (decisions 1022, 1076)', () => {
  it('the sixth comment is the last; the labels still follow', async () => {
    const s = await setup();
    for (let n = 1; n <= 7; n++) {
      await s.due({ step: 'asked', hash: `h${n}`, question: `Question ${n}?` });
      await s.answerer.tick();
    }
    expect(s.fake.issues[0]?.comments).toHaveLength(6);
    expect(s.fake.issues[0]?.comments?.at(-1)?.body).toContain('Question 6?');
    const events = await s.events();
    expect(events.filter((e) => e.event === 'not-written')).toEqual([
      expect.objectContaining({ key: 'asked:h7', parts: ['comment'], why: 'limit' }),
    ]);
    expect(events.filter((e) => e.event === 'labelled')).toHaveLength(7);
  });

  it('nothing written to a closed issue', async () => {
    const s = await setup({ issue: { state: 'closed' } });
    await s.due({ step: 'taken', branch: 'fix/3-x' });
    await s.answerer.tick();
    expect(s.writes()).toEqual([]);
    expect((await s.events()).at(-1)).toMatchObject({
      event: 'not-written',
      why: 'closed',
      parts: ['comment', 'labels'],
    });
  });

  it('nothing written to a locked issue, not even a landing', async () => {
    const s = await setup({ issue: { locked: true } });
    await s.due({ step: 'landed', branch: 'fix/3-x', via: 'queue', into: 'main', sha: 'abc1234' });
    await s.answerer.tick();
    expect(s.writes()).toEqual([]);
    expect((await s.events()).at(-1)).toMatchObject({
      event: 'not-written',
      why: 'locked',
      parts: ['comment', 'labels', 'close'],
    });
  });

  it("a question 1037's check held: the label, no comment, and why", async () => {
    const s = await setup();
    await s.due({ step: 'asked', hash: 'h', question: null, held: 'personal' });
    await s.answerer.tick();
    expect(s.fake.issues[0]?.comments ?? []).toEqual([]);
    expect(s.fake.issues[0]?.labels?.map((l) => l.name)).toEqual(['symbiote: question']);
    expect(kinds(await s.events())).toEqual(['due', 'not-written', 'labelled']);
    expect((await s.events())[1]).toMatchObject({ why: 'personal', parts: ['comment'] });
  });

  it('hive.issues.answer off: nothing due; a step due before, not written', async () => {
    const off = await setup({ config: { hive: { issues: { answer: false } } } });
    expect(await off.due({ step: 'taken', branch: 'b' })).toBe(false);
    await off.answerer.tick();
    expect(off.writes()).toEqual([]);
    expect(await off.events()).toEqual([]);
    await fake?.close_();

    const s = await setup();
    await s.due({ step: 'taken', branch: 'b' });
    writeFileSync(
      join(s.root, 'symbiote', 'config.json'),
      JSON.stringify({ hive: { issues: { answer: false } } }),
    );
    await s.answerer.tick();
    expect(s.writes()).toEqual([]);
    expect((await s.events()).at(-1)).toMatchObject({ event: 'not-written', why: 'off' });
  });

  it('without a token: not written, and why', async () => {
    const s = await setup({ token: false });
    await s.due({ step: 'taken', branch: 'b' });
    await s.answerer.tick();
    expect(s.writes()).toEqual([]);
    expect((await s.events()).at(-1)).toMatchObject({ event: 'not-written', why: 'no-token' });
  });

  it("an issue of another forge than origin's: not written", async () => {
    const s = await setup();
    await dueAnswer(
      s.folder,
      3,
      { step: 'taken', branch: 'b' },
      {
        root: s.root,
        forge: { ...GITHUB, project: 'acme/other' },
        at: '2026-11-14T10:00:00Z',
      },
    );
    await s.answerer.tick();
    expect(s.writes()).toEqual([]);
    expect((await s.events()).at(-1)).toMatchObject({ why: 'other-forge' });
  });
});

describe('a failed write (decisions 1023, 1075)', () => {
  it('recorded with the forge’s answer, tried 3 times a minute apart, never thrown', async () => {
    const s = await setup();
    s.fake.writesFail = 403;
    await s.due({ step: 'taken', branch: 'fix/3-x' });
    await s.answerer.tick();
    await s.answerer.tick();
    let failed = (await s.events()).filter((e) => e.event === 'write-failed');
    expect(failed).toEqual([
      expect.objectContaining({
        key: 'taken:fix/3-x',
        part: 'comment',
        try: 1,
        status: 403,
        answer: expect.stringContaining('Resource not accessible by integration') as unknown,
      }),
    ]);
    s.clock.at += 60_000;
    await s.answerer.tick();
    s.clock.at += 60_000;
    await s.answerer.tick();
    s.clock.at += 60_000;
    await s.answerer.tick();
    failed = (await s.events()).filter((e) => e.event === 'write-failed');
    expect(failed.map((e) => (e as { try: number }).try)).toEqual([1, 2, 3]);
    expect((await s.events()).at(-1)).toMatchObject({
      event: 'not-written',
      why: 'gave-up',
      parts: ['comment', 'labels'],
    });
    const writes = s.writes().length;
    s.clock.at += 600_000;
    await s.answerer.tick();
    expect(s.writes()).toHaveLength(writes);
  });

  it('a write that succeeds at its second try goes on where it stopped', async () => {
    const s = await setup();
    await s.due({ step: 'taken', branch: 'fix/3-x' });
    // The comment goes; the labels fail: the second try writes the labels only.
    const forge = s.forge;
    const label = forge.labelIssue.bind(forge);
    let fails = 1;
    forge.labelIssue = (n, change) =>
      fails-- > 0 ? Promise.reject(new Error('socket hang up')) : label(n, change);
    await s.answerer.tick();
    s.clock.at += 60_000;
    await s.answerer.tick();
    expect(s.fake.issues[0]?.comments).toHaveLength(1);
    expect(s.fake.issues[0]?.labels?.map((l) => l.name)).toEqual(['symbiote: working']);
    expect(kinds(await s.events())).toEqual(['due', 'answered', 'write-failed', 'labelled']);
  });

  it('a forge that cannot be read: the tick resolves', async () => {
    const s = await setup();
    await s.due({ step: 'taken', branch: 'b' });
    const answerer = issueAnswerer({
      folder: () => Promise.resolve(s.folder),
      root: s.root,
      forge: () => Promise.reject(new Error('no origin')),
      now: () => new Date(s.clock.at),
    });
    await expect(answerer.tick()).resolves.toBeUndefined();
  });
});

describe('the outbox (decision 1071)', () => {
  it('a runner started later writes what was due before, and nothing written already', async () => {
    const s = await setup();
    await s.due({ step: 'taken', branch: 'b' });
    await s.answerer.tick();
    await s.due({ step: 'stopped', branch: 'b', stop: 'rounds', at: 'T' });
    const later = issueAnswerer({
      folder: () => Promise.resolve(s.folder),
      root: s.root,
      forge: () => Promise.resolve({ forge: s.forge }),
      now: () => new Date(s.clock.at),
    });
    await later.tick();
    expect(s.fake.issues[0]?.comments?.map((c) => c.body)).toEqual([
      "Symbiote's Hive is working on this in `b`.",
      'Symbiote stopped work on this: its rounds of checks and reviews ran out.',
    ]);
  });
});

describe("Hive's events as steps (decisions 1020, 1072)", () => {
  const issue = { forge: 'github' as const, host: 'github.com', project: 'acme/app', number: 3 };
  const at = '2026-11-14T10:00:00Z';

  it('a request opened, a landing by the queue or a request, a stop with its kind', () => {
    expect(
      answerOfHiveEvent(
        'request-opened',
        { number: 12, url: 'https://x/pull/12' },
        {
          branch: 'b',
          at,
        },
      ),
    ).toEqual({ step: 'request', number: 12, url: 'https://x/pull/12' });
    expect(
      answerOfHiveEvent(
        'landed',
        {},
        {
          branch: 'b',
          at,
          landing: { round: 1, at: 'abc1234', into: 'main', entry: 'e', queued: at },
        },
      ),
    ).toEqual({ step: 'landed', branch: 'b', via: 'queue', into: 'main', sha: 'abc1234' });
    expect(
      answerOfHiveEvent(
        'landed',
        {},
        {
          branch: 'b',
          at,
          landing: {
            round: 1,
            at: 'abc1234',
            into: 'main',
            entry: '#12',
            via: 'request',
            queued: at,
          },
        },
      ),
    ).toEqual({ step: 'landed', branch: 'b', via: 'request', into: 'main', number: 12 });
    expect(answerOfHiveEvent('stuck', { note: 'x', stop: 'budget' }, { branch: 'b', at })).toEqual({
      step: 'stopped',
      branch: 'b',
      stop: 'budget',
      at,
    });
    expect(issue.number).toBe(3);
  });

  it('nothing for a stop with no kind, an update, or another event', () => {
    expect(answerOfHiveEvent('stuck', { note: 'x' }, { branch: 'b', at })).toBeNull();
    expect(
      answerOfHiveEvent('request-updated', { number: 12, url: 'u' }, { branch: 'b', at }),
    ).toBeNull();
    expect(answerOfHiveEvent('check', {}, { branch: 'b', at })).toBeNull();
  });
});

describe("Settings' answering (HV11, decision 1077)", () => {
  it('the setting, the labels, the account and whether it may write; read once in 10 minutes', async () => {
    const s = await setup();
    const repo = createRepo();
    repo.git('remote', 'add', 'origin', 'https://github.com/acme/app.git');
    mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
    writeFileSync(
      join(repo.root, 'symbiote', 'config.json'),
      JSON.stringify({ hive: { issues: { labels: { working: 'hive: on it' } } } }),
    );
    const clock = { at: 0 };
    const service = hiveAnsweringService(
      await openRepo(repo.root),
      repo.root,
      {},
      {
        make: () => s.forge,
        now: () => new Date(clock.at),
      },
    );
    const read = await service.read();
    expect(read).toEqual({
      answer: true,
      labels: {
        working: 'hive: on it',
        question: 'symbiote: question',
        declined: 'symbiote: declined',
        stopped: 'symbiote: stopped',
      },
      forge: { kind: 'github', host: 'github.com', project: 'acme/app' },
      account: { login: 'ada', write: 'yes' },
    });
    const users = () => s.fake.calls.filter((c) => c.path === '/user').length;
    await service.read();
    expect(users()).toBe(1);
    clock.at += 10 * 60_000;
    await service.read();
    expect(users()).toBe(2);
    expect((await service.set(false)).answer).toBe(false);
    expect(JSON.parse(readFileSync(join(repo.root, 'symbiote', 'config.json'), 'utf8'))).toEqual({
      hive: { issues: { answer: false, labels: { working: 'hive: on it' } } },
    });
    expect((await service.set(true)).answer).toBe(true);
    expect(JSON.parse(readFileSync(join(repo.root, 'symbiote', 'config.json'), 'utf8'))).toEqual({
      hive: { issues: { labels: { working: 'hive: on it' } } },
    });
    repo.cleanup();
  });

  it('says why there is no account: no origin, or a refused read', async () => {
    const s = await setup();
    const bare = createRepo();
    const none = await hiveAnsweringService(await openRepo(bare.root), bare.root, {}).read();
    expect(none).toMatchObject({ answer: true, why: 'the repository has no remote named origin' });
    expect(none.account).toBeUndefined();
    bare.git('remote', 'add', 'origin', 'https://github.com/acme/app.git');
    s.fake.calls.length = 0;
    const refused = {
      ...s.forge,
      kind: s.forge.kind,
      token: true,
      tokenAccount: () => Promise.reject(new Error('401')),
    } as Forge;
    const read = await hiveAnsweringService(
      await openRepo(bare.root),
      bare.root,
      {},
      {
        make: () => refused,
      },
    ).read();
    expect(read.why).toBe("the token's account could not be read: 401");
    bare.cleanup();
  });
});
