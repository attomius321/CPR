const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIPPED_FILE = /\.d\.[cm]?ts$|\.min\.js$/;

/** Files the TypeScript adapter analyzes: TS and JS sources, but not declarations or bundles. */
export function isTsSource(path: string): boolean {
  return SOURCE_FILE.test(path) && !SKIPPED_FILE.test(path);
}
