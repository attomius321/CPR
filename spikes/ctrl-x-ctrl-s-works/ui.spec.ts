import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Step 4 of the spike: the whole way, once — `symbiote view` with the real Claude Code, a
// workspace started from its page, a message left waiting behind a long turn in the agent's
// terminal, then Ctrl+X, Ctrl+S pressed in Chromium. Its repository is a scratch one in /tmp, with
// its own Symbiote cache and config folders; the agent runs on haiku.

const DATA = join(import.meta.dirname, 'data');
const CLI = join(import.meta.dirname, '../../packages/cli/dist/bin.js');
const WAIT_MS = 30_000;
const WAIT = `node -e "setTimeout(() => console.log('done'), ${WAIT_MS})"`;
/** This session's own variables left out: the server runs as the person starts it. */
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (e): e is [string, string] => !/^CLAUDE/.test(e[0]) && e[1] !== undefined,
  ),
);
const sh = (cwd: string, cmd: string, ...args: string[]) =>
  execFileSync(cmd, args, { cwd, env, encoding: 'utf8' }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Entry {
  type: string;
  timestamp?: string;
  operation?: string;
  message?: { content?: unknown };
  line: string;
}
function transcript(sessionId: string): Entry[] {
  const root = join(homedir(), '.claude', 'projects');
  for (const dir of readdirSync(root)) {
    const file = join(root, dir, `${sessionId}.jsonl`);
    if (existsSync(file)) {
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => ({ ...(JSON.parse(line) as Omit<Entry, 'line'>), line }));
    }
  }
  return [];
}
async function waitFor<T>(test: () => T | null | undefined | false, ms: number, step = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = test();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

let server: ChildProcess | undefined;
test.afterAll(() => server?.kill());

test('Ctrl+X, Ctrl+S in a real workspace terminal sends the waiting message now', async ({
  page,
}) => {
  test.setTimeout(300_000);
  // The scratch repository: main on a bare origin, as a person's clone has it.
  const scratch = mkdtempSync('/tmp/symbiote-sendnow-ui-');
  const repo = join(scratch, 'repo');
  mkdirSync(join(repo, 'symbiote'), { recursive: true });
  mkdirSync(join(repo, '.claude'));
  sh(scratch, 'git', 'init', '-q', '-b', 'main', repo);
  writeFileSync(join(repo, 'README.md'), '# send-now spike scratch (UI)\n');
  writeFileSync(
    join(repo, 'symbiote', 'config.json'),
    JSON.stringify({ agent: { kind: 'claude', model: 'haiku' } }, null, 2) + '\n',
  );
  // The test's wait runs without a permission prompt; no push notification for these sessions.
  writeFileSync(
    join(repo, '.claude', 'settings.json'),
    JSON.stringify(
      { permissions: { allow: ['Bash(node -e:*)'] }, agentPushNotifEnabled: false },
      null,
      2,
    ) + '\n',
  );
  sh(repo, 'git', 'add', '.');
  sh(repo, 'git', '-c', 'user.email=spike@example.com', '-c', 'user.name=spike', 'commit', '-qm', 'init');
  sh(repo, 'git', 'config', 'user.email', 'spike@example.com');
  sh(repo, 'git', 'config', 'user.name', 'spike');
  sh(scratch, 'git', 'init', '-q', '--bare', join(scratch, 'origin.git'));
  sh(repo, 'git', 'remote', 'add', 'origin', join(scratch, 'origin.git'));
  sh(repo, 'git', 'push', '-q', '-u', 'origin', 'main');
  sh(repo, 'git', 'remote', 'set-head', 'origin', 'main');
  sh(import.meta.dirname, 'node', 'real.mjs', 'trust', repo);

  server = spawn(process.execPath, [CLI, 'view', '--no-open'], {
    cwd: repo,
    env: {
      ...env,
      SYMBIOTE_CACHE_DIR: join(scratch, 'cache'),
      XDG_CONFIG_HOME: join(scratch, 'config'),
      SYMBIOTE_INTRO: 'off',
      SYMBIOTE_USAGE: 'off',
    },
  });
  let said = '';
  const url = await new Promise<string>((resolve, reject) => {
    server?.stdout?.on('data', (d: Buffer) => {
      said += d.toString();
      const m = /Symbiote viewer: (\S+)/.exec(said);
      if (m?.[1]) resolve(m[1]);
    });
    server?.stderr?.on('data', (d: Buffer) => (said += d.toString()));
    server?.on('exit', (code) => reject(new Error(`symbiote exited ${code}: ${said}`)));
  });

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const start = page.getByRole('region', { name: 'Start a workspace' });
  await start.getByRole('textbox', { name: 'Title' }).fill('Send now UI');
  await start.getByRole('textbox', { name: 'Goal' }).fill('Reply with only the word READY.');
  await page.screenshot({ path: join(DATA, 'ui-start.png') });
  await start.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  await expect(start).toBeHidden({ timeout: 60_000 });
  const branch = 'feature/send-now-ui';
  const panel = page.getByRole('region', { name: `Workspace ${branch}` });
  const terminal = panel.locator('.agent-terminal');
  const rows = terminal.locator('.xterm-rows');
  const worktree = `${repo}.worktrees/feature-send-now-ui`;
  // The agent's session, as Symbiote finds it.
  const session = await waitFor(() => {
    const all = JSON.parse(sh(repo, 'claude', 'agents', '--json', '--all')) as {
      id: string;
      sessionId: string;
      cwd: string;
      status?: string;
    }[];
    return all.filter((s) => s.cwd === worktree).at(-1);
  }, 60_000);
  if (!session) throw new Error(`no session in ${worktree}`);
  await expect(rows).toContainText('READY', { timeout: 90_000 });
  await sleep(3000);
  await page.screenshot({ path: join(DATA, 'ui-ready.png') });
  await terminal.locator('.xterm-helper-textarea').focus();

  // A long turn, then a message that waits behind it.
  const typed = Date.now();
  await page.keyboard.type(
    `Run exactly this command with the Bash tool, in the foreground: ${WAIT} — when it ends, reply with only: SLEPT-UI.`,
  );
  await page.keyboard.press('Enter');
  const call = await waitFor(
    () =>
      transcript(session.sessionId).find(
        (e) =>
          e.type === 'assistant' &&
          e.line.includes('setTimeout') &&
          e.line.includes('tool_use') &&
          Date.parse(e.timestamp ?? '') >= typed - 1000,
      ),
    60_000,
  );
  expect(call, 'the long turn started').toBeTruthy();
  await sleep(3000);
  await page.keyboard.type('Reply with only the word PINEAPPLE-UI.');
  await page.keyboard.press('Enter');
  await expect(rows).toContainText('to send now', { timeout: 10_000 });
  await sleep(1500);
  const hint = (await rows.innerText())
    .split('\n')
    .filter((line) => /send now|queued/i.test(line))
    .map((line) => line.replaceAll(' ', ' ').trim());
  await page.screenshot({ path: join(DATA, 'ui-queued.png') });

  // The attach process's terminal while it runs: ^S is XOFF unless -ixon.
  const pid = sh(repo, 'pgrep', '-n', '-f', `[c]laude attach ${session.id}`);
  const tty = sh(repo, 'readlink', `/proc/${pid}/fd/0`);
  const stty = sh(repo, 'stty', '-a', '-F', tty);

  const pressedAt = Date.now();
  await page.keyboard.press('Control+x');
  await sleep(150);
  await page.keyboard.press('Control+s');
  const answered = await waitFor(
    () =>
      transcript(session.sessionId).find(
        (e) =>
          e.type === 'assistant' &&
          Array.isArray(e.message?.content) &&
          (e.message.content as { type: string; text?: string }[]).some(
            (c) => c.type === 'text' && c.text?.includes('PINEAPPLE-UI'),
          ),
      ),
    WAIT_MS + 30_000,
  );
  await sleep(1000);
  await page.screenshot({ path: join(DATA, 'ui-after.png') });
  const t = transcript(session.sessionId).filter(
    (e) => e.timestamp && Date.parse(e.timestamp) >= typed - 1000,
  );
  const at = (e: Entry | undefined) => (e?.timestamp ? Date.parse(e.timestamp) - pressedAt : null);
  const toolId = (
    call && Array.isArray(call.message?.content)
      ? (call.message.content as { type: string; id?: string }[]).find((c) => c.type === 'tool_use')
      : undefined
  )?.id;
  const result = t.find((e) => e.type === 'user' && toolId && e.line.includes(toolId) && e.line.includes('tool_result'));
  const taken = t.find(
    (e) => e.type === 'queue-operation' && e.operation !== 'enqueue' && e.line.includes('PINEAPPLE-UI'),
  );
  const record = {
    session: session.id,
    worktree,
    hint,
    pressedMsAfterToolStarted: call?.timestamp ? pressedAt - Date.parse(call.timestamp) : null,
    takenInMsAfterPress: at(taken),
    takenInAs: taken?.operation ?? null,
    answeredMsAfterPress: at(answered ?? undefined),
    waitResultMsAfterPress: at(result),
    waitMovedToBackground: /moved to the background/.test(result?.line ?? ''),
    waitResult: result?.line.slice(0, 400) ?? null,
    stty: { tty, ixon: stty.match(/-?ixon/)?.[0], icanon: stty.match(/-?icanon/)?.[0] },
    pageErrors: errors,
  };
  writeFileSync(join(DATA, 'ui.json'), JSON.stringify(record, null, 2) + '\n');
  writeFileSync(join(DATA, 'ui-transcript.jsonl'), t.map((e) => e.line).join('\n') + '\n');
  writeFileSync(join(DATA, 'ui-scratch-path.txt'), scratch + '\n');
  expect(errors).toEqual([]);
});
