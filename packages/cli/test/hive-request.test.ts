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
  readLandsBy,
  requestBody,
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
    });
    repo.git('remote', 'add', 'origin', '/srv/git/app.git');
    expect(await originForge(git, {})).toMatchObject({
      why: expect.stringMatching(/^origin is not a GitHub or GitLab repository: /) as string,
    });
    repo.git('remote', 'set-url', 'origin', 'git@github.com:acme/app.git');
    expect(await originForge(git, {}, make(false))).toMatchObject({
      why: 'no GitHub token for github.com: set GITHUB_TOKEN or GH_TOKEN, or log in with gh auth login',
    });
    const found = await originForge(git, {}, make(true));
    expect('why' in found).toBe(false);
    expect(await landingSetting(git, repo.root, {}, make(true))).toEqual({
      by: 'queue',
      forge: { kind: 'github', host: 'github.com', project: 'acme/app' },
      token: true,
    });
    repo.git('remote', 'set-url', 'origin', 'https://gitlab.com/acme/app.git');
    expect(await landingSetting(git, repo.root, {}, make(false))).toEqual({
      by: 'queue',
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
