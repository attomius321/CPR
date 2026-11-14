// HV10b: the start from an issue (decisions 1011–1014, 1061, 1062). Only a take on the issue's
// current text, with Hive on, one open workspace an issue; the request built from the decision,
// with the branch and the record's issue; the `started` event.
import { readFileSync } from 'node:fs';
import type {
  ClassifierAnswer,
  IssueRecord,
  WorkspaceRequest,
  WorkspaceSummary,
} from '@symbiote/core';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { IssueRefused } from '../src/issue-classifier.js';
import { appendIssueEvent, judgeTake, readIssueEvents } from '../src/issue-record.js';
import {
  issueBranch,
  issueSlug,
  issueStarter,
  openWorkspaceOf,
  type IssueStartContext,
} from '../src/issue-start.js';
import { parseWorkspaceRequest } from '../src/server-requests.js';

const ANSWERS = JSON.parse(
  readFileSync(new URL('./fixtures/classifier/opus-p2-answers.json', import.meta.url), 'utf8'),
) as Record<string, { answer: ClassifierAnswer }>;
const TAKE = ANSWERS.a01!.answer;

const FORGE = { kind: 'github' as const, host: 'github.com', project: 'acme/app' };
const HASH = 'a'.repeat(64);

function recordOf(over: Partial<IssueRecord> = {}): IssueRecord {
  return {
    forge: FORGE,
    number: 3,
    url: 'https://github.com/acme/app/issues/3',
    title: 'Forge errors log the Authorization header',
    state: 'open',
    snapshot: {
      hash: HASH,
      at: '2026-11-13T18:00:00.000Z',
      text: '<issue>…</issue>',
      read: { members: 0, author: 0 },
      outside: 0,
      flags: [],
    },
    decision: 'take',
    answer: TAKE,
    brief: 'From issue #3 …',
    classifier: {
      agent: 'claude',
      model: 'opus',
      effort: 'high',
      prompt: 'p',
      card: 'c',
      rules: 1,
      identity: 'id-1',
    },
    run: { at: '2026-11-13T18:00:00.000Z', ms: 9000, cost: 0.03, tries: 1 },
    ...over,
  };
}

const summary = (over: Partial<WorkspaceSummary>): WorkspaceSummary => ({
  branch: 'fix/3-forge-errors-log-the-authorization',
  base: 'b'.repeat(40),
  created: '2026-11-13T19:00:00.000Z',
  planFirst: false,
  brief: '',
  worktree: { path: '/w', exists: true },
  tip: null,
  ahead: 0,
  merged: false,
  agent: { state: 'working' },
  ...over,
});

const ISSUE = {
  forge: 'github' as const,
  host: 'github.com',
  project: 'acme/app',
  number: 3,
  url: 'https://github.com/acme/app/issues/3',
  title: 'Forge errors log the Authorization header',
  hash: HASH,
};

const dirs: string[] = [];
afterEach(() => void dirs.splice(0));

function starter(
  over: {
    hive?: boolean;
    record?: IssueRecord | null;
    again?: IssueRecord;
    hash?: string;
    workspaces?: WorkspaceSummary[];
    taken?: string[];
  } = {},
) {
  const folder = tempDir();
  dirs.push(folder);
  const started: WorkspaceRequest[] = [];
  const classified: number[] = [];
  const dues: unknown[] = [];
  const ctx: IssueStartContext = {
    hive: () => Promise.resolve(over.hive ?? true),
    classifier: {
      record: () => Promise.resolve(over.record === undefined ? recordOf() : over.record),
      classify: (n) => {
        classified.push(n);
        return Promise.resolve(over.again ?? recordOf());
      },
    },
    now: () => Promise.resolve({ hash: over.hash ?? HASH, forge: FORGE }),
    folder: () => Promise.resolve(folder),
    workspaces: () => Promise.resolve(over.workspaces ?? []),
    taken: (branch) => Promise.resolve((over.taken ?? []).includes(branch)),
    due: (number, step, forge, at) => {
      dues.push({ number, step, forge, at });
      return Promise.resolve();
    },
    start: (request) => {
      started.push(request);
      return Promise.resolve({
        workspace: summary({ branch: request.branch, issue: request.issue }),
        prompt: '',
      });
    },
  };
  return { service: issueStarter(ctx), started, classified, folder, dues };
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

describe('startFromIssue (HV10b)', () => {
  it('builds the request from the decision: kind, title, parts, model, effort, the branch and the issue', async () => {
    const { service, started, folder } = starter();
    await service.start(3, { by: 'page' });
    expect(started).toHaveLength(1);
    const request = started[0]!;
    expect(request).toMatchObject({
      kind: 'fix',
      title: TAKE.title,
      branch: 'fix/3-forge-errors-log-the-authorization',
      planFirst: false,
      agent: 'claude',
      model: TAKE.model,
      effort: TAKE.effort,
      issue: ISSUE,
    });
    expect(request.via).toBeUndefined();
    // Only the kind's own parts with text: a fix's, none of a feature's empty "goal".
    expect(Object.keys(request.parts ?? {}).sort()).toEqual(
      Object.entries(TAKE.parts)
        .filter(([, text]) => text.trim() !== '')
        .map(([part]) => part)
        .sort(),
    );
    expect(await readIssueEvents(folder, 3)).toEqual([
      {
        event: 'started',
        at: '2026-11-13T19:00:00.000Z',
        branch: 'fix/3-forge-errors-log-the-authorization',
        identity: 'id-1',
      },
    ]);
  });

  it('its author is due to hear it was taken, in the branch (HV11)', async () => {
    const { service, dues } = starter();
    await service.start(3, { by: 'page' });
    expect(dues).toEqual([
      {
        number: 3,
        step: { step: 'taken', branch: 'fix/3-forge-errors-log-the-authorization' },
        forge: FORGE,
        at: '2026-11-13T19:00:00.000Z',
      },
    ]);
  });

  it("records Nucleus's start as Nucleus's, and its start branch", async () => {
    const { service, started } = starter();
    await service.start(3, { by: 'nucleus', from: 'release' });
    expect(started[0]).toMatchObject({ via: 'nucleus', from: 'release' });
  });

  it('refuses with Hive off, an issue never classified, asked, refused or failed', async () => {
    expect(await refusal(starter({ hive: false }).service.start(3, { by: 'page' }))).toEqual({
      status: 409,
      message: 'Hive mode is off: work starts from an issue only while it is on',
    });
    expect(await refusal(starter({ record: null }).service.start(3, { by: 'page' }))).toEqual({
      status: 409,
      message: 'Issue #3 is not classified: classify it first',
    });
    for (const [decision, words] of [
      ['ask', 'asked its author a question'],
      ['refuse', 'refused it'],
      ['failed', 'did not answer'],
    ] as const) {
      const { service, started } = starter({ record: recordOf({ decision }) });
      expect(await refusal(service.start(3, { by: 'page' }))).toEqual({
        status: 409,
        message: `Issue #3 is not taken: the classifier ${words}`,
      });
      expect(started).toEqual([]);
    }
  });

  it('classifies a changed issue again first, and the new decision holds', async () => {
    const refused = starter({ hash: 'c'.repeat(64), again: recordOf({ decision: 'refuse' }) });
    expect(await refusal(refused.service.start(3, { by: 'page' }))).toMatchObject({
      message: 'Issue #3 is not taken: the classifier refused it',
    });
    expect(refused.classified).toEqual([3]);
    expect(refused.started).toEqual([]);

    const newer = recordOf({ snapshot: { ...recordOf().snapshot, hash: 'c'.repeat(64) } });
    const taken = starter({ hash: 'c'.repeat(64), again: newer });
    await taken.service.start(3, { by: 'page' });
    expect(taken.classified).toEqual([3]);
    expect(taken.started[0]?.issue?.hash).toBe('c'.repeat(64));

    const same = starter();
    await same.service.start(3, { by: 'page' });
    expect(same.classified).toEqual([]);
  });

  it("starts a held take only from the page: the person's click (decision 1061)", async () => {
    const held = recordOf({ held: ['new-dependency'] });
    for (const by of ['nucleus', 'mcp'] as const) {
      const { service, started } = starter({ record: held });
      expect(await refusal(service.start(3, { by }))).toEqual({
        status: 409,
        message:
          'Issue #3 is held for the person: it adds or replaces a dependency. They start it with Start in Hive on the Issues page',
      });
      expect(started).toEqual([]);
    }
    const { service, started } = starter({ record: held });
    await service.start(3, { by: 'page' });
    expect(started).toHaveLength(1);
  });

  it('refuses an issue whose workspace is open; one landed, merged or of another forge does not count', async () => {
    const open = summary({ issue: ISSUE, hive: { step: 'checking' } as WorkspaceSummary['hive'] });
    expect(await refusal(starter({ workspaces: [open] }).service.start(3, { by: 'page' }))).toEqual(
      {
        status: 409,
        message:
          'Issue #3 has a workspace already: fix/3-forge-errors-log-the-authorization, checking',
      },
    );
    const ended = [
      summary({ issue: ISSUE, merged: true }),
      summary({ issue: ISSUE, hive: { step: 'landed' } as WorkspaceSummary['hive'] }),
      summary({ issue: { ...ISSUE, project: 'other/app' } }),
      summary({ issue: { ...ISSUE, number: 4 } }),
    ];
    const { service, started } = starter({
      workspaces: ended,
      taken: ['fix/3-forge-errors-log-the-authorization'],
    });
    await service.start(3, { by: 'page' });
    // The branch an earlier workspace left: -2 after it (decision 1062).
    expect(started[0]?.branch).toBe('fix/3-forge-errors-log-the-authorization-2');
    expect(openWorkspaceOf(ended, 3, FORGE)).toBeUndefined();
  });

  it('starts one workspace for two clicks at once', async () => {
    const { service, started } = starter();
    const [a, b] = await Promise.allSettled([
      service.start(3, { by: 'page' }),
      service.start(3, { by: 'page' }),
    ]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(started).toHaveLength(1);
  });
});

describe("the issue's branch (decisions 1013, 1062)", () => {
  it('is <kind>/<number>-<slug>, numbered when taken', async () => {
    expect(issueSlug("Config isn't read: null crash on Ünïcode paths")).toBe(
      'config-isnt-read-null-crash',
    );
    expect(issueSlug('!!!')).toBe('issue');
    const taken = (names: string[]) => (b: string) => Promise.resolve(names.includes(b));
    expect(await issueBranch('fix', 412, 'Config null', taken([]))).toBe('fix/412-config-null');
    expect(
      await issueBranch(
        'feature',
        9,
        'Dark mode',
        taken(['feature/9-dark-mode', 'feature/9-dark-mode-2']),
      ),
    ).toBe('feature/9-dark-mode-3');
  });
});

describe("a start's request (decision 1061)", () => {
  it('drops an issue sent to POST /api/workspaces: only the start from an issue sets it', () => {
    const request = parseWorkspaceRequest(
      JSON.stringify({
        kind: 'fix',
        title: 'T',
        parts: { happens: 'x' },
        branch: 'fix/t',
        planFirst: false,
        issue: ISSUE,
      }),
    );
    expect(request.issue).toBeUndefined();
  });
});

describe('a take judged (decision 1066)', () => {
  it('once per workspace, under the identity its start recorded; never a workspace with no start', async () => {
    const folder = tempDir();
    await judgeTake(folder, 3, 'fix/3-x', { right: true, why: 'landed', at: 'T1' });
    expect(await readIssueEvents(folder, 3)).toEqual([]);
    await appendIssueEvent(folder, 3, {
      event: 'started',
      at: 'T0',
      branch: 'fix/3-x',
      identity: 'id-1',
    });
    await judgeTake(folder, 3, 'fix/3-x', { right: false, why: 'closed', at: 'T1' });
    await judgeTake(folder, 3, 'fix/3-x', { right: true, why: 'landed', at: 'T2' });
    expect((await readIssueEvents(folder, 3)).filter((e) => e.event === 'judged')).toEqual([
      {
        event: 'judged',
        at: 'T1',
        identity: 'id-1',
        right: false,
        why: 'closed',
        branch: 'fix/3-x',
      },
    ]);
  });
});
