// HV8: the setting `hive.lands`, the forge `origin` names and its token, the request's description.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo } from '@symbiote/core';
import { GitHubForge, GitLabForge } from '@symbiote/forge';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { firstRecord } from '../src/hive-record.js';
import {
  landingSetting,
  originForge,
  readIssueLandsBy,
  readLandsBy,
  requestBody,
  setIssueLandsBy,
  setLandsBy,
} from '../src/hive-request.js';

const repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

function repository() {
  const repo = createRepo();
  repo.write({ 'a.txt': 'a\n' });
  repo.commit('A');
  repos.push(repo);
  return repo;
}

describe('hive.lands', () => {
  it('is the merge queue unless the config says request; Settings writes it', async () => {
    const repo = repository();
    expect(readLandsBy(repo.root)).toBe('queue');
    mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
    writeFileSync(join(repo.root, 'symbiote', 'config.json'), '{ "hive": { "lands": "nope" } }\n');
    expect(readLandsBy(repo.root)).toBe('queue');
    await setLandsBy(repo.root, 'request');
    expect(readLandsBy(repo.root)).toBe('request');
    expect(JSON.parse(readFileSync(join(repo.root, 'symbiote', 'config.json'), 'utf8'))).toEqual({
      hive: { lands: 'request' },
    });
    await setLandsBy(repo.root, 'queue');
    expect(readLandsBy(repo.root)).toBe('queue');
    await expect(setLandsBy(repo.root, 'merge')).rejects.toThrow(
      'Hive lands by "queue" or "request"',
    );
  });
});

describe('hive.issues.lands (HV10c, decision 1016)', () => {
  it('is a request unless the config says queue, whatever hive.lands says; Settings writes it', async () => {
    const repo = repository();
    expect(readIssueLandsBy(repo.root)).toBe('request');
    mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
    writeFileSync(join(repo.root, 'symbiote', 'config.json'), '{ "hive": { "lands": "queue" } }\n');
    expect(readLandsBy(repo.root)).toBe('queue');
    expect(readIssueLandsBy(repo.root)).toBe('request');
    await setIssueLandsBy(repo.root, 'queue');
    expect(readIssueLandsBy(repo.root)).toBe('queue');
    expect(JSON.parse(readFileSync(join(repo.root, 'symbiote', 'config.json'), 'utf8'))).toEqual({
      hive: { lands: 'queue', issues: { lands: 'queue' } },
    });
    await setIssueLandsBy(repo.root, 'request');
    expect(readIssueLandsBy(repo.root)).toBe('request');
    expect(JSON.parse(readFileSync(join(repo.root, 'symbiote', 'config.json'), 'utf8'))).toEqual({
      hive: { lands: 'queue' },
    });
    await expect(setIssueLandsBy(repo.root, 'merge')).rejects.toThrow(
      'Work from an issue lands by "queue" or "request"',
    );
  });
});

describe("origin's forge", () => {
  const make = (token: boolean) => (url: string) =>
    url.includes('gitlab')
      ? new GitLabForge('gitlab.com', 'acme/app', token ? { GITLAB_TOKEN: 'x' } : {})
      : new GitHubForge(
          'github.com',
          'acme/app',
          token ? { GITHUB_TOKEN: 'x' } : {},
          () => undefined,
        );

  it('says why it cannot open a request: no origin, not a forge, no token', async () => {
    const repo = repository();
    const git = await openRepo(repo.root);
    expect(await originForge(git, {}, make(true))).toEqual({
      why: 'the repository has no remote named origin',
      missing: 'origin',
    });
    repo.git('remote', 'add', 'origin', '/srv/git/app.git');
    expect(await originForge(git, {})).toMatchObject({
      why: expect.stringMatching(/^origin is not a GitHub or GitLab repository: /) as string,
      missing: 'forge',
    });
    repo.git('remote', 'set-url', 'origin', 'git@github.com:acme/app.git');
    expect(await originForge(git, {}, make(false))).toMatchObject({
      why: 'no GitHub token for github.com: set GITHUB_TOKEN or GH_TOKEN, or log in with gh auth login',
      missing: 'token',
    });
    const found = await originForge(git, {}, make(true));
    expect('why' in found).toBe(false);
    expect(await landingSetting(git, repo.root, {}, make(true))).toEqual({
      by: 'queue',
      // HV10c: a workspace from an issue lands by request unless set.
      issues: 'request',
      forge: { kind: 'github', host: 'github.com', project: 'acme/app' },
      token: true,
    });
    // A forge's address git reaches elsewhere (`insteadOf`): the forge it names.
    repo.git('remote', 'set-url', 'origin', 'https://github.com/acme/app.git');
    repo.git('config', 'url./srv/git/app.git.insteadOf', 'https://github.com/acme/app.git');
    expect(
      (
        await landingSetting(git, repo.root, {}, (url) => {
          if (!url.includes('github.com')) throw new Error(`not a forge: ${url}`);
          return make(true)(url);
        })
      ).forge,
    ).toEqual({ kind: 'github', host: 'github.com', project: 'acme/app' });
    repo.git('config', '--unset', 'url./srv/git/app.git.insteadOf');
    repo.git('remote', 'set-url', 'origin', 'https://gitlab.com/acme/app.git');
    expect(await landingSetting(git, repo.root, {}, make(false))).toEqual({
      by: 'queue',
      // HV10c: a workspace from an issue lands by request unless set.
      issues: 'request',
      forge: { kind: 'gitlab', host: 'gitlab.com', project: 'acme/app' },
      token: false,
      why: 'no GitLab token for gitlab.com: set GITLAB_TOKEN (a personal or project access token with api scope)',
    });
  });
});

describe("the request's description", () => {
  it('the brief, what ran round by round, and Hive’s approval', () => {
    const record = {
      ...firstRecord('feature/x', '2026-11-02T10:00:00Z'),
      checks: [
        {
          round: 1,
          at: 'a'.repeat(40),
          ok: false,
          ms: 1000,
          failed: 'pnpm test',
          commands: ['pnpm test'],
        },
        { round: 2, at: 'b'.repeat(40), ok: true, ms: 1000, commands: ['pnpm test', 'pnpm build'] },
      ],
      reviews: [
        { round: 2, at: 'b'.repeat(40), verdict: 'approved' as const, findings: [], started: '' },
      ],
    };
    const body = requestBody(record as never, {
      brief: '# Add x\n\nThe brief.',
      approval:
        'Approved by Hive at bbbbbbb: checked (2 commands, round 2); reviewed (approved, round 2).',
      kind: 'github',
    });
    expect(body).toBe(
      [
        '# Add x\n\nThe brief.',
        '---',
        '**What Hive ran**',
        '- Round 1, `aaaaaaa`: the check failed on `pnpm test` (1 command: `pnpm test`)\n' +
          '- Round 2, `bbbbbbb`: the check passed (2 commands: `pnpm test`, `pnpm build`)\n' +
          '- Round 2, `bbbbbbb`: the running review approved',
        '**Approved by Hive at bbbbbbb: checked (2 commands, round 2); reviewed (approved, round 2).**',
        "Opened by Symbiote's Hive. Merge this pull request to land it; close it to stop the workspace. The forge's CI is not waited on.",
      ].join('\n\n'),
    );
  });
});

describe("the request's description of a workspace from an issue (HV10c, decision 1017)", () => {
  it('starts with Closes #n., then the brief', () => {
    const record = firstRecord('fix/12-x', '2026-11-02T10:00:00Z');
    const body = requestBody(record, {
      brief: 'From issue #12 (https://github.com/acme/app/issues/12).\n\n# Fix: X',
      approval: 'Approved by Hive.',
      kind: 'gitlab',
      issue: { number: 12 },
    });
    expect(body.split('\n\n').slice(0, 3)).toEqual([
      'Closes #12.',
      'From issue #12 (https://github.com/acme/app/issues/12).',
      '# Fix: X',
    ]);
    expect(requestBody(record, { brief: 'B', approval: 'A', kind: 'github' })).toMatch(/^B\n/);
  });
});
