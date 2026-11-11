// Symbiote's MCP in MC3: mark_merged, behind the person's Confirm (decision 990): listed only where
// the repository names its `merged` commands, refused while a merge into the branch is under way.
import { describe, expect, it } from 'vitest';
import type { MarkMerged, MarkPlan } from '../src/mark-merged.js';
import type { McpServices } from '../src/mcp-context.js';
import { askOf, call, entry, fakes, server } from './mcp-fakes.js';

const PLAN: MarkPlan = {
  into: 'main',
  tip: 'd'.repeat(40),
  files: ['docs/PLAN.md', 'docs/decisions.md', 'docs/journal/v99.md', 'docs/plan/v99.md'],
  output: 'marked  V99  feature/v99  merged 2026-11-11',
  push: true,
};

/** Marks that say what they are asked, configured unless `off`. */
function fakeMarks(plan: MarkPlan = PLAN, off = false) {
  const asked: string[] = [];
  const marks: Pick<MarkMerged, 'configured' | 'preview' | 'mark'> = {
    configured: () => !off,
    preview: (into) => {
      asked.push(`preview ${into ?? ''}`);
      return Promise.resolve(plan);
    },
    mark: (into) => {
      asked.push(`mark ${into ?? ''}`);
      return Promise.resolve({
        into: plan.into,
        tip: plan.tip,
        files: plan.files,
        output: plan.output,
        commit: 'e'.repeat(40),
        landed: true,
        pushed: { ok: true, remote: 'origin' },
      });
    },
  };
  return { marks, asked };
}

const listedTools = async (services: McpServices) => {
  const answer = (await server(services).handle(
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { via: 'nucleus' },
  )) as { result: { tools: { name: string }[] } };
  return answer.result.tools.map((t) => t.name);
};

describe('mark_merged (MC3, decision 990)', () => {
  it('is listed only where the repository names its commands', async () => {
    const { services } = fakes();
    expect(await listedTools({ ...services, marks: fakeMarks().marks })).toContain('mark_merged');
    expect(await listedTools({ ...services, marks: fakeMarks(PLAN, true).marks })).not.toContain(
      'mark_merged',
    );
    expect(await listedTools(services)).not.toContain('mark_merged');
    const mcp = server({ ...services, marks: fakeMarks(PLAN, true).marks });
    const refused = await mcp.handle(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'mark_merged', arguments: {} },
      },
      { via: 'nucleus' },
    );
    expect(refused).toMatchObject({ error: { message: 'unknown tool: mark_merged' } });
  });

  it('asks once with what the commit holds and whether it is pushed, then marks', async () => {
    const { services } = fakes({ merges: [entry({ into: 'main', state: 'landed' })] });
    const { marks, asked } = fakeMarks();
    const mcp = server({ ...services, marks });
    const pending = call(mcp, 'mark_merged');
    const id = await askOf(mcp);
    expect(mcp.asks().asks[0]?.words).toBe(
      'Mark merged work on main: one commit of 4 files (docs/PLAN.md, docs/decisions.md, docs/journal/v99.md and 1 more), pushed',
    );
    expect(asked).toEqual(['preview ']);
    await mcp.answer({ id, yes: true });
    const done = await pending;
    expect(done.isError).toBe(false);
    expect(asked).toEqual(['preview ', 'mark main']);
    expect(done.value).toMatchObject({
      commit: 'e'.repeat(40),
      landed: true,
      pushed: { ok: true, remote: 'origin' },
      output: 'marked  V99  feature/v99  merged 2026-11-11',
    });
  });

  it('is refused while a merge into the branch is under way, and with nothing to mark', async () => {
    const busy = fakes({
      merges: [entry({ branch: 'feature/x', into: 'main', state: 'checking' })],
    });
    expect(
      await call(server({ ...busy.services, marks: fakeMarks().marks }), 'mark_merged'),
    ).toMatchObject({
      isError: true,
      text: "feature/x's merge into main is checking: mark merged work once it lands or leaves the queue",
    });
    const { services } = fakes({ merges: [] });
    const nothing = fakeMarks({
      ...PLAN,
      files: [],
      output: 'Nothing to mark: every merged row says ✅.',
    });
    expect(await call(server({ ...services, marks: nothing.marks }), 'mark_merged')).toMatchObject({
      isError: true,
      text: 'Nothing to mark on main: Nothing to mark: every merged row says ✅.',
    });
  });
});
