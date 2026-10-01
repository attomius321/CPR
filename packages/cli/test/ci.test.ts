import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { ciChangeRequestNumber } from '../src/ci.js';

describe('ciChangeRequestNumber', () => {
  const dir = tempDir();
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const event = (name: string, payload: unknown) => {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify(payload));
    return path;
  };

  it('reads GitHub Actions pull request events', () => {
    const pr = event('pr', { action: 'synchronize', pull_request: { number: 42 } });
    expect(ciChangeRequestNumber({ GITHUB_EVENT_PATH: pr })).toBe(42);
    const comment = event('comment', { issue: { number: 7, pull_request: { url: 'x' } } });
    expect(ciChangeRequestNumber({ GITHUB_EVENT_PATH: comment })).toBe(7);
  });

  it('ignores events that are not about a pull request', () => {
    expect(ciChangeRequestNumber({ GITHUB_EVENT_PATH: event('push', { ref: 'main' }) })).toBe(
      undefined,
    );
    expect(
      ciChangeRequestNumber({ GITHUB_EVENT_PATH: event('issue', { issue: { number: 3 } }) }),
    ).toBe(undefined);
    expect(ciChangeRequestNumber({ GITHUB_EVENT_PATH: join(dir, 'missing.json') })).toBe(undefined);
    expect(ciChangeRequestNumber({})).toBe(undefined);
  });

  it("reads GitLab's merge request pipelines", () => {
    expect(ciChangeRequestNumber({ CI_MERGE_REQUEST_IID: '12' })).toBe(12);
    expect(ciChangeRequestNumber({ CI_MERGE_REQUEST_IID: 'x' })).toBe(undefined);
  });
});
