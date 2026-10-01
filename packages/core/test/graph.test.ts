import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { analyzeDirectories, buildGraph, SCHEMA_VERSION, type Graph } from '../src/index.js';

const schema = JSON.parse(
  readFileSync(new URL('../schema/graph.schema.json', import.meta.url), 'utf8'),
) as object;
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const fixture = (name: string, side: 'base' | 'head') =>
  fileURLToPath(new URL(`./fixtures/diff/${name}/${side}`, import.meta.url));

async function graphOf(name: string): Promise<Graph> {
  const analysis = await analyzeDirectories(fixture(name, 'base'), fixture(name, 'head'));
  const graph = buildGraph(analysis, { generator: { name: 'cpr', version: 'test' } });
  // Folder refs are absolute paths; make the snapshot machine-independent.
  graph.revisions.base.ref = 'base';
  graph.revisions.head.ref = 'head';
  return graph;
}

describe('buildGraph', () => {
  it.each(['service', 'callers', 'detectors'])('builds a valid graph for %s', async (name) => {
    const graph = await graphOf(name);
    expect(validate(graph), JSON.stringify(validate.errors, null, 2)).toBe(true);
    await expect(`${JSON.stringify(graph, null, 2)}\n`).toMatchFileSnapshot(
      `./__snapshots__/graph-${name}.json`,
    );
  });

  it('fills stats and versions', async () => {
    const graph = await graphOf('callers');
    expect(graph.schemaVersion).toBe(SCHEMA_VERSION);
    expect(graph.stats).toEqual({
      filesChanged: 1,
      symbols: { added: 1, removed: 1, modified: 1, context: 2 },
      edges: 4,
    });
  });

  it('gives special nodes no sides and context nodes the side they were found on', async () => {
    const graph = await graphOf('callers');
    const total = graph.nodes.find((n) => n.id === 'src/app.ts#total');
    expect(total).toMatchObject({ status: 'unchanged', base: null, head: { file: 'src/app.ts' } });
  });

  it('rejects malformed graphs', () => {
    expect(validate({ schemaVersion: '0.1.0' })).toBe(false);
  });
});
