import postcss, { CssSyntaxError, type Root } from 'postcss';
import scss from 'postcss-scss';

/**
 * Parses a stylesheet: SCSS with postcss-scss, CSS with postcss (which reads native nesting
 * too). Undefined, with a warning, when it cannot be read.
 */
export function parseStylesheet(path: string, text: string, warnings: string[]): Root | undefined {
  try {
    return (path.endsWith('.scss') ? scss : postcss).parse(text, { from: path });
  } catch (error) {
    const where =
      error instanceof CssSyntaxError && error.line !== undefined
        ? ` (${error.line}:${error.column ?? 1})`
        : '';
    const reason = error instanceof CssSyntaxError ? error.reason : (error as Error).message;
    warnings.push(`could not read ${path}: ${reason}${where}`);
    return undefined;
  }
}
