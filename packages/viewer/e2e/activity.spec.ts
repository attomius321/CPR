import { expect, test, type Page } from '@playwright/test';
import { serveWorkspaces, type RunningWorkspaces } from './symbiote.js';

// A workspace's Activity tab (V48c; V73): its agent's records as phases between milestones, each
// opening to its events and each event to what was recorded of it; the raw stream; what runs now.
// Driven through the fake Claude Code's hooks, which run Symbiote's own hook as the real one does.
let symbiote: RunningWorkspaces;
const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(() => {
  symbiote.stop();
  expect(errors).toEqual([]);
});

const POLL = { timeout: 12_000 };
const BRANCH = 'feature/add-a-half-function';

const startHalf = async (page: Page) => {
  symbiote = await serveWorkspaces();
  await page.goto(symbiote.url);
  await page.getByRole('link', { name: 'Start a workspace' }).click();
  const start = page.getByRole('region', { name: 'Start a workspace' });
  await start.getByRole('textbox', { name: 'Title' }).fill('Add a half function');
  await start.getByRole('textbox', { name: 'Goal' }).fill('Add a half function');
  await start.getByRole('textbox', { name: 'Goal' }).press('Control+Enter');
  await expect(start).toBeHidden();
};

/** A tool's hook: its start (`PreToolUse`), its end (`PostToolUse`), or its failure. */
const tool = (
  event: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure',
  id: string,
  name: string,
  input: Record<string, unknown>,
  rest: Record<string, unknown> = {},
) =>
  symbiote.hook(BRANCH, {
    hook_event_name: event,
    tool_name: name,
    tool_input: input,
    tool_use_id: id,
    ...rest,
  });

const openActivity = async (page: Page) => {
  await page.goto(`${symbiote.url}?branch=${encodeURIComponent(BRANCH)}&activity`);
  await expect(page.getByRole('tab', { name: 'Activity' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  return page.getByRole('list', { name: 'Activity' });
};

/** A group's line in the timeline, by its title. */
const groupOf = (page: Page, title: string | RegExp) =>
  page.locator('.activity-group', {
    has: page.locator('.activity-title').getByText(title, { exact: typeof title === 'string' }),
  });

test('phases from what the agent did; a phase opens to its events, an event to its whole command and output (V73)', async ({
  page,
}) => {
  await startHalf(page);
  const folder = symbiote.folder(BRANCH);
  const check = `cd ${folder} && pnpm test 2>&1 | tail -5`;
  tool('PreToolUse', 'r1', 'Read', { file_path: `${folder}/src/a.ts` });
  tool('PostToolUse', 'r1', 'Read', { file_path: `${folder}/src/a.ts` }, { tool_response: {} });
  tool('PreToolUse', 'w1', 'Write', { file_path: `${folder}/src/half.ts` });
  tool(
    'PostToolUse',
    'w1',
    'Write',
    { file_path: `${folder}/src/half.ts` },
    { tool_response: { type: 'create', content: 'a\nb\nc\n', structuredPatch: [] } },
  );
  tool('PreToolUse', 't1', 'Bash', { command: check, description: 'Run the tests' });
  tool(
    'PostToolUseFailure',
    't1',
    'Bash',
    { command: check },
    {
      error: 'Exit code 1\n FAIL  src/half.test.ts > halves\n      Tests  1 failed | 2 passed (3)',
      duration_ms: 2100,
    },
  );
  tool('PreToolUse', 'e1', 'Edit', { file_path: `${folder}/src/half.ts` });
  tool(
    'PostToolUse',
    'e1',
    'Edit',
    { file_path: `${folder}/src/half.ts` },
    {
      tool_response: {
        structuredPatch: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] },
        ],
      },
    },
  );
  tool('PreToolUse', 't2', 'Bash', { command: check, description: 'Run the tests again' });
  tool(
    'PostToolUse',
    't2',
    'Bash',
    { command: check },
    { tool_response: { stdout: '      Tests  3 passed (3)\n', stderr: '' }, duration_ms: 1900 },
  );
  // Git keeps a commit's time in whole seconds: one after the tools, not in their second.
  await page.waitForTimeout(1_100);
  symbiote.commit(BRANCH, 'src/half.ts', 'export const half = (a: number) => a / 2;\n', 'Add half');

  const activity = await openActivity(page);
  await expect(activity.locator('.activity-title')).toHaveText(
    [
      /^Workspace made from main at [0-9a-f]{7}$/,
      'Claude Code started',
      "Symbiote's prompt",
      'Implementation',
      'Testing',
      'Debugging',
      'Add half',
    ],
    POLL,
  );
  // The worktree's folder is in no phase shown before a command is opened.
  for (const phase of await activity.locator('.activity-group.phase').all()) {
    await expect(phase).not.toContainText(folder);
  }
  const implementation = groupOf(page, 'Implementation');
  await expect(implementation.locator('.activity-summary')).toHaveText('1 file · +3 −0');
  const testing = groupOf(page, 'Testing');
  await expect(testing.locator('.activity-status')).toHaveText('Failed');
  await expect(testing.locator('.activity-summary')).toHaveText(
    'pnpm test · 1 failed · 2 passed (exit 1)',
  );
  const debugging = groupOf(page, 'Debugging');
  await expect(debugging.locator('.activity-status')).toHaveText('Passed');
  await expect(debugging.locator('.activity-summary')).toHaveText(
    'pnpm test passed after 1 run · 1 edit',
  );
  await expect(groupOf(page, 'Add half').locator('.activity-sha')).toHaveText(/^[0-9a-f]{7}$/);

  // The failed test opens to its run: the agent's words, the command short, its exit code.
  await testing.locator('summary').first().click();
  const events = testing.getByRole('list', { name: 'Events of Testing' });
  await expect(events.locator('.activity-event')).toHaveCount(1);
  const run = events.locator('.activity-event').first();
  await expect(run).toContainText('Run the tests');
  await expect(run.locator('code')).toHaveText('pnpm test 2>&1 | tail -5');
  await expect(run.locator('.activity-exit')).toHaveText('exit 1');
  // Opened: its whole command, as it ran, and its error.
  await run.locator('summary').click();
  const facts = run.locator('.activity-facts');
  await expect(facts.locator('pre').first()).toHaveText(check);
  await expect(facts).toContainText('FAIL  src/half.test.ts > halves');
  await expect(facts).toContainText('Exit code1');
  await expect(facts).toContainText('Took2.1 s');
  // Closed again: the group keeps its place and the others theirs.
  await testing.locator('summary').first().click();
  await expect(testing.locator('details.activity-body')).not.toHaveAttribute('open');
});

test('the raw stream: every line recorded, in order, each opening to its JSON (V73)', async ({
  page,
}) => {
  await startHalf(page);
  tool('PreToolUse', 'b1', 'Bash', { command: 'ls -la', description: 'List files' });
  tool(
    'PostToolUse',
    'b1',
    'Bash',
    { command: 'ls -la' },
    { tool_response: { stdout: 'total 0\n', stderr: '' }, duration_ms: 12 },
  );
  await openActivity(page);
  await expect(groupOf(page, 'Exploration')).toBeVisible(POLL);
  await page.getByRole('button', { name: 'Raw events' }).click();
  const raw = page.getByRole('list', { name: 'Raw events' });
  await expect(raw.locator('.activity-raw-what')).toHaveText([
    'made',
    'start',
    'prompt',
    'Bash start',
    'Bash end',
  ]);
  await expect(page.locator('.activity-counts')).toHaveText('5 lines recorded');
  await raw.locator('.activity-raw-line').nth(4).locator('summary').click();
  const json = raw.locator('.activity-output');
  await expect(json).toContainText('"phase": "end"');
  await expect(json).toContainText('"output": "total 0"');
  await expect(json).toContainText('"ms": 12');
  // Back to the timeline.
  await page.getByRole('button', { name: 'Timeline' }).click();
  await expect(page.getByRole('list', { name: 'Activity' })).toBeVisible();
});

test('what runs now: a live strip and a running phase, then into the timeline as it ends (V73)', async ({
  page,
}) => {
  await startHalf(page);
  await openActivity(page);
  const now = page.getByRole('region', { name: 'Now' });
  // Working, nothing running: thinking.
  await expect(now).toContainText('Thinking', POLL);
  const folder = symbiote.folder(BRANCH);
  tool('PreToolUse', 'c1', 'Bash', {
    command: `cd ${folder} && pnpm check`,
    description: 'Run the full check',
  });
  await expect(now).toContainText('Testing', POLL);
  await expect(now).toContainText('Run the full check');
  await expect(now.locator('.activity-live-command')).toHaveText('pnpm check');
  await expect(now.locator('.activity-live-elapsed')).toHaveText(/^\d+:\d\d$/);
  await expect(now.locator('.state-dot')).toHaveClass(/tone-working/);
  const testing = groupOf(page, 'Testing');
  await expect(testing.locator('.activity-status')).toHaveText('Running');
  const made = await page.locator('.activity-group').first().elementHandle();

  // It ends: the strip says it thinks, the phase passed; the groups before it were kept.
  tool(
    'PostToolUse',
    'c1',
    'Bash',
    { command: `cd ${folder} && pnpm check` },
    { tool_response: { stdout: '      Tests  42 passed (42)\n', stderr: '' }, duration_ms: 3000 },
  );
  await expect(testing.locator('.activity-status')).toHaveText('Passed', POLL);
  await expect(now).toContainText('Thinking');
  await expect(testing.locator('.activity-summary')).toHaveText('pnpm check · 42 passed');
  expect(await made?.evaluate((row) => row.isConnected)).toBe(true);

  // Its turn ends with its plan: waiting on the person, still.
  symbiote.report(BRANCH, '# Plan\n\n1. Add half.');
  await expect(now).toContainText('Plan ready: read it and answer', POLL);
  await expect(now.locator('.state-dot')).toHaveClass(/tone-waiting/);
  await expect(groupOf(page, 'Reported').locator('.activity-summary')).toHaveText('Plan');
});

test('what went wrong: a command stopped, a question waiting on you, a report as Markdown (V73)', async ({
  page,
}) => {
  await startHalf(page);
  tool('PreToolUse', 's1', 'Bash', { command: 'pnpm test:e2e', description: 'Run the e2e' });
  tool(
    'PostToolUseFailure',
    's1',
    'Bash',
    { command: 'pnpm test:e2e' },
    { error: 'Interrupted by user', is_interrupt: true },
  );
  symbiote.hook(BRANCH, {
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [
        { question: 'Which store?', options: [{ label: 'Redis' }, { label: 'Postgres' }] },
      ],
    },
    tool_use_id: 'q1',
  });
  symbiote.session(BRANCH, { state: 'blocked', waitingFor: 'input' });
  const activity = await openActivity(page);
  const stopped = groupOf(page, 'Testing');
  await expect(stopped.locator('.activity-status')).toHaveText('Stopped', POLL);
  await expect(stopped.locator('.activity-summary')).toHaveText('pnpm test:e2e · stopped');
  const asked = groupOf(page, 'Asked: Which store?');
  await expect(asked.locator('.activity-status')).toHaveText('Waiting for you', POLL);
  await expect(asked.locator('.activity-summary')).toHaveText('Redis · Postgres');
  await expect(page.getByRole('region', { name: 'Now' })).toContainText('Asks: Which store?');
  await asked.locator('summary').first().click();
  await expect(asked.locator('.activity-questions .chip')).toHaveText(['Redis', 'Postgres']);

  // Its report opens as Markdown.
  symbiote.report(BRANCH, 'Added **half**, and its test.');
  const reported = groupOf(page, 'Reported');
  await expect(reported).toBeVisible(POLL);
  await reported.locator('summary').first().click();
  await expect(reported.locator('.activity-detail.markdown strong')).toHaveText('half');
  await expect(activity.locator('.activity-group.status-waiting')).toHaveCount(0);
});

/** A token's colour as the page computes it (`rgb(…)`), for comparing with an element's. */
const colourOf = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);

test('each phase in its colour, on a tile on the rail; your words in a bubble (V74)', async ({
  page,
}) => {
  await startHalf(page);
  const folder = symbiote.folder(BRANCH);
  const check = `cd ${folder} && pnpm test`;
  tool('PreToolUse', 'r1', 'Read', { file_path: `${folder}/src/a.ts` });
  tool('PostToolUse', 'r1', 'Read', { file_path: `${folder}/src/a.ts` }, { tool_response: {} });
  tool('PreToolUse', 't1', 'Bash', { command: check, description: 'Run the tests' });
  tool(
    'PostToolUseFailure',
    't1',
    'Bash',
    { command: check },
    { error: 'Exit code 1\n      Tests  1 failed | 2 passed (3)', duration_ms: 2100 },
  );
  tool('PreToolUse', 'e1', 'Edit', { file_path: `${folder}/src/half.ts` });
  tool('PostToolUse', 'e1', 'Edit', { file_path: `${folder}/src/half.ts` }, { tool_response: {} });
  tool('PreToolUse', 't2', 'Bash', { command: check, description: 'Run the tests again' });
  tool(
    'PostToolUse',
    't2',
    'Bash',
    { command: check },
    { tool_response: { stdout: '      Tests  3 passed (3)\n', stderr: '' }, duration_ms: 1900 },
  );
  symbiote.hook(BRANCH, { hook_event_name: 'UserPromptSubmit', prompt: 'Round it down too' });

  const activity = await openActivity(page);
  await expect(activity.locator('.activity-title')).toHaveText(
    [
      /^Workspace made from main at [0-9a-f]{7}$/,
      'Claude Code started',
      "Symbiote's prompt",
      'Exploration',
      'Testing',
      'Debugging',
      'You: Round it down too',
    ],
    POLL,
  );
  // Each phase's tile, on the rail, in its kind's colour; a milestone's has none of a phase.
  const tile = (title: string) => groupOf(page, title).locator('.activity-rail .activity-tile');
  for (const [title, token] of [
    ['Exploration', '--phase-explore'],
    ['Testing', '--phase-test'],
    ['Debugging', '--phase-debug'],
  ] as const) {
    await expect(tile(title)).toHaveCSS('color', await colourOf(page, token));
  }
  // The kind's icon left the group's line for the rail; the chevron stays.
  await expect(
    groupOf(page, 'Exploration').locator('.activity-head .icon:not(.chevron)'),
  ).toHaveCount(0);
  // The status on the tile's ring and in the badge, with its icon.
  const error = await colourOf(page, '--error');
  expect(await tile('Testing').evaluate((el) => getComputedStyle(el).boxShadow)).toContain(error);
  await expect(groupOf(page, 'Testing').locator('.activity-status .icon')).toHaveCount(1);
  // Your words: a bubble, apart from the phases.
  const bubble = groupOf(page, 'You: Round it down too').locator('.activity-body');
  await expect(bubble).toHaveCSS('border-radius', '10px');
  await expect(bubble).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  // Opened, each event's icon in its own call's colour: the edit an implementation's.
  const debugging = groupOf(page, 'Debugging');
  await debugging.locator('summary').first().click();
  const events = debugging.getByRole('list', { name: 'Events of Debugging' });
  await expect(events.locator('.activity-event-icon')).toHaveCount(2);
  await expect(events.locator('.activity-event-icon').first()).toHaveCSS(
    'color',
    await colourOf(page, '--phase-implement'),
  );
  // The raw stream: a tool's chip in its call's colour.
  await page.getByRole('button', { name: 'Raw events' }).click();
  const read = page
    .getByRole('list', { name: 'Raw events' })
    .locator('.activity-raw-line', { hasText: 'Read start' });
  await expect(read.locator('.chip')).toHaveCSS('color', await colourOf(page, '--phase-explore'));
});
