// Spike S1: TS 7 (Go) compiler API vs ts-morph (TS 6) for CPR's reference search.
// Usage: node spike.mjs <tsconfig.json> [<tsconfig.json> …]
import { createRequire } from 'node:module';
import { relative } from 'node:path';
import { getTouchingToken } from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

const { Project, ts } = createRequire(new URL('../../packages/core/package.json', import.meta.url))('ts-morph');
const configs = process.argv.slice(2);
if (configs.length === 0) throw new Error('usage: node spike.mjs <tsconfig.json>…');

const time = (fn) => {
  const start = performance.now();
  const value = fn();
  return [value, Math.round(performance.now() - start)];
};

for (const config of configs) {
  console.log(`\n# ${config}`);

  // --- ts-morph (TypeScript 6.0, in-process) -------------------------------------------
  const [morph, morphLoad] = time(() => {
    const project = new Project({ tsConfigFilePath: config });
    const service = project.getLanguageService().compilerObject;
    const program = service.getProgram();
    program.getTypeChecker();
    return { service, program };
  });
  const root = morph.program.getCurrentDirectory();
  const files = morph.program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && !sf.fileName.includes('/node_modules/') && !sf.fileName.includes('/fixtures/'));
  // Every top-level named function/class/interface/variable: the symbols CPR searches from.
  const targets = files.flatMap((sf) =>
    sf.statements.flatMap((statement) => {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name) {
        return [{ file: sf.fileName, pos: statement.name.getStart(sf), name: statement.name.text }];
      }
      if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.flatMap((d) =>
          ts.isIdentifier(d.name) ? [{ file: sf.fileName, pos: d.name.getStart(sf), name: d.name.text }] : [],
        );
      }
      return [];
    }),
  );
  const [morphRefs, morphSearch] = time(() =>
    targets.map((t) =>
      (morph.service.findReferences(t.file, t.pos) ?? [])
        .flatMap((g) => g.references.filter((r) => !r.isDefinition))
        .map((r) => `${relative(root, r.fileName)}:${r.textSpan.start}`)
        .sort(),
    ),
  );

  // --- TypeScript 7 (Go, over IPC) ------------------------------------------------------
  const [go, goStart] = time(() => new API({ cwd: root }));
  const [project, goLoad] = time(() => {
    const snapshot = go.updateSnapshot({ openProjects: [config] });
    const project = snapshot.getProjects()[0];
    project.program.getSourceFileNames();
    return project;
  });
  const [goRefs, goSearch] = time(() =>
    targets.map((t) => {
      const sf = project.program.getSourceFile(t.file);
      if (!sf) return ['<file missing>'];
      const name = getTouchingToken(sf, t.pos);
      const entries = project.checker.getReferencedSymbolsForNode(name, t.pos) ?? [];
      return entries
        .flatMap((e) => e.references)
        .map((handle) => handle.resolve())
        .filter((node) => node && !isDefinitionName(node))
        .map((node) => `${relative(root, node.getSourceFile().fileName)}:${node.pos + leadingTrivia(node)}`)
        .sort();
    }),
  );
  go.close();

  // --- compare use sites only (CPR ignores definitions and import/export sites) ------------
  const isUse = (site) => {
    const [file, at] = [site.slice(0, site.lastIndexOf(':')), Number(site.slice(site.lastIndexOf(':') + 1))];
    const sf = morph.program.getSourceFile(`${root}/${file}`);
    if (!sf) return false;
    let node = sf;
    for (;;) {
      const child = node.forEachChild((c) => (c.getStart(sf) <= at && at < c.getEnd() ? c : undefined));
      if (!child) break;
      node = child;
    }
    if (node.parent?.name === node && !ts.isPropertyAccessExpression(node.parent)) return false;
    for (let n = node; n; n = n.parent) {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isExportAssignment(n)) return false;
    }
    return true;
  };
  let same = 0;
  let uses = { tsMorph: 0, ts7: 0 };
  const differences = [];
  targets.forEach((t, i) => {
    const a = [...new Set(morphRefs[i].filter(isUse))];
    const b = [...new Set(goRefs[i].filter(isUse))];
    uses.tsMorph += a.length;
    uses.ts7 += b.length;
    if (JSON.stringify(a) === JSON.stringify(b)) same += 1;
    else if (differences.length < 5) differences.push({ symbol: t.name, tsMorph: a.length, ts7: b.length, sampleMorph: a.slice(0, 3), sampleTs7: b.slice(0, 3) });
  });
  console.log(JSON.stringify({
    programFiles: morph.program.getSourceFiles().length,
    symbols: targets.length,
    tsMorph: { loadMs: morphLoad, searchMs: morphSearch, refs: morphRefs.flat().length },
    ts7: { spawnMs: goStart, loadMs: goLoad, searchMs: goSearch, refs: goRefs.flat().length },
    useSites: uses,
    identicalResults: `${same}/${targets.length}`,
    differences,
  }, null, 2));
}

function isDefinitionName(node) {
  const parent = node.parent;
  return parent && parent.name === node && !('expression' in parent && parent.expression);
}

/** TS 7 nodes report `pos` including leading trivia, like TS 6; compute the token start. */
function leadingTrivia(node) {
  const text = node.getSourceFile().text;
  let i = node.pos;
  while (i < node.end && /\s/.test(text[i])) i++;
  return i - node.pos;
}
