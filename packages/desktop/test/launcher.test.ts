import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readRecorded, readyUrl, serverError, startServer, withRecent } from '../src/launcher.js';

const dir = mkdtempSync(join(tmpdir(), 'symbiote-launcher-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('readyUrl', () => {
  it("reads the address from symbiote view's line", () => {
    expect(readyUrl('Symbiote viewer: http://127.0.0.1:41234/  (Ctrl+C to stop)\n')).toBe(
      'http://127.0.0.1:41234/',
    );
    expect(readyUrl('hint: x\nSymbiote viewer: http://127.0.0.1:1/\n')).toBe('http://127.0.0.1:1/');
  });

  it('waits for the whole line, and takes no other server', () => {
    expect(readyUrl('Symbiote viewer: http://127.0.0.1:41')).toBeNull();
    expect(readyUrl('Symbiote viewer: http://example.com/  (Ctrl+C to stop)\n')).toBeNull();
    expect(readyUrl('')).toBeNull();
  });
});

describe('withRecent', () => {
  it('puts the repository first, once, and keeps ten', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `/r/${i}`);
    expect(withRecent(ten, '/r/5')).toEqual(['/r/5', ...ten.filter((r) => r !== '/r/5')]);
    expect(withRecent(ten, '/new')).toEqual(['/new', ...ten.slice(0, 9)]);
    expect(withRecent([], '/a')).toEqual(['/a']);
  });
});

describe('readRecorded', () => {
  it('reads what symbiote app install recorded: node, the CLI and PATH', () => {
    const file = join(dir, 'app.json');
    writeFileSync(file, JSON.stringify({ node: '/n/node', cli: '/c/bin.js', path: '/n:/usr/bin' }));
    expect(readRecorded(file)).toEqual({ node: '/n/node', cli: '/c/bin.js', path: '/n:/usr/bin' });
  });

  it('is nothing without node and the CLI as absolute paths', () => {
    expect(readRecorded(join(dir, 'missing.json'))).toBeNull();
    for (const value of [{ node: 'node', cli: '/c/bin.js' }, { node: '/n/node' }, [], 'x']) {
      writeFileSync(join(dir, 'odd.json'), JSON.stringify(value));
      expect(readRecorded(join(dir, 'odd.json'))).toBeNull();
    }
  });
});

describe('serverError', () => {
  it("says the server's own words: its last symbiote: line", () => {
    expect(
      serverError('warning: x\nsymbiote: not inside a git working tree: /home/a/notes\n', 1),
    ).toBe('not inside a git working tree: /home/a/notes');
  });

  it('else how it ended', () => {
    expect(serverError('', 1)).toBe('symbiote view exited with 1');
    expect(serverError('Error: boom\n    at x\n', null)).toBe('symbiote view ended: Error: boom');
  });
});

describe('startServer', () => {
  /** A fake CLI: records how it ran in `<repo>/ran.json`, then `body`. */
  function fakeCli(name: string, body: string): string {
    const path = join(dir, `${name}.cjs`);
    writeFileSync(
      path,
      `require('node:fs').writeFileSync('ran.json', JSON.stringify({
  argv: process.argv.slice(2),
  stops: process.env.SYMBIOTE_STDIN_STOPS ?? null,
  path: process.env.PATH ?? null,
}));
${body}`,
    );
    return path;
  }
  const repo = join(dir, 'repo');
  mkdirSync(repo);

  it("starts symbiote view in the repository, on the recorded PATH, ending with the app's stdin", async () => {
    const cli = fakeCli(
      'serves',
      `process.stdout.write('Symbiote viewer: http://127.0.0.1:4321/  (Ctrl+C to stop)\\n');
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();`,
    );
    const started = await startServer(repo, { node: process.execPath, cli, path: '/rec/bin' }, {});
    expect('url' in started && started.url).toBe('http://127.0.0.1:4321/');
    expect(JSON.parse(readFileSync(join(repo, 'ran.json'), 'utf8'))).toEqual({
      argv: ['view', '--no-open'],
      stops: '1',
      path: '/rec/bin',
    });
    if (!('child' in started)) return;
    const ended = new Promise((resolve) => started.child.once('exit', resolve));
    started.child.stdin?.end();
    expect(await ended).toBe(0);
  });

  it("gives symbiote view's own words when it does not serve", async () => {
    const cli = fakeCli(
      'refuses',
      `process.stderr.write('symbiote: not inside a git working tree: ' + process.cwd() + '\\n');
process.exit(1);`,
    );
    expect(await startServer(repo, { node: process.execPath, cli }, {})).toEqual({
      error: `not inside a git working tree: ${repo}`,
    });
  });

  it('says when the folder is gone', async () => {
    const cli = fakeCli('never', '');
    expect(await startServer(join(dir, 'gone'), { node: process.execPath, cli }, {})).toEqual({
      error: `no such folder: ${join(dir, 'gone')}`,
    });
  });
});
