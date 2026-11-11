// Compares two viewer builds' layouts of the same graphs (V105): each build's layout worker, run
// in Node, lays out each view of each graph, and the layouts are compared whole (nodes, edges,
// the map's file edges, hidden edges, summaries' members). A layout change that should touch
// only some graphs (stylesheets folded into cards) must leave every other one identical.
// Usage: pnpm build; node scripts/viewer/layout-compare.mjs --base <other dist> [--head <dist>]
//        <graph.json>…
// One JSON line per graph and view: `identical`, or what each build drew (nodes by type, edges).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = new URL('.', import.meta.url).pathname;
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' },
    head: { type: 'string', default: resolve(here, '../../packages/viewer/dist') },
  },
});
if (!values.base || positionals.length === 0) {
  throw new Error('usage: layout-compare.mjs --base <dist> [--head <dist>] <graph.json>…');
}

/** A build's `layoutFlow`, through its worker bundle: `onmessage` in, `postMessage` out. */
async function layoutOf(dist) {
  const assets = join(dist, 'assets');
  const file = readdirSync(assets).find((f) => /^layout-worker-.*\.js$/.test(f));
  if (!file) throw new Error(`no layout worker in ${assets}`);
  const scope = globalThis;
  let reply;
  scope.postMessage = (message) => (reply = message);
  // Each build's worker sets the one global `onmessage`: keep this one's.
  await import(`${pathToFileURL(join(assets, file)).href}?${encodeURIComponent(dist)}`);
  const onmessage = scope.onmessage;
  let graphSent;
  return (graph, options) => {
    scope.postMessage = (message) => (reply = message);
    if (graphSent !== graph) {
      onmessage({ data: { type: 'graph', graph } });
      graphSent = graph;
    }
    onmessage({ data: { type: 'layout', id: 1, options } });
    return reply.layout;
  };
}

/** A layout as text, its maps as entries: equal text, equal layout. */
const text = (layout) =>
  JSON.stringify(layout, (_, value) => (value instanceof Map ? [...value] : value));

const drawn = (layout) => {
  const types = {};
  for (const node of layout.nodes) types[node.type] = (types[node.type] ?? 0) + 1;
  return { ...types, edges: layout.edges.length, fileEdges: layout.fileEdges.length };
};

const views = {
  default: {},
  'no context': { context: false },
  'type references': { typeReferences: true },
};

const base = await layoutOf(resolve(values.base));
const head = await layoutOf(resolve(values.head));
let different = 0;
for (const path of positionals) {
  const graph = JSON.parse(readFileSync(path, 'utf8'));
  for (const [view, options] of Object.entries(views)) {
    const a = base(graph, options);
    const b = head(graph, options);
    const identical = text(a) === text(b);
    if (!identical) different++;
    console.log(
      JSON.stringify({
        graph: path.split('/').pop(),
        view,
        identical,
        ...(identical ? {} : { base: drawn(a), head: drawn(b) }),
      }),
    );
  }
}
console.error(`${different} view(s) differ`);
