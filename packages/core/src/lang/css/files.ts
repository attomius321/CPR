const STYLESHEET = /\.(?:css|scss)$/;
const SKIPPED = /\.min\.css$/;

/** Files the stylesheet adapter analyzes: CSS and SCSS, but not minified bundles. */
export function isStylesheet(path: string): boolean {
  return STYLESHEET.test(path) && !SKIPPED.test(path);
}

/** `scss` for SCSS files, `css` for the rest. */
export function stylesheetLanguage(path: string): 'css' | 'scss' {
  return path.endsWith('.scss') ? 'scss' : 'css';
}
