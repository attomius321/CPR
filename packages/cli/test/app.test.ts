import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { findApp, openAppWindow, type AppWindow } from '../src/app.js';

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

describe('findApp', () => {
  it('is off with CPR_APP=off, and runs CPR_APP when it names a command', () => {
    expect(findApp({ CPR_APP: 'off' })).toBeNull();
    const app = fakeApp('named', '');
    expect(findApp({ CPR_APP: app })).toEqual({ command: app, args: [] });
    expect(findApp({ CPR_APP: join(dir, 'missing') })).toBeNull();
  });

  it("finds this checkout's app: Electron's binary and the built app, or nothing", () => {
    const found = findApp({});
    if (found === null) return; // not set up here (`pnpm app:setup`): the browser
    expect(existsSync(found.command)).toBe(true);
    expect(found.args).toHaveLength(1);
    expect(existsSync(join(found.args[0] as string, 'dist', 'main.js'))).toBe(true);
  });
});

describe('openAppWindow', () => {
  const url = 'http://127.0.0.1:4100/';

  it('resolves once the app shows the page, and knows when its window closes', async () => {
    const app = fakeApp(
      'shows',
      `console.log('CPR window: ' + process.argv[process.argv.indexOf('--url') + 1]);
process.on('SIGTERM', () => process.exit(0));
setInterval(() => undefined, 1000);`,
    );
    const opened = await openAppWindow({ command: app, args: ['/the/app'] }, url, 'ky', {
      ELECTRON_RUN_AS_NODE: '1',
      PATH: process.env.PATH,
    });
    expect(isWindow(opened)).toBe(true);
    // The app's folder first, then what to show; never as plain Node.
    expect(ran(app)).toEqual({
      argv: ['/the/app', '--url', url, '--title', 'ky'],
      runAsNode: null,
    });
    if (!isWindow(opened)) return;
    let closed = false;
    void opened.closed.then(() => (closed = true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(false);
    opened.close();
    await opened.closed;
  });

  it("gives the app's own words when it ends before showing anything", async () => {
    const app = fakeApp(
      'fails',
      `process.stderr.write('[123:ERROR] some chromium noise\\n');
process.stderr.write('cpr app: could not load ${url}: ERR_CONNECTION_REFUSED (-102)\\n');
process.stderr.write('more noise\\n');
process.exit(1);`,
    );
    expect(await openAppWindow({ command: app, args: [] }, url, 'ky', {})).toEqual({
      error: `could not load ${url}: ERR_CONNECTION_REFUSED (-102)`,
    });
  });

  it("names Chromium's sandbox when the system refuses it (Ubuntu 24.04's AppArmor)", async () => {
    const app = fakeApp(
      'sandbox',
      `process.stderr.write('[9:FATAL:zygote_host_impl_linux.cc(132)] No usable sandbox! If you are running on Ubuntu 23.10+ …\\n');
process.exit(133);`,
    );
    expect(await openAppWindow({ command: app, args: [] }, url, 'ky', {})).toEqual({
      error: "Chromium's sandbox is not allowed here (AppArmor): see CPR's window in the README",
    });
  });

  it('says how it ended when it said nothing', async () => {
    const app = fakeApp('quiet', 'process.exit(3);');
    expect(await openAppWindow({ command: app, args: [] }, url, 'ky', {})).toEqual({
      error: 'it exited with 3',
    });
    const missing = await openAppWindow({ command: join(dir, 'missing'), args: [] }, url, 'ky', {});
    expect('error' in missing && missing.error).toContain('ENOENT');
  });
});
