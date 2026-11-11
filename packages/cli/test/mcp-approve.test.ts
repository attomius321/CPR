// Symbiote's MCP in MC3: an Approve queues its merge in the same Confirm, as the page's Approve and
// Merge into presses do (decision 991), and queue_merge takes a branch nobody approved in Symbiote,
// approving its tip in the same Confirm (decision 992).
import { describe, expect, it } from 'vitest';
import type { McpServices } from '../src/mcp-context.js';
import { HEAD, TIP, askOf, call, entry, fakes, server } from './mcp-fakes.js';

const at = HEAD.slice(0, 7);

/** The services' calls of `name`, in order. */
const named = (calls: unknown[][], ...names: string[]) =>
  calls.filter((c) => names.includes(c[0] as string)).map((c) => c[0]);

describe('An Approve through the MCP queues its merge (MC3, decision 991)', () => {
  it('asks once, then records the verdict and queues the merge, as the page does in two presses', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const pending = call(mcp, 'finish_review', {
      branch: 'fix/a',
      event: 'approve',
      summary: 'Looks right.',
    });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(`Approve fix/a at ${at} and merge it into main`);
    expect(named(calls, 'finish', 'enqueue')).toEqual([]);
    await mcp.answer({ id, yes: true });
    const done = await pending;
    expect(done.isError).toBe(false);
    expect(named(calls, 'finish', 'enqueue')).toEqual(['finish', 'enqueue']);
    expect(calls).toContainEqual(['enqueue', { branch: 'fix/a', into: 'main' }]);
    expect(done.value).toMatchObject({
      verdict: { event: 'approve', head: HEAD },
      merge: { branch: 'fix/a', into: 'main', state: 'queued' },
    });
  });

  it('merge: false records the verdict alone, in the words of before', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const pending = call(mcp, 'finish_review', {
      branch: 'fix/a',
      event: 'approve',
      summary: 'Later.',
      merge: false,
    });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(`Approve fix/a at ${at}: it is to be merged into main`);
    await mcp.answer({ id, yes: true });
    expect((await pending).value).not.toHaveProperty('merge');
    expect(named(calls, 'finish', 'enqueue')).toEqual(['finish']);
  });

  it('takes into and strategy as queue_merge does; a target it cannot take refused before asking', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const approve = { branch: 'fix/a', event: 'approve', summary: 'Yes.' };
    expect(await call(mcp, 'finish_review', { ...approve, into: 'nope' })).toMatchObject({
      isError: true,
      text: 'into: one of main, release',
    });
    expect(await call(mcp, 'finish_review', { ...approve, strategy: 'squash' })).toMatchObject({
      isError: true,
      text: 'strategy: merge or fast-forward',
    });
    const pending = call(mcp, 'finish_review', {
      ...approve,
      into: 'main',
      strategy: 'fast-forward',
    });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(
      `Approve fix/a at ${at} and fast-forward main to it: no merge commit`,
    );
    await mcp.answer({ id, yes: true });
    await pending;
    expect(calls).toContainEqual([
      'enqueue',
      { branch: 'fix/a', into: 'main', strategy: 'fast-forward' },
    ]);
  });

  it('a branch queued already: refused before asking; merge: false records the verdict alone', async () => {
    const { services } = fakes({ merges: [entry({ branch: 'fix/a', state: 'checking' })] });
    const mcp = server(services);
    expect(
      await call(mcp, 'finish_review', { branch: 'fix/a', event: 'approve', summary: 'Yes.' }),
    ).toMatchObject({
      isError: true,
      text: 'fix/a is in the merge queue already: merge: false records the verdict alone',
    });
  });

  it('says a merge the queue refuses after the approval; the approval stands', async () => {
    const { services, calls } = fakes({ refuse: { enqueue: { 'fix/a': 'main moved' } } });
    const mcp = server(services);
    const pending = call(mcp, 'finish_review', {
      branch: 'fix/a',
      event: 'approve',
      summary: 'Yes.',
    });
    await mcp.answer({ id: await askOf(mcp), yes: true });
    const done = await pending;
    expect(done.isError).toBe(false);
    expect(done.value).toMatchObject({
      verdict: { event: 'approve' },
      merge: { refused: 'main moved' },
    });
    expect(named(calls, 'finish', 'enqueue')).toEqual(['finish', 'enqueue']);
  });

  it('request-changes and comment queue nothing; without a merger, an approval as before', async () => {
    const { services, calls } = fakes();
    const mcp = server(services);
    const pending = call(mcp, 'finish_review', {
      branch: 'fix/a',
      event: 'request-changes',
      summary: 'Two things.',
    });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(`Request changes on fix/a at ${at}`);
    await mcp.answer({ id, yes: true });
    await pending;
    const without: McpServices = { ...services };
    delete without.merges;
    const alone = server(without);
    const approved = call(alone, 'finish_review', {
      branch: 'fix/a',
      event: 'approve',
      summary: 'Yes.',
    });
    const asked = await askOf(alone);
    expect(alone.asks().asks[0]?.words).toBe(
      `Approve fix/a at ${at}: it is to be merged into main`,
    );
    await alone.answer({ id: asked, yes: true });
    await approved;
    expect(named(calls, 'enqueue')).toEqual([]);
  });
});

describe('queue_merge on a branch nobody approved (MC3, decision 992)', () => {
  it('asks once to approve its tip and merge it; no workspace needed; the verdict says how', async () => {
    const { services, calls } = fakes({ reviewable: ['refactor/layout-flow'] });
    const mcp = server(services);
    const pending = call(mcp, 'queue_merge', { branch: 'refactor/layout-flow' });
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(
      `Approve refactor/layout-flow at ${TIP.slice(0, 7)} (not reviewed in Symbiote) and merge it into main`,
    );
    await mcp.answer({ id, yes: true });
    const done = await pending;
    expect(done.isError).toBe(false);
    expect(calls.find((c) => c[0] === 'finish')).toEqual([
      'finish',
      'refactor/layout-flow',
      {
        event: 'approve',
        body: 'Approved through queue_merge: merged without a review in Symbiote.',
        comments: [],
        via: 'nucleus',
      },
      expect.any(String),
    ]);
    expect(calls).toContainEqual(['enqueue', { branch: 'refactor/layout-flow', into: 'main' }]);
    expect(done.value).toMatchObject({
      merge: { branch: 'refactor/layout-flow', state: 'queued' },
    });
  });

  it('a branch that does not exist is refused as before', async () => {
    const mcp = server(fakes().services);
    expect(await call(mcp, 'queue_merge', { branch: 'feature/b' })).toMatchObject({
      isError: true,
      text: 'feature/b has no approval',
    });
  });
});
