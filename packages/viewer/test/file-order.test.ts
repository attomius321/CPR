import { readFileSync } from 'node:fs';
import type { Finding, Graph, GraphNode, ReviewFile, Severity } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import { fileFindings, fileKind, riskOrder } from '../src/diff/file-order.js';

// The Files page in order of risk (V102, decisions 973–974): files with findings first, worst
// severity then most; then other code, tests, and every other file; git's order inside a group.

/** A finding on `path`: a symbol of its own there, or `symbol` when given. */
interface On {
  path: string;
  severity: Severity;
  /** A signature change with nothing left to update (V100's `settled`): not listed. */
  settled?: boolean;
  /** The symbol's side: `base` for a removed symbol, whose file is the base's path. */
  side?: 'base' | 'head';
}

function node(id: string, file: string, side: 'base' | 'head'): GraphNode {
  const at = {
    file,
    range: { start: { line: 1, col: 1 }, end: { line: 2, col: 1 } },
    signature: 'type T = 1',
    hashes: { signature: 's', body: 'b' },
  };
  return {
    id,
    kind: 'type',
    name: id.slice(id.indexOf('#') + 1),
    container: null,
    language: 'typescript',
    exported: true,
    status: side === 'base' ? 'removed' : 'modified',
    previousId: null,
    base: side === 'base' ? at : null,
    head: side === 'head' ? at : null,
  };
}

/** A graph of `files` (paths, or files) changed and a finding on each of `on`. */
function change(
  files: readonly (string | ReviewFile)[],
  on: readonly On[] = [],
): { files: ReviewFile[]; graph: Graph } {
  const list = files.map((f): ReviewFile =>
    typeof f === 'string' ? { path: f, status: 'modified' } : f,
  );
  const nodes = on.map((f, i) => node(`${f.path}#S${i}`, f.path, f.side ?? 'head'));
  const findings: Finding[] = on.map((f, i) => ({
    id: `f${i + 1}`,
    rule: 'signature-changed',
    severity: f.severity,
    symbol: `${f.path}#S${i}`,
    related: [],
    message: 'Its signature changed.',
    data: { compatibility: f.settled ? 'compatible' : 'breaking', untouched: f.settled ? 0 : 2 },
  }));
  const graph = { files: list, nodes, edges: [], findings } as unknown as Graph;
  return { files: list, graph };
}

const paths = (files: readonly ReviewFile[]) => files.map((f) => f.path);

/**
 * A walked change (`test/fixtures/findings/`, V100: its real findings, without its symbols) over
 * `files`, git's order: a finding's file read from its symbol's ID.
 */
function walked(name: string, files: readonly string[]): { files: ReviewFile[]; graph: Graph } {
  const { findings } = JSON.parse(
    readFileSync(new URL(`./fixtures/findings/${name}.json`, import.meta.url), 'utf8'),
  ) as { findings: Finding[] };
  const list = files.map((path): ReviewFile => ({ path, status: 'modified' }));
  return {
    files: list,
    graph: { files: list, nodes: [], edges: [], findings } as unknown as Graph,
  };
}

describe('fileKind', () => {
  it('tells code, tests and other files apart by their paths', () => {
    const kinds = Object.fromEntries(
      [
        'src/user.ts',
        'src/App.tsx',
        'scripts/dogfood.mjs',
        'lib/old.js',
        'src/page.html',
        'src/page.css',
        'src/theme.scss',
        'src/user.test.ts',
        'e2e/files.spec.ts',
        'packages/viewer/e2e/symbiote.ts',
        'packages/cli/test/merges.test.ts',
        'test/helpers.ts',
        'packages/forge/test/fixtures/issues/github-issue.json',
        'README.md',
        'docs/PLAN.md',
        'package.json',
        '.claude/skills/milestone/SKILL.md',
        'docs/images/review-files.png',
      ].map((path) => [path, fileKind(path)]),
    );
    expect(kinds).toEqual({
      'src/user.ts': 'code',
      'src/App.tsx': 'code',
      'scripts/dogfood.mjs': 'code',
      'lib/old.js': 'code',
      'src/page.html': 'code',
      'src/page.css': 'code',
      'src/theme.scss': 'code',
      'src/user.test.ts': 'tests',
      'e2e/files.spec.ts': 'tests',
      'packages/viewer/e2e/symbiote.ts': 'tests',
      'packages/cli/test/merges.test.ts': 'tests',
      'test/helpers.ts': 'tests',
      // A test's fixture is the test's.
      'packages/forge/test/fixtures/issues/github-issue.json': 'tests',
      'README.md': 'other',
      'docs/PLAN.md': 'other',
      'package.json': 'other',
      '.claude/skills/milestone/SKILL.md': 'other',
      'docs/images/review-files.png': 'other',
    });
  });
});

describe('riskOrder', () => {
  it('puts files with findings first, then code, tests and other files, git’s order in each', () => {
    const { files, graph } = change(
      [
        'CLAUDE.md',
        'README.md',
        'docs/PLAN.md',
        'e2e/a.spec.ts',
        'src/a.ts',
        'src/b.ts',
        'src/b.test.ts',
        'src/c.ts',
        'src/d.css',
      ],
      [{ path: 'src/c.ts', severity: 'info' }],
    );
    expect(paths(riskOrder(files, graph))).toEqual([
      'src/c.ts',
      'src/a.ts',
      'src/b.ts',
      'src/d.css',
      'e2e/a.spec.ts',
      'src/b.test.ts',
      'CLAUDE.md',
      'README.md',
      'docs/PLAN.md',
    ]);
  });

  it('ranks files with findings by their worst severity, then by the most of each severity', () => {
    const { files, graph } = change(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
      [
        // a: one info. b: two warnings. c: a warning and three infos. d: an error.
        // e: two infos. f: a warning and an info.
        { path: 'a.ts', severity: 'info' },
        { path: 'b.ts', severity: 'warning' },
        { path: 'b.ts', severity: 'warning' },
        { path: 'c.ts', severity: 'warning' },
        { path: 'c.ts', severity: 'info' },
        { path: 'c.ts', severity: 'info' },
        { path: 'c.ts', severity: 'info' },
        { path: 'd.ts', severity: 'error' },
        { path: 'e.ts', severity: 'info' },
        { path: 'e.ts', severity: 'info' },
        { path: 'f.ts', severity: 'warning' },
        { path: 'f.ts', severity: 'info' },
      ],
    );
    expect(paths(riskOrder(files, graph))).toEqual([
      'd.ts',
      'b.ts',
      'c.ts',
      'f.ts',
      'e.ts',
      'a.ts',
    ]);
  });

  it('counts the findings the Findings tab lists: a settled signature change is not one', () => {
    const { files, graph } = change(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        { path: 'a.ts', severity: 'info', settled: true },
        { path: 'a.ts', severity: 'info', settled: true },
        { path: 'c.ts', severity: 'info' },
      ],
    );
    // a.ts holds only settled ones: other code, below c.ts's listed info.
    expect(paths(riskOrder(files, graph))).toEqual(['c.ts', 'a.ts', 'b.ts']);
  });

  it('finds a removed symbol of a renamed file under its new path', () => {
    const renamed: ReviewFile = {
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      status: 'renamed',
    };
    const { files, graph } = change(
      ['docs/a.md', 'src/a.ts', renamed],
      [{ path: 'src/old.ts', severity: 'warning', side: 'base' }],
    );
    expect(paths(riskOrder(files, graph))).toEqual(['src/new.ts', 'src/a.ts', 'docs/a.md']);
  });

  it('keeps every file, and the list itself when nothing moves', () => {
    const { files, graph } = change(['src/a.ts', 'src/b.ts', 'test/a.test.ts', 'README.md']);
    expect(riskOrder(files, graph)).toEqual(files);
    expect(riskOrder([], graph)).toEqual([]);
  });

  // feature/issues-page (11610c73) as its review served it: 55 files, git's order; 1 warning and
  // 7 infos, 4 of the infos settled (V100). Its Files page opened on CLAUDE.md; the warning's file
  // was 49th (the spike, G7).
  const FEATURE = [
    'CLAUDE.md',
    'README.md',
    'docs/JOURNAL.md',
    'docs/PLAN.md',
    'docs/guide/pages.md',
    'docs/guide/review-and-ci.md',
    'docs/journal/is1-issues-page.md',
    'docs/plan/is1-issues-page.md',
    'docs/reference/commands.md',
    'packages/cli/src/hive-request.ts',
    'packages/cli/src/issues.ts',
    'packages/cli/src/main.ts',
    'packages/cli/src/server.ts',
    'packages/cli/test/hive-request.test.ts',
    'packages/cli/test/issues.test.ts',
    'packages/cli/test/server.test.ts',
    'packages/core/src/index.ts',
    'packages/core/src/issues.ts',
    'packages/forge/package.json',
    'packages/forge/src/github.ts',
    'packages/forge/src/gitlab.ts',
    'packages/forge/src/http.ts',
    'packages/forge/src/index.ts',
    'packages/forge/src/issues.ts',
    'packages/forge/src/types.ts',
    'packages/forge/test/fake-forge.ts',
    'packages/forge/test/fixtures/issues/github-comments.json',
    'packages/forge/test/fixtures/issues/github-issue.json',
    'packages/forge/test/fixtures/issues/github-issues.json',
    'packages/forge/test/fixtures/issues/gitlab-issue.json',
    'packages/forge/test/fixtures/issues/gitlab-issues.json',
    'packages/forge/test/fixtures/issues/gitlab-notes.json',
    'packages/forge/test/issues.test.ts',
    'packages/forge/test/mock-api.ts',
    'packages/viewer/CLAUDE.md',
    'packages/viewer/e2e/issues.spec.ts',
    'packages/viewer/e2e/page-frame.spec.ts',
    'packages/viewer/e2e/shell.spec.ts',
    'packages/viewer/e2e/targets.spec.ts',
    'packages/viewer/e2e/title-bar.spec.ts',
    'packages/viewer/e2e/tooltips.spec.ts',
    'packages/viewer/e2e/workspace-history.spec.ts',
    'packages/viewer/src/issues/IssuesPage.css',
    'packages/viewer/src/issues/IssuesPage.tsx',
    'packages/viewer/src/issues/issue-text.ts',
    'packages/viewer/src/issues/issues.ts',
    'packages/viewer/src/shell/Shell.tsx',
    'packages/viewer/src/shell/Sidenav.tsx',
    'packages/viewer/src/shell/pages.ts',
    'packages/viewer/src/styles.css',
    'packages/viewer/src/ui/icons.tsx',
    'packages/viewer/src/ui/widths.ts',
    'packages/viewer/test/issue-text.test.ts',
    'packages/viewer/test/issues.test.ts',
    'packages/viewer/test/pages.test.ts',
  ];
  it("opens feature/issues-page on its warning's file, its docs last", () => {
    const { files, graph } = walked('issues', FEATURE);
    expect(paths(riskOrder(files, graph))).toEqual([
      // Its findings: the warning, then the listed infos.
      'packages/viewer/src/shell/pages.ts',
      'packages/cli/src/hive-request.ts',
      'packages/forge/src/types.ts',
      'packages/forge/test/fake-forge.ts',
      // Other code: server.ts, http.ts and widths.ts hold settled changes only.
      'packages/cli/src/issues.ts',
      'packages/cli/src/main.ts',
      'packages/cli/src/server.ts',
      'packages/core/src/index.ts',
      'packages/core/src/issues.ts',
      'packages/forge/src/github.ts',
      'packages/forge/src/gitlab.ts',
      'packages/forge/src/http.ts',
      'packages/forge/src/index.ts',
      'packages/forge/src/issues.ts',
      'packages/viewer/src/issues/IssuesPage.css',
      'packages/viewer/src/issues/IssuesPage.tsx',
      'packages/viewer/src/issues/issue-text.ts',
      'packages/viewer/src/issues/issues.ts',
      'packages/viewer/src/shell/Shell.tsx',
      'packages/viewer/src/shell/Sidenav.tsx',
      'packages/viewer/src/styles.css',
      'packages/viewer/src/ui/icons.tsx',
      'packages/viewer/src/ui/widths.ts',
      // Tests, their fixtures with them.
      'packages/cli/test/hive-request.test.ts',
      'packages/cli/test/issues.test.ts',
      'packages/cli/test/server.test.ts',
      'packages/forge/test/fixtures/issues/github-comments.json',
      'packages/forge/test/fixtures/issues/github-issue.json',
      'packages/forge/test/fixtures/issues/github-issues.json',
      'packages/forge/test/fixtures/issues/gitlab-issue.json',
      'packages/forge/test/fixtures/issues/gitlab-issues.json',
      'packages/forge/test/fixtures/issues/gitlab-notes.json',
      'packages/forge/test/issues.test.ts',
      'packages/forge/test/mock-api.ts',
      'packages/viewer/e2e/issues.spec.ts',
      'packages/viewer/e2e/page-frame.spec.ts',
      'packages/viewer/e2e/shell.spec.ts',
      'packages/viewer/e2e/targets.spec.ts',
      'packages/viewer/e2e/title-bar.spec.ts',
      'packages/viewer/e2e/tooltips.spec.ts',
      'packages/viewer/e2e/workspace-history.spec.ts',
      'packages/viewer/test/issue-text.test.ts',
      'packages/viewer/test/issues.test.ts',
      'packages/viewer/test/pages.test.ts',
      // Docs and every other file, last.
      'CLAUDE.md',
      'README.md',
      'docs/JOURNAL.md',
      'docs/PLAN.md',
      'docs/guide/pages.md',
      'docs/guide/review-and-ci.md',
      'docs/journal/is1-issues-page.md',
      'docs/plan/is1-issues-page.md',
      'docs/reference/commands.md',
      'packages/forge/package.json',
      'packages/viewer/CLAUDE.md',
    ]);
  });

  // fix/e2e-flakes (4cbcae0c): 18 files, 6 infos, 2 of them settled. It opened on docs/JOURNAL.md.
  it('opens the small fix on a file with a finding, not docs/JOURNAL.md', () => {
    const { files, graph } = walked('flakes', [
      'docs/JOURNAL.md',
      'docs/PLAN.md',
      'docs/area/merger.md',
      'docs/journal/fix-e2e-flakes.md',
      'packages/cli/src/command-view.ts',
      'packages/cli/src/merge-context.ts',
      'packages/cli/src/merges.ts',
      'packages/cli/src/workspace-agent.ts',
      'packages/cli/src/workspace-context.ts',
      'packages/cli/src/workspace-launches.ts',
      'packages/cli/src/workspace-summary.ts',
      'packages/cli/src/workspaces.ts',
      'packages/cli/test/merges.test.ts',
      'packages/cli/test/workspaces.test.ts',
      'packages/viewer/e2e/shell.spec.ts',
      'packages/viewer/e2e/symbiote.ts',
      'packages/viewer/e2e/workspaces.spec.ts',
      'packages/viewer/src/workspaces/useWorkspaces.ts',
    ]);
    expect(paths(riskOrder(files, graph))).toEqual([
      'packages/cli/src/workspace-agent.ts',
      'packages/cli/src/workspace-context.ts',
      'packages/cli/src/workspace-summary.ts',
      'packages/viewer/e2e/symbiote.ts',
      'packages/cli/src/command-view.ts',
      'packages/cli/src/merge-context.ts',
      'packages/cli/src/merges.ts',
      'packages/cli/src/workspace-launches.ts',
      'packages/cli/src/workspaces.ts',
      'packages/viewer/src/workspaces/useWorkspaces.ts',
      'packages/cli/test/merges.test.ts',
      'packages/cli/test/workspaces.test.ts',
      'packages/viewer/e2e/shell.spec.ts',
      'packages/viewer/e2e/workspaces.spec.ts',
      'docs/JOURNAL.md',
      'docs/PLAN.md',
      'docs/area/merger.md',
      'docs/journal/fix-e2e-flakes.md',
    ]);
  });
});

describe('fileFindings', () => {
  it("counts each file's listed findings by severity, for its row", () => {
    const { files, graph } = change(
      ['a.ts', 'b.ts', 'c.ts', 'README.md'],
      [
        { path: 'a.ts', severity: 'warning' },
        { path: 'a.ts', severity: 'info' },
        { path: 'a.ts', severity: 'info', settled: true },
        { path: 'b.ts', severity: 'info', settled: true },
        { path: 'c.ts', severity: 'error' },
        // Not a changed file: a finding the list has no row for.
        { path: 'elsewhere.ts', severity: 'error' },
      ],
    );
    expect(Object.fromEntries(fileFindings(files, graph))).toEqual({
      'a.ts': { error: 0, warning: 1, info: 1 },
      'c.ts': { error: 1, warning: 0, info: 0 },
    });
  });

  it('reads a graph from before findings were settled, and one with no findings', () => {
    const { files, graph } = change(['a.ts'], [{ path: 'a.ts', severity: 'info' }]);
    const old = {
      ...graph,
      findings: graph.findings.map((f) => ({ ...f, data: {} })),
    };
    expect(fileFindings(files, old).get('a.ts')).toEqual({ error: 0, warning: 0, info: 1 });
    expect(fileFindings(files, { ...graph, findings: [] }).size).toBe(0);
  });
});
