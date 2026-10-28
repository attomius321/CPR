import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { findApp, openAppWindow, type AppWindow } from '../src/app-window.js';

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
