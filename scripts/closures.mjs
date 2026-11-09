#!/usr/bin/env node
// The long functions of TypeScript files (refactor/cli-services): each function, arrow or method of
// at least `--min` lines (default 100), its span and the functions it holds, nested as in the code;
// then every file's lines. A closure over 600 lines, or a file over 800, is what the refactor's
// "Done when" counts.
//
//   node scripts/closures.mjs                          # packages/cli/src, functions of 100 lines up
//   node scripts/closures.mjs --min 600 <file>…        # only these files, 600 lines up
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const args = process.argv.slice(2);
const at = args.indexOf('--min');
const min = at === -1 ? 100 : Number(args[at + 1]);
const named = args.filter((_, i) => i !== at && i !== at + 1);
const files =
  named.length > 0
    ? named
    : readdirSync('packages/cli/src')
        .filter((name) => name.endsWith('.ts'))
        .map((name) => join('packages/cli/src', name))
        .sort();

/** A function's name: its declaration's, or the variable or property it is assigned to. */
function nameOf(node) {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return node.name?.getText();
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
      return parent.name.getText();
    }
    return '(anonymous)';
  }
  return undefined;
}

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const line = (position) => source.getLineAndCharacterOfPosition(position).line + 1;
  const found = [];
  const visit = (node, depth) => {
    const name = nameOf(node);
    if (name === undefined) return ts.forEachChild(node, (child) => visit(child, depth));
    const [from, to] = [line(node.getStart()), line(node.getEnd())];
    if (to - from + 1 >= min)
      found.push(`${'  '.repeat(depth + 1)}${name} ${from}-${to} (${to - from + 1})`);
    ts.forEachChild(node, (child) => visit(child, depth + 1));
  };
  visit(source, 0);
  console.log(`${file} ${text.split('\n').length - 1}`);
  for (const row of found) console.log(row);
}
