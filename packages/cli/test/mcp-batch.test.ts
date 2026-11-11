// Symbiote's MCP in MC3: one Confirm for many starts or clean-ups, ticked per item and answered per
// item (decisions 987–989), and a Confirm that lapses, kept for a late yes (decision 994).
import type { McpCaller, NucleusActivityLine } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { parseMcpAnswer } from '../src/server-requests.js';
import { HEAD, NUCLEUS, askOf, call, fakes, server, workspace, type Mcp } from './mcp-fakes.js';

/** A start's brief as start_workspace takes it. */
const brief = (branch: string, title = `Title of ${branch}`) => ({
  kind: 'fix',
  title,
  branch,
  parts: { happens: 'It breaks' },
  planFirst: true,
});

const recorder = () => {
  const lines: NucleusActivityLine[] = [];
  return { lines, record: (line: NucleusActivityLine) => void lines.push(line) };
};

/** The Confirm lines of a record, in order: stage, and answer where it ended. */
const confirms = (lines: NucleusActivityLine[]) =>
  lines.flatMap((l) =>
    'kind' in l && l.kind === 'confirm'
      ? [l.stage === 'ended' ? `ended ${l.answer}` : l.stage]
      : [],
  );

/** Waits until `mcp` holds an ask that waits for the person, and answers its ID. */
async function waitingOf(mcp: Mcp): Promise<string> {
  for (let i = 0; i < 400; i++) {
    const ask = mcp.asks().asks.find((a) => !a.stage);
    if (ask) return ask.id;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('no ask waits');
}

/** Waits until `mcp`'s first ask is at `stage`. */
async function stageOf(mcp: Mcp, stage: string | undefined) {
  await expect.poll(() => mcp.asks().asks[0]?.stage).toBe(stage);
  return mcp.asks().asks[0];
}

describe('One Confirm for many starts (MC3, decision 987)', () => {
  it('asks once for three starts, each a row; the unticked one declined, the others started in order', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const pending = call(mcp, 'start_workspace', {
      workspaces: [brief('fix/one', 'One'), brief('fix/two', 'Two'), brief('fix/three', 'Three')],
    });
    const id = await askOf(mcp);
    expect(mcp.asks().asks).toEqual([
      {
        id,
        tool: 'start_workspace',
        words: 'Start 3 workspaces',
        by: NUCLEUS,
        at: expect.any(String) as unknown,
        until: expect.any(String) as unknown,
        items: [
          { id: 'i1', name: 'fix/one', words: '“One”, with Codex, plan first' },
          { id: 'i2', name: 'fix/two', words: '“Two”, with Codex, plan first' },
          { id: 'i3', name: 'fix/three', words: '“Three”, with Codex, plan first' },
        ],
      },
    ]);
    expect(calls.some((c) => c[0] === 'start')).toBe(false);
    // Answered once every ticked one is done: all done, nothing kept to read.
    expect(await mcp.answer({ id, yes: true, items: ['i1', 'i3'] })).toEqual({ asks: [] });
    expect(
      calls.filter((c) => c[0] === 'start').map((c) => (c[1] as { branch: string }).branch),
    ).toEqual(['fix/one', 'fix/three']);
    const done = await pending;
    expect(done.isError).toBe(false);
    expect(done.value).toEqual({
      results: [
        {
          branch: 'fix/one',
          outcome: 'started',
          workspace: expect.objectContaining({ branch: 'fix/one' }) as unknown,
        },
        { branch: 'fix/two', outcome: 'declined' },
        {
          branch: 'fix/three',
          outcome: 'started',
          workspace: expect.objectContaining({ branch: 'fix/three' }) as unknown,
        },
      ],
    });
  });

  it("says a start that fails with its reason, does the others, and keeps the results on the person's bar until closed", async () => {
    const { services, calls } = fakes({
      refuse: { start: { 'fix/two': 'a branch fix/two exists already' } },
    });
    const mcp = server(services);
    const pending = call(mcp, 'start_workspace', {
      workspaces: [brief('fix/one'), brief('fix/two'), brief('fix/three')],
    });
    const id = await askOf(mcp);
    await mcp.answer({ id, yes: true });
    expect((await pending).value).toMatchObject({
      results: [
        { branch: 'fix/one', outcome: 'started' },
        { branch: 'fix/two', outcome: 'failed', error: 'a branch fix/two exists already' },
        { branch: 'fix/three', outcome: 'started' },
      ],
    });
    expect(calls.filter((c) => c[0] === 'start')).toHaveLength(3);
    const kept = await stageOf(mcp, 'done');
    expect(kept?.items?.map((i) => [i.name, i.outcome, i.error])).toEqual([
      ['fix/one', 'done', undefined],
      ['fix/two', 'failed', 'a branch fix/two exists already'],
      ['fix/three', 'done', undefined],
    ]);
    // Close: either answer.
    expect(await mcp.answer({ id, yes: false })).toEqual({ asks: [] });
  });

  it("checks every start before asking: one that can't be done is shown so and never done", async () => {
    const { services, calls } = fakes({
      workspaces: [workspace('fix/a', 'working')],
    });
    const mcp = server(services);
    const pending = call(mcp, 'start_workspace', {
      workspaces: [brief('fix/a'), brief('fix/new')],
    });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.items).toEqual([
      {
        id: 'i1',
        name: 'fix/a',
        words: '“Title of fix/a”, with Codex, plan first',
        cant: 'a workspace fix/a exists already',
      },
      { id: 'i2', name: 'fix/new', words: '“Title of fix/new”, with Codex, plan first' },
    ]);
    // Ticked or not, it is not done.
    await mcp.answer({ id, yes: true, items: ['i1', 'i2'] });
    expect((await pending).value).toMatchObject({
      results: [
        { branch: 'fix/a', outcome: 'cant', error: 'a workspace fix/a exists already' },
        { branch: 'fix/new', outcome: 'started' },
      ],
    });
    expect(calls.filter((c) => c[0] === 'start')).toHaveLength(1);
    // Kept to be read: something could not be done.
    expect((await stageOf(mcp, 'done'))?.id).toBe(id);
  });

  it('refuses before asking when none can be done, and a list it cannot read, naming the item', async () => {
    const mcp = server(fakes({ workspaces: [workspace('fix/a', 'working')] }).services);
    expect(await call(mcp, 'start_workspace', { workspaces: [brief('fix/a')] })).toMatchObject({
      isError: true,
      text: 'fix/a: a workspace fix/a exists already',
    });
    expect(
      await call(mcp, 'start_workspace', {
        workspaces: [brief('fix/b'), { ...brief('fix/c'), kind: 'nope' }],
      }),
    ).toMatchObject({
      isError: true,
      text: expect.stringMatching(/^workspaces\[2\]: kind: /) as unknown,
    });
    expect(
      await call(mcp, 'start_workspace', { workspaces: [brief('fix/b'), brief('fix/b')] }),
    ).toMatchObject({ isError: true, text: 'workspaces: fix/b twice' });
    expect(
      await call(mcp, 'start_workspace', { ...brief('fix/b'), workspaces: [brief('fix/c')] }),
    ).toMatchObject({ isError: true, text: expect.stringContaining('not both') as unknown });
    expect(
      await call(mcp, 'start_workspace', {
        workspaces: Array.from({ length: 11 }, (_, i) => brief(`fix/n${i}`)),
      }),
    ).toMatchObject({ isError: true, text: 'workspaces: 1 to 10 starts' });
    expect(mcp.asks().asks).toEqual([]);
  });

  it('a single start asks and answers as today: no items', async () => {
    const { services } = fakes();
    const mcp = server(services);
    const pending = call(mcp, 'start_workspace', brief('fix/one', 'One'));
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]).not.toHaveProperty('items');
    expect(mcp.asks().asks[0]?.words).toBe('Start fix/one, "One", with Codex, plan first');
    await mcp.answer({ id, yes: true });
    expect((await pending).value).toMatchObject({ workspace: { branch: 'fix/one' } });
  });

  it('declined whole: nothing done, said as today', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const pending = call(mcp, 'start_workspace', {
      workspaces: [brief('fix/one'), brief('fix/two')],
    });
    await mcp.answer({ id: await askOf(mcp), yes: false });
    expect(await pending).toMatchObject({
      isError: true,
      text: 'The person declined: Start 2 workspaces. Nothing was done.',
    });
    expect(calls.some((c) => c[0] === 'start')).toBe(false);
    expect(mcp.asks().asks).toEqual([]);
  });
});

describe('One Confirm for many clean-ups (MC3, decision 987)', () => {
  it("asks once, each merged one a row; one with files not committed or not merged can't", async () => {
    const merged = (branch: string) => workspace(branch, 'ready', { merged: true });
    const { services, calls } = fakes({
      workspaces: [
        merged('feature/v99'),
        merged('feature/v100'),
        workspace('feature/v106', 'ready', {
          merged: true,
          worktree: { path: '/w/feature/v106', exists: true, changed: 2 },
        }),
        workspace('fix/open', 'ready'),
      ],
    });
    const mcp = server(services);
    const pending = call(mcp, 'clean_workspace', {
      branches: ['feature/v99', 'feature/v100', 'feature/v106', 'fix/open'],
    });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]).toMatchObject({
      words:
        "Clean up 4 workspaces: each one's worktree and agent sessions, and its branch once merged",
      items: [
        { id: 'i1', name: 'feature/v99', words: 'merged' },
        { id: 'i2', name: 'feature/v100', words: 'merged' },
        {
          id: 'i3',
          name: 'feature/v106',
          words: 'merged',
          cant: '2 files not committed in its worktree: commit or remove them first',
        },
        {
          id: 'i4',
          name: 'fix/open',
          words: 'not merged',
          cant: 'not merged: unmerged: true cleans it up and keeps its branch',
        },
      ],
    });
    await mcp.answer({ id, yes: true });
    expect((await pending).value).toMatchObject({
      results: [
        { branch: 'feature/v99', outcome: 'cleaned' },
        { branch: 'feature/v100', outcome: 'cleaned' },
        { branch: 'feature/v106', outcome: 'cant' },
        { branch: 'fix/open', outcome: 'cant' },
      ],
    });
    expect(calls.filter((c) => c[0] === 'clean')).toEqual([
      ['clean', { branch: 'feature/v99' }],
      ['clean', { branch: 'feature/v100' }],
    ]);
  });

  it('cleans up branches not merged with unmerged, keeping them; a workspace not there refused', async () => {
    const { services, calls } = fakes({ workspaces: [workspace('fix/open', 'ready')] });
    const mcp = server(services);
    expect(
      await call(mcp, 'clean_workspace', { branches: ['fix/open', 'fix/gone'] }),
    ).toMatchObject({ isError: true, text: 'no workspace fix/gone' });
    const pending = call(mcp, 'clean_workspace', { branches: ['fix/open'], unmerged: true });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.items).toEqual([
      { id: 'i1', name: 'fix/open', words: 'not merged: its branch stays' },
    ]);
    await mcp.answer({ id, yes: true });
    await pending;
    expect(calls.filter((c) => c[0] === 'clean')).toEqual([
      ['clean', { branch: 'fix/open', unmerged: true }],
    ]);
  });
});

describe("A batch and Nucleus's record (MC3, decision 989)", () => {
  it('records the batch asked with its items, its end, then what became of each', async () => {
    const { services } = fakes({ refuse: { start: { 'fix/two': 'no room' } } });
    const { lines, record } = recorder();
    const mcp = server(services, { record });
    const pending = call(mcp, 'start_workspace', {
      workspaces: [brief('fix/one'), brief('fix/two'), brief('fix/three')],
    });
    const id = await askOf(mcp);
    await mcp.answer({ id, yes: true, items: ['i1', 'i2'] });
    await pending;
    expect(confirms(lines)).toEqual(['asked', 'ended confirmed', 'done']);
    const asked = lines.find((l) => 'stage' in l && l.stage === 'asked');
    expect(asked).toMatchObject({
      words: 'Start 3 workspaces',
      items: [
        { name: 'fix/one', words: '“Title of fix/one”, with Codex, plan first' },
        { name: 'fix/two', words: '“Title of fix/two”, with Codex, plan first' },
        { name: 'fix/three', words: '“Title of fix/three”, with Codex, plan first' },
      ],
    });
    expect(lines.find((l) => 'stage' in l && l.stage === 'done')).toMatchObject({
      kind: 'confirm',
      ask: id,
      stage: 'done',
      items: [
        { name: 'fix/one', outcome: 'done' },
        { name: 'fix/two', outcome: 'failed', error: 'no room' },
        { name: 'fix/three', outcome: 'declined' },
      ],
    });
  });

  it('starts a batch at once with the setting on: no ask, one skipped line with its items, then each outcome', async () => {
    const { services, calls } = fakes({ workspaces: [workspace('fix/a', 'working')] });
    const { lines, record } = recorder();
    const mcp = server(services, {
      record,
      withoutConfirm: () => Promise.resolve('setting' as const),
    });
    const done = await call(mcp, 'start_workspace', {
      workspaces: [brief('fix/one'), brief('fix/a')],
    });
    expect(mcp.asks().asks).toEqual([]);
    expect(done.value).toEqual({
      results: [
        {
          branch: 'fix/one',
          outcome: 'started',
          workspace: expect.objectContaining({ branch: 'fix/one' }) as unknown,
        },
        { branch: 'fix/a', outcome: 'cant', error: 'a workspace fix/a exists already' },
      ],
      withoutConfirm: 'setting',
    });
    expect(calls.filter((c) => c[0] === 'start')).toHaveLength(1);
    expect(confirms(lines)).toEqual(['skipped', 'done']);
    expect(lines.find((l) => 'stage' in l && l.stage === 'skipped')).toMatchObject({
      words: 'Start 2 workspaces',
      why: 'setting',
      items: [{ name: 'fix/one' }, { name: 'fix/a', cant: 'a workspace fix/a exists already' }],
    });
    // A person's own agent through symbiote mcp is asked, whatever the setting.
    const agent: McpCaller = { via: 'mcp', client: 'claude-code' };
    const theirs = call(mcp, 'start_workspace', { workspaces: [brief('fix/two')] }, agent);
    await mcp.answer({ id: await askOf(mcp), yes: false });
    expect((await theirs).isError).toBe(true);
  });
});

describe('A Confirm that lapses (MC3, decision 994)', () => {
  it("ends the call at its time, says it stays on the person's bar, and keeps it lapsed for a late yes", async () => {
    const { services, calls } = fakes();
    const { lines, record } = recorder();
    const mcp = server(services, { askMs: 80, record });
    const lapsed = await call(mcp, 'queue_merge', { branch: 'fix/a' });
    expect(lapsed.isError).toBe(true);
    expect(lapsed.text).toBe(
      `No answer from the person to: Merge fix/a at ${HEAD.slice(0, 7)} into main. Nothing was done yet: the ask stays on their Symbiote bar for 24 hours, and if they confirm it there, Symbiote does it then (overview says what became of it). Do not ask again unless they say so.`,
    );
    const [ask] = mcp.asks().asks;
    expect(ask).toMatchObject({
      tool: 'queue_merge',
      stage: 'lapsed',
      kept: expect.any(String) as unknown,
    });
    expect(Date.parse(ask?.kept ?? '') - Date.parse(ask?.until ?? '')).toBe(24 * 60 * 60_000);
    // A lapsed ask is not one that waits: the caller may ask something else.
    const other = call(mcp, 'remove_merge', { id: 'm1' });
    await mcp.answer({ id: await waitingOf(mcp), yes: false });
    await other;
    // The late yes: checked again, then done; answered once done.
    expect(await mcp.answer({ id: ask?.id ?? '', yes: true })).toEqual({ asks: [] });
    expect(calls).toContainEqual(['enqueue', { branch: 'fix/a', into: 'main' }]);
    expect(confirms(lines)).toEqual([
      'asked',
      'ended expired',
      'asked',
      'ended declined',
      'ended late',
      'done',
    ]);
  });

  it('confirmed late, a batch runs its ticked items; one that now cannot be done is said so', async () => {
    const { services, calls, setWorkspaces } = fakes({ workspaces: [] });
    const mcp = server(services, { askMs: 40 });
    await call(mcp, 'start_workspace', {
      workspaces: [brief('fix/one'), brief('fix/two'), brief('fix/three')],
    });
    const ask = await stageOf(mcp, 'lapsed');
    // Meanwhile fix/two was started by hand.
    setWorkspaces([workspace('fix/two', 'working')]);
    await mcp.answer({ id: ask?.id ?? '', yes: true, items: ['i1', 'i2'] });
    expect(
      calls.filter((c) => c[0] === 'start').map((c) => (c[1] as { branch: string }).branch),
    ).toEqual(['fix/one']);
    const kept = await stageOf(mcp, 'done');
    expect(kept?.items?.map((i) => [i.name, i.outcome])).toEqual([
      ['fix/one', 'done'],
      ['fix/two', 'cant'],
      ['fix/three', 'declined'],
    ]);
  });

  it('a late yes that fails is kept with why until closed', async () => {
    const { services } = fakes({ refuse: { start: { 'fix/one': 'no room' } } });
    const mcp = server(services, { askMs: 40 });
    await call(mcp, 'start_workspace', brief('fix/one'));
    const ask = await stageOf(mcp, 'lapsed');
    await mcp.answer({ id: ask?.id ?? '', yes: true });
    expect(mcp.asks().asks).toMatchObject([{ id: ask?.id, stage: 'done', failed: 'no room' }]);
    expect(await mcp.answer({ id: ask?.id ?? '', yes: false })).toEqual({ asks: [] });
  });

  it('Dismiss ends a lapsed ask; one not answered goes after its 24 hours; both recorded', async () => {
    const { services, calls } = fakes();
    const { lines, record } = recorder();
    const mcp = server(services, { askMs: 30, keepMs: 60, record });
    await call(mcp, 'queue_merge', { branch: 'fix/a' });
    const ask = await stageOf(mcp, 'lapsed');
    expect(await mcp.answer({ id: ask?.id ?? '', yes: false })).toEqual({ asks: [] });
    await call(mcp, 'queue_merge', { branch: 'fix/a' });
    await stageOf(mcp, 'lapsed');
    await expect.poll(() => mcp.asks().asks.length).toBe(0);
    expect(calls.some((c) => c[0] === 'enqueue')).toBe(false);
    expect(confirms(lines)).toEqual([
      'asked',
      'ended expired',
      'ended dismissed',
      'asked',
      'ended expired',
    ]);
  });

  it('the same ask made again by its caller replaces its lapsed copy', async () => {
    const { services } = fakes();
    const { lines, record } = recorder();
    const mcp = server(services, { askMs: 80, record });
    await call(mcp, 'queue_merge', { branch: 'fix/a' });
    const first = await stageOf(mcp, 'lapsed');
    const again = call(mcp, 'queue_merge', { branch: 'fix/a' });
    const id = await waitingOf(mcp);
    expect(id).not.toBe(first?.id);
    expect(mcp.asks().asks.map((a) => a.id)).toEqual([id]);
    await mcp.answer({ id, yes: true });
    expect((await again).isError).toBe(false);
    expect(confirms(lines)).toEqual([
      'asked',
      'ended expired',
      'ended replaced',
      'asked',
      'ended confirmed',
    ]);
  });

  it('overview lists lapsed asks and what became of them', async () => {
    const { services } = fakes();
    const mcp = server(services, { askMs: 40 });
    await call(mcp, 'queue_merge', { branch: 'fix/a' });
    const ask = await stageOf(mcp, 'lapsed');
    const words = `Merge fix/a at ${HEAD.slice(0, 7)} into main`;
    expect((await call(mcp, 'overview')).value.lapsed).toEqual([
      { words, asked: ask?.at, now: 'waiting' },
    ]);
    await mcp.answer({ id: ask?.id ?? '', yes: true });
    expect((await call(mcp, 'overview')).value.lapsed).toEqual([
      { words, asked: ask?.at, now: 'done' },
    ]);
  });
});

describe("The page's answer (MC3)", () => {
  it("takes a batch's ticked items", () => {
    expect(parseMcpAnswer('{"id":"a1","yes":true,"items":["i1","i3"]}')).toEqual({
      id: 'a1',
      yes: true,
      items: ['i1', 'i3'],
    });
    expect(parseMcpAnswer('{"id":"a1","yes":true}')).toEqual({ id: 'a1', yes: true });
    expect(() => parseMcpAnswer('{"id":"a1","yes":true,"items":"i1"}')).toThrow('items: ');
    expect(() => parseMcpAnswer('{"id":"a1","yes":true,"items":[1]}')).toThrow('items: ');
  });

  it('refuses ticked items the ask does not hold', async () => {
    const mcp = server(fakes().services);
    void call(mcp, 'start_workspace', { workspaces: [brief('fix/one')] });
    const id = await askOf(mcp);
    await expect(mcp.answer({ id, yes: true, items: ['i9'] })).rejects.toThrow('no item i9');
    await mcp.answer({ id, yes: false });
  });
});
