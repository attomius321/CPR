import { posix } from 'node:path';
import type { PluginContext, PluginStyleScope, ts } from '@symbiote/core';
import { calls } from './imports.js';
import { QWIK_PACKAGES } from './projects.js';

const SCOPED = new Set(['useStylesScoped$']);
/** `import styles from './card.css?inline'`: a stylesheet as text, for `useStyles$`. */
const STYLESHEET = /\.s?css(\?inline)?$/;

/**
 * Stylesheets a component applies to its own markup only: `useStylesScoped$(styles)` with
 * `styles` a stylesheet imported by default. `useStyles$` styles are global.
 */
export function scopedStyles(revision: PluginContext): PluginStyleScope[] {
  const tsApi = revision.ts;
  const found: PluginStyleScope[] = [];
  for (const file of revision.sourceFiles()) {
    const sf = revision.syntax(file);
    if (!sf?.text.includes('useStylesScoped$')) continue;
    const sheets = new Map<string, string>();
    for (const statement of sf.statements) {
      if (
        !tsApi.isImportDeclaration(statement) ||
        !tsApi.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      const name = statement.importClause?.name?.text;
      if (!name || !specifier.startsWith('.') || !STYLESHEET.test(specifier)) continue;
      const path = specifier.replace(/\?.*$/, '');
      sheets.set(name, posix.normalize(posix.join(posix.dirname(file), path)));
    }
    if (sheets.size === 0) continue;
    const visit = (node: ts.Node): void => {
      if (tsApi.isCallExpression(node) && calls(tsApi, node, QWIK_PACKAGES, SCOPED)) {
        const [arg] = node.arguments;
        const stylesheet = arg && tsApi.isIdentifier(arg) ? sheets.get(arg.text) : undefined;
        if (stylesheet) found.push({ stylesheet, calls: [{ file, position: node.getStart(sf) }] });
      }
      tsApi.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}
