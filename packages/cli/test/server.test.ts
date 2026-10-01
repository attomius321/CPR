import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Graph } from '@cpr/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tempDir } from '../../core/test/helpers/git-repo.js';
import { sourceFiles, startViewServer, type ViewServer } from '../src/server.js';

const graph = JSON.parse(
  readFileSync(
    new URL('../../core/test/__snapshots__/graph-callers.json', import.meta.url),
    'utf8',
  ),
) as Graph;

describe('startViewServer', () => {
  const viewer = tempDir();
  let server: ViewServer;
  const reads: string[] = [];

  beforeAll(async () => {
    mkdirSync(join(viewer, 'assets'));
    writeFileSync(join(viewer, 'index.html'), '<html>viewer</html>');
    writeFileSync(join(viewer, 'assets', 'app.js'), 'console.log(1)');
    server = await startViewServer({
      graph,
      viewerDir: viewer,
      readSource: (side, path) => {
        reads.push(`${side}:${path}`);
        return Promise.resolve(`// ${side} ${path}`);
      },
    });
  });

  afterAll(async () => {
    await server.close();
    rmSync(viewer, { recursive: true, force: true });
  });

  const get = async (path: string) => {
    const response = await fetch(new URL(path, server.url));
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      body: await response.text(),
    };
  };

  it('listens on localhost only', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('serves the viewer files', async () => {
    expect(await get('/')).toMatchObject({ status: 200, body: '<html>viewer</html>' });
    expect(await get('/assets/app.js')).toMatchObject({
      status: 200,
      type: 'text/javascript; charset=utf-8',
    });
    expect((await get('/missing.js')).status).toBe(404);
  });

  it('refuses paths outside the viewer folder', async () => {
    expect((await get('/../../package.json')).status).toBe(404);
    expect((await get('/%2e%2e/%2e%2e/package.json')).status).toBe(404);
  });

  it('serves the graph', async () => {
    const { status, body } = await get('/api/graph');
    expect(status).toBe(200);
    expect((JSON.parse(body) as Graph).nodes).toHaveLength(graph.nodes.length);
  });

  it('serves only sources the graph mentions', async () => {
    expect(await get('/api/source?side=head&file=src/math.ts')).toMatchObject({
      status: 200,
      body: '// head src/math.ts',
    });
    expect((await get('/api/source?side=head&file=../../etc/passwd')).status).toBe(404);
    expect((await get('/api/source?side=elsewhere&file=src/math.ts')).status).toBe(404);
    expect(reads).toEqual(['head:src/math.ts']);
  });
});

describe('sourceFiles', () => {
  it('lists files per side from nodes and changed files', () => {
    const files = sourceFiles(graph);
    // Context nodes carry only the head side.
    expect([...files.base].sort()).toEqual(['src/math.ts']);
    expect([...files.head].sort()).toEqual(['src/app.ts', 'src/math.ts']);
  });
});
