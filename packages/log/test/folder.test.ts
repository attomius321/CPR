import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dayOf, logsDir, pruneLogs } from '../src/index.js';

describe('logsDir', () => {
  const home = '/home/someone';

  it('is SYMBIOTE_LOG_DIR when set', () => {
    expect(logsDir({ SYMBIOTE_LOG_DIR: '/var/x', SYMBIOTE_CACHE_DIR: '/c' }, 'linux', home)).toBe(
      '/var/x',
    );
  });

  it("is logs in the cache folder, by the CLI's rules", () => {
    expect(logsDir({ SYMBIOTE_CACHE_DIR: '/c' }, 'linux', home)).toBe('/c/logs');
    expect(logsDir({ XDG_CACHE_HOME: '/xdg' }, 'linux', home)).toBe('/xdg/symbiote/logs');
    expect(logsDir({}, 'darwin', home)).toBe('/home/someone/Library/Caches/symbiote/logs');
    expect(logsDir({}, 'linux', home)).toBe('/home/someone/.cache/symbiote/logs');
  });
});

describe('dayOf', () => {
  it("is the local day's name", () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dayOf(new Date(2026, 9, 25, 0, 0))).toBe('2026-10-25');
  });
});

describe('pruneLogs', () => {
  it('removes the day files older than 14 days and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbiote-logs-'));
    const names = [
      '2026-10-25.jsonl', // today
      '2026-10-12.jsonl', // the 14th day, kept
      '2026-10-11.jsonl',
      '2026-09-01.jsonl',
      'seen.json',
      'notes.jsonl',
    ];
    for (const name of names) writeFileSync(join(dir, name), '');
    const removed = await pruneLogs(dir, new Date(2026, 9, 25, 9, 0));
    expect(removed.sort()).toEqual(['2026-09-01.jsonl', '2026-10-11.jsonl']);
    expect(readdirSync(dir).sort()).toEqual([
      '2026-10-12.jsonl',
      '2026-10-25.jsonl',
      'notes.jsonl',
      'seen.json',
    ]);
  });

  it('does nothing when the folder is missing', async () => {
    expect(await pruneLogs(join(tmpdir(), 'symbiote-no-such-folder'), new Date())).toEqual([]);
  });
});
