import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { electronBinary, findApp, openAppWindow, type AppWindow } from '../src/app-window.js';

// The same cases as the CLI's `test/app.test.ts`: the nexus starts the app as `symbiote view` does.
const dir = tempDir();
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A fake app: a Node script run as the app's command, `body` after it records how it ran. */
function fakeApp(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    `#!${process.execPath}
const { writeFileSync } = require('node:fs');
writeFileSync(${JSON.stringify(`${path}.ran`)}, JSON.stringify({
  argv: process.argv.slice(2),
  runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
}));
${body}
`,
  );
  chmodSync(path, 0o755);
  return path;
}

const ran = (app: string) =>
  JSON.parse(readFileSync(`${app}.ran`, 'utf8')) as { argv: string[]; runAsNode: string | null };

const isWindow = (opened: AppWindow | { error: string }): opened is AppWindow => 'closed' in opened;

/**
 * A desktop package with an `electron` whose code writes a mark when it runs: Electron 44 downloads
 * its binary when it is required without one (IN1). `binary`: its `path.txt` and that file.
 */
function fakeDesktop(name: string, binary: boolean): { desktop: string; ran: string } {
  const desktop = join(dir, name);
  const electron = join(desktop, 'node_modules', 'electron');
  mkdirSync(join(electron, 'dist'), { recursive: true });
  writeFileSync(join(desktop, 'package.json'), '{ "name": "@symbiote/desktop" }');
  writeFileSync(join(electron, 'package.json'), '{ "name": "electron", "main": "index.js" }');
  const ran = join(desktop, 'electron-ran');
  writeFileSync(
    join(electron, 'index.js'),
    `require('fs').writeFileSync(${JSON.stringify(ran)}, 'downloading');`,
  );
  if (binary) {
    writeFileSync(join(electron, 'path.txt'), 'electron');
    writeFileSync(join(electron, 'dist', 'electron'), '');
  }
  return { desktop, ran };
}

describe('electronBinary', () => {
  it("finds Electron's binary without running Electron's code, which would download it", () => {
    const set = fakeDesktop('set-up', true);
    expect(electronBinary(set.desktop)).toBe(
      join(set.desktop, 'node_modules', 'electron', 'dist', 'electron'),
    );
    const none = fakeDesktop('not-set-up', false);
    expect(electronBinary(none.desktop)).toBeNull();
    // Named but gone (a cleaned folder): none either.
    writeFileSync(join(none.desktop, 'node_modules', 'electron', 'path.txt'), 'electron');
    expect(electronBinary(none.desktop)).toBeNull();
    expect(electronBinary(join(dir, 'no-desktop'))).toBeNull();
    expect(existsSync(set.ran) || existsSync(none.ran)).toBe(false);
  });
});

describe('findApp', () => {
  it('is off with SYMBIOTE_APP=off, and runs SYMBIOTE_APP when it names a command', () => {
    expect(findApp({ SYMBIOTE_APP: 'off' })).toBeNull();
    const app = fakeApp('named', '');
    expect(findApp({ SYMBIOTE_APP: app })).toEqual({ command: app, args: [] });
    expect(findApp({ SYMBIOTE_APP: join(dir, 'missing') })).toBeNull();
  });
});

describe('openAppWindow', () => {
  const url = 'http://127.0.0.1:4100/';

  it('starts the app on the address with its title, and knows when its window closes', async () => {
    const app = fakeApp(
      'shows',
      `console.log('Symbiote window: ' + process.argv[process.argv.indexOf('--url') + 1]);
process.on('SIGTERM', () => process.exit(0));
setInterval(() => undefined, 1000);`,
    );
    const opened = await openAppWindow(
      { command: app, args: ['/the/app'] },
      url,
      'Symbiote nexus',
      { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH },
    );
    expect(isWindow(opened)).toBe(true);
    expect(ran(app)).toEqual({
      argv: ['/the/app', '--url', url, '--title', 'Symbiote nexus'],
      runAsNode: null,
    });
    if (!isWindow(opened)) return;
    opened.close();
    await opened.closed;
  });

  it("gives the app's own words, else Chromium's sandbox, else how it ended", async () => {
    const fails = fakeApp(
      'fails',
      `process.stderr.write('noise\\nsymbiote app: could not load ${url}: ERR_CONNECTION_REFUSED (-102)\\n');
process.exit(1);`,
    );
    expect(await openAppWindow({ command: fails, args: [] }, url, 't', {})).toEqual({
      error: `could not load ${url}: ERR_CONNECTION_REFUSED (-102)`,
    });
    const sandbox = fakeApp(
      'sandbox',
      `process.stderr.write('[9:FATAL:zygote_host_impl_linux.cc(132)] No usable sandbox!\\n');
process.exit(133);`,
    );
    expect(await openAppWindow({ command: sandbox, args: [] }, url, 't', {})).toEqual({
      error:
        "Chromium's sandbox is not allowed here (AppArmor): see Symbiote's window in the README",
    });
    const quiet = fakeApp('quiet', 'process.exit(3);');
    expect(await openAppWindow({ command: quiet, args: [] }, url, 't', {})).toEqual({
      error: 'it exited with 3',
    });
  });
});
