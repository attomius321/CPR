// `symbiote app`: Symbiote's own window (N1), set up and opened.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { SymbioteError } from '@symbiote/core';
import { findApp, installApp, uninstallApp } from './app.js';
import { type CliContext, CLI_SCRIPT } from './command-context.js';
import { UsageError, parse } from './command-args.js';

const require = createRequire(import.meta.url);

const APP_HELP = `Usage: symbiote app install | uninstall

Symbiote's window, the desktop app (pnpm app:setup in Symbiote's folder fetches it). install adds
Symbiote to your desktop's apps, for this user, so it opens without a terminal: on the last
repository it showed, or one you choose. It records this node, this CLI and your PATH,
which an app started from the desktop does not have. uninstall removes it. Linux only
for now (WSL included, through WSLg).

Options:
  -h, --help           Show this help
`;

/** `symbiote app install|uninstall` (N1b): Symbiote's window in the desktop's apps. */
export function appCommand(argv: string[], ctx: CliContext): number {
  const { values, positionals } = parse(
    {
      args: argv,
      allowPositionals: true,
      options: { help: { type: 'boolean', short: 'h', default: false } },
    },
    APP_HELP,
  );
  const [action, ...extra] = positionals;
  if (values.help || action === undefined) {
    ctx.stdout(APP_HELP);
    return values.help ? 0 : 2;
  }
  if (extra.length > 0) throw new UsageError(`unexpected argument '${extra[0]}'`, APP_HELP);
  const where = { env: ctx.env, platform: process.platform };
  if (action === 'uninstall') {
    ctx.stdout(uninstallApp(where));
    return 0;
  }
  if (action !== 'install') throw new UsageError(`unknown action '${action}'`, APP_HELP);
  const app = findApp(ctx.env);
  if (!app) {
    throw new SymbioteError(
      "Symbiote's window is not set up: run pnpm app:setup and pnpm build in Symbiote's folder",
    );
  }
  const desktop = dirname(require.resolve('@symbiote/desktop/package.json'));
  ctx.stdout(
    installApp({
      ...where,
      app,
      icon: join(desktop, 'icons', 'symbiote.png'),
      node: process.execPath,
      cli: CLI_SCRIPT,
    }),
  );
  if (refusesSandbox()) {
    ctx.stderr(
      "warning: AppArmor here refuses Chromium's sandbox to apps outside a package " +
        "(kernel.apparmor_restrict_unprivileged_userns=1): Symbiote's window may not open; see Symbiote's window in the README\n",
    );
  }
  return 0;
}

/** Whether AppArmor refuses user namespaces to unpackaged programs (Ubuntu 23.10 and later). */
function refusesSandbox(): boolean {
  try {
    return (
      readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1'
    );
  } catch {
    return false;
  }
}
