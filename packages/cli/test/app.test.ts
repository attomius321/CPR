import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { FORMER_NAME } from '../src/former-name.js';
import {
  desktopEntry,
  findApp,
  installApp,
  openAppWindow,
  recordAgain,
  uninstallApp,
  type AppWindow,
} from '../src/app.js';

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
      `console.log('Symbiote window: ' + process.argv[process.argv.indexOf('--url') + 1]);
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
process.stderr.write('symbiote app: could not load ${url}: ERR_CONNECTION_REFUSED (-102)\\n');
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
      error:
        "Chromium's sandbox is not allowed here (AppArmor): see Symbiote's window in the README",
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

describe('desktopEntry', () => {
  it('runs the app with each argument quoted, as the Desktop Entry spec asks', () => {
    const entry = desktopEntry(
      { command: '/opt/My Apps/electron', args: ['/home/a/Symbiote/packages/desktop'] },
      '/home/a/.local/share/icons/hicolor/512x512/apps/symbiote.png',
    );
    expect(entry).toContain('\nExec="/opt/My Apps/electron" "/home/a/Symbiote/packages/desktop"\n');
    expect(entry).toContain(
      '\nIcon=/home/a/.local/share/icons/hicolor/512x512/apps/symbiote.png\n',
    );
    expect(entry).toMatch(/^\[Desktop Entry\]\nType=Application\nName=Symbiote\n/);
    expect(entry).toContain('\nTerminal=false\n');
    expect(entry).toContain('\nStartupWMClass=Symbiote\n');
  });

  it('escapes what a shell or the spec would read: quotes, $, `, \\ and %', () => {
    const entry = desktopEntry({ command: '/x/a"b$c`d\\e%f', args: [] }, '/i.png');
    // Exec quoting (\" \$ \` \\, %%), then the key file's own escape of each backslash.
    expect(entry).toContain('\nExec="/x/a\\\\"b\\\\$c\\\\`d\\\\\\\\e%%f"\n');
  });
});

describe('installApp and uninstallApp', () => {
  const home = join(dir, 'home');
  const env = {
    HOME: home,
    XDG_DATA_HOME: join(home, 'data'),
    XDG_CONFIG_HOME: join(home, 'config'),
    PATH: '/nvm/bin:/usr/bin',
  };
  const app = { command: '/c/electron', args: ['/c/packages/desktop'] };
  const icon = fakeApp('icon.png', '');

  it('adds the launcher entry, its icon, and records node, the CLI and PATH', () => {
    const said = installApp({
      env,
      platform: 'linux',
      app,
      icon,
      node: '/nvm/bin/node',
      cli: '/c/bin.js',
    });
    const entry = join(home, 'data', 'applications', 'symbiote.desktop');
    const copied = join(home, 'data', 'icons', 'hicolor', '512x512', 'apps', 'symbiote.png');
    expect(readFileSync(entry, 'utf8')).toContain(`\nIcon=${copied}\n`);
    expect(readFileSync(copied, 'utf8')).toBe(readFileSync(icon, 'utf8'));
    expect(JSON.parse(readFileSync(join(home, 'config', 'symbiote', 'app.json'), 'utf8'))).toEqual({
      node: '/nvm/bin/node',
      cli: '/c/bin.js',
      path: '/nvm/bin:/usr/bin',
    });
    expect(said).toContain(entry);
  });

  it('removes them again, and keeps the windows’ state', () => {
    writeFileSync(join(home, 'config', 'symbiote', 'kept'), '');
    uninstallApp({ env, platform: 'linux' });
    expect(existsSync(join(home, 'data', 'applications', 'symbiote.desktop'))).toBe(false);
    expect(
      existsSync(join(home, 'data', 'icons', 'hicolor', '512x512', 'apps', 'symbiote.png')),
    ).toBe(false);
    expect(existsSync(join(home, 'config', 'symbiote', 'app.json'))).toBe(false);
    expect(existsSync(join(home, 'config', 'symbiote', 'kept'))).toBe(true);
  });

  it('removes the entry and icon installed under the former name', () => {
    const data = join(home, 'data');
    const former = {
      entry: join(data, 'applications', `${FORMER_NAME}.desktop`),
      icon: join(data, 'icons', 'hicolor', '512x512', 'apps', `${FORMER_NAME}.png`),
    };
    for (const file of Object.values(former)) writeFileSync(file, '');
    installApp({ env, platform: 'linux', app, icon, node: '/n', cli: '/c' });
    expect(existsSync(former.entry)).toBe(false);
    expect(existsSync(former.icon)).toBe(false);
    expect(existsSync(join(data, 'applications', 'symbiote.desktop'))).toBe(true);
  });

  it('says it is Linux only for now', () => {
    expect(() => installApp({ env, platform: 'darwin', app, icon, node: '/n', cli: '/c' })).toThrow(
      /not supported on darwin yet/,
    );
  });
});

describe('recordAgain', () => {
  it('records node, the CLI and PATH again once installed, and nothing before', () => {
    const env = { XDG_CONFIG_HOME: join(dir, 'again'), PATH: '/a' };
    recordAgain({ env, platform: 'linux', node: '/n1', cli: '/c1' });
    expect(existsSync(join(dir, 'again', 'symbiote', 'app.json'))).toBe(false);
    installApp({
      env: { ...env, XDG_DATA_HOME: join(dir, 'again-data') },
      platform: 'linux',
      app: { command: '/e', args: [] },
      icon: fakeApp('icon2.png', ''),
      node: '/n1',
      cli: '/c1',
    });
    recordAgain({ env: { ...env, PATH: '/b' }, platform: 'linux', node: '/n2', cli: '/c2' });
    expect(JSON.parse(readFileSync(join(dir, 'again', 'symbiote', 'app.json'), 'utf8'))).toEqual({
      node: '/n2',
      cli: '/c2',
      path: '/b',
    });
  });
});
