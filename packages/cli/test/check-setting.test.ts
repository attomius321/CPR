// fix/settings-page: the check (`merge.checks`) set from Settings, one for the merger and Hive.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRepo } from '@symbiote/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, type TestRepo } from '../../core/test/helpers/git-repo.js';
import { checkSettingService, parseCheckChange } from '../src/check-setting.js';
import { projectCheck, readMergeConfig } from '../src/merges.js';

const repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

/** A repository whose `package.json` has a `check` script: the check Symbiote finds. */
async function repository() {
  const repo = createRepo();
  repo.write({ 'package.json': JSON.stringify({ scripts: { check: 'vitest run' } }) });
  repo.commit('A');
  repos.push(repo);
  return { repo, service: checkSettingService(await openRepo(repo.root), repo.root) };
}

const configOf = (repo: TestRepo) =>
  JSON.parse(readFileSync(join(repo.root, 'symbiote', 'config.json'), 'utf8')) as unknown;

describe("Settings' check", () => {
  it('reads none set, and the check Symbiote finds in its place', async () => {
    const { service } = await repository();
    const read = await service.read();
    expect(read).toMatchObject({
      file: 'symbiote/config.json',
      version: 'none',
      found: { commands: ['npm install', 'npm run check'] },
    });
    expect(read.commands).toBeUndefined();
    expect(read.found?.source).toContain('package.json');
  });

  it('saves the commands as merge.checks, the rest of the file kept; the merger and Hive run them', async () => {
    const { repo, service } = await repository();
    mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
    writeFileSync(
      join(repo.root, 'symbiote', 'config.json'),
      '{ "merge": { "push": true }, "hive": { "lands": "request" } }\n',
    );
    const { version } = await service.read();
    const saved = await service.set({
      commands: ['pnpm install --frozen-lockfile', 'pnpm check'],
      version,
    });
    expect(saved.commands).toEqual(['pnpm install --frozen-lockfile', 'pnpm check']);
    expect(saved.version).not.toBe(version);
    expect(configOf(repo)).toEqual({
      merge: { push: true, checks: ['pnpm install --frozen-lockfile', 'pnpm check'] },
      hive: { lands: 'request' },
    });
    expect(readMergeConfig(repo.root).checks).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm check',
    ]);
    // One check for both modes: the merger's and Hive's (`projectCheck`).
    const repoOf = await openRepo(repo.root);
    expect(await projectCheck(repoOf, repo.root, 'HEAD')).toMatchObject({
      commands: ['pnpm install --frozen-lockfile', 'pnpm check'],
    });
  });

  it("removes merge.checks on a reset (null), an emptied section with it: the found check's again", async () => {
    const { repo, service } = await repository();
    const first = await service.set({ commands: ['make test'], version: 'none' });
    expect(configOf(repo)).toEqual({ merge: { checks: ['make test'] } });
    const reset = await service.set({ commands: null, version: first.version });
    expect(reset.commands).toBeUndefined();
    expect(reset.found?.commands).toEqual(['npm install', 'npm run check']);
    expect(configOf(repo)).toEqual({});
  });

  it('refuses a save over a file changed since it was read, and over a file that is not JSON', async () => {
    const { repo, service } = await repository();
    const { version } = await service.read();
    mkdirSync(join(repo.root, 'symbiote'), { recursive: true });
    writeFileSync(join(repo.root, 'symbiote', 'config.json'), '{ "merge": {} }\n');
    await expect(service.set({ commands: ['make'], version })).rejects.toMatchObject({
      status: 409,
    });
    writeFileSync(join(repo.root, 'symbiote', 'config.json'), '{ nope');
    const broken = await service.read();
    expect(broken.warning).toContain('not JSON');
    await expect(
      service.set({ commands: ['make'], version: broken.version }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('parseCheckChange', () => {
  it('takes the commands trimmed, empty ones dropped, or null for the found check', () => {
    expect(
      parseCheckChange(JSON.stringify({ commands: ['  pnpm check ', '', ' '], version: 'v' })),
    ).toEqual({ commands: ['pnpm check'], version: 'v' });
    expect(parseCheckChange(JSON.stringify({ commands: null, version: 'v' }))).toEqual({
      commands: null,
      version: 'v',
    });
  });

  it('refuses no command, a command over lines, too many or too long, and no version', () => {
    for (const body of [
      { commands: [], version: 'v' },
      { commands: [' '], version: 'v' },
      { commands: 'pnpm check', version: 'v' },
      { commands: ['pnpm install\npnpm check'], version: 'v' },
      { commands: [3], version: 'v' },
      { commands: Array.from({ length: 21 }, (_, i) => `step ${i}`), version: 'v' },
      { commands: ['x'.repeat(1001)], version: 'v' },
      { commands: ['pnpm check'] },
    ]) {
      expect(() => parseCheckChange(JSON.stringify(body)), JSON.stringify(body)).toThrow();
    }
  });
});
