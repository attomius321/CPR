/**
 * How a language writes comments and strings: what `countLines` needs to tell a comment line from
 * code (RM1). Strings are followed so that a comment opener inside one (`'src/**\/*.ts'`) opens
 * nothing; only block comments and strings that may span lines carry over to the next line.
 */
export interface Syntax {
  /** Line comment openers: `//`, `#`, `--`. */
  line?: readonly string[];
  /** Block comments, opener and closer: `/*` and `*\/`, `<!--` and `-->`. Checked before `line`. */
  block?: readonly (readonly [string, string])[];
  /** Strings that end at their delimiter or at the line's end: `"`, `'`. */
  strings?: readonly string[];
  /** Strings that may span lines: JavaScript's template literals, Python's `"""`. */
  multiline?: readonly string[];
  /** Of `multiline`, those without backslash escapes (Go's raw strings). */
  raw?: readonly string[];
  /** Of `multiline`, those that are a comment when nothing else is on the line before them. */
  docstrings?: readonly string[];
  /** JavaScript's regular expressions, `/…/`, where a value may start. */
  regex?: boolean;
}

/** A language: its name, the kind of file it makes, and its syntax (none: no comments). */
export interface Language {
  name: string;
  kind: 'source' | 'docs' | 'data';
  syntax?: Syntax;
}

const QUOTES = ['"', "'"] as const;
const C_COMMENTS = { line: ['//'], block: [['/*', '*/']] } as const;
const C: Syntax = { ...C_COMMENTS, strings: QUOTES };
const JS: Syntax = { ...C, multiline: ['`'], regex: true };
const GO: Syntax = { ...C, multiline: ['`'], raw: ['`'] };
const CSS: Syntax = { block: [['/*', '*/']], strings: QUOTES };
const SCSS: Syntax = { ...CSS, line: ['//'] };
const MARKUP: Syntax = { block: [['<!--', '-->']] };
const COMPONENT: Syntax = {
  ...JS,
  block: [
    ['<!--', '-->'],
    ['/*', '*/'],
  ],
};
const HASH: Syntax = { line: ['#'], strings: QUOTES };
const PYTHON: Syntax = {
  ...HASH,
  multiline: ['"""', "'''"],
  docstrings: ['"""', "'''"],
};
const DASHES: Syntax = { line: ['--'], block: [['/*', '*/']], strings: QUOTES };
const LUA: Syntax = { line: ['--'], block: [['--[[', ']]']], strings: QUOTES };
const POWERSHELL: Syntax = { line: ['#'], block: [['<#', '#>']], strings: QUOTES };
const JSON_SYNTAX: Syntax = { ...C_COMMENTS, strings: ['"'] };

const source = (name: string, syntax?: Syntax): Language => ({
  name,
  kind: 'source',
  ...(syntax ? { syntax } : {}),
});
const docs = (name: string, syntax?: Syntax): Language => ({
  name,
  kind: 'docs',
  ...(syntax ? { syntax } : {}),
});
const data = (name: string, syntax?: Syntax): Language => ({
  name,
  kind: 'data',
  ...(syntax ? { syntax } : {}),
});

const TYPESCRIPT = source('TypeScript', JS);
const JAVASCRIPT = source('JavaScript', JS);

/** By extension, lower case. */
const BY_EXTENSION: Record<string, Language> = {
  ts: TYPESCRIPT,
  mts: TYPESCRIPT,
  cts: TYPESCRIPT,
  tsx: source('TSX', JS),
  js: JAVASCRIPT,
  mjs: JAVASCRIPT,
  cjs: JAVASCRIPT,
  jsx: source('JSX', JS),
  vue: source('Vue', COMPONENT),
  svelte: source('Svelte', COMPONENT),
  astro: source('Astro', COMPONENT),
  css: source('CSS', CSS),
  scss: source('SCSS', SCSS),
  sass: source('Sass', SCSS),
  less: source('Less', SCSS),
  styl: source('Stylus', SCSS),
  html: source('HTML', MARKUP),
  htm: source('HTML', MARKUP),
  java: source('Java', C),
  kt: source('Kotlin', { ...C, multiline: ['"""'], raw: ['"""'] }),
  kts: source('Kotlin', { ...C, multiline: ['"""'], raw: ['"""'] }),
  scala: source('Scala', C),
  groovy: source('Groovy', C),
  gradle: source('Gradle', C),
  swift: source('Swift', { ...C, multiline: ['"""'] }),
  dart: source('Dart', C),
  c: source('C', C),
  h: source('C', C),
  cc: source('C++', C),
  cpp: source('C++', C),
  hpp: source('C++', C),
  m: source('Objective-C', C),
  mm: source('Objective-C', C),
  cs: source('C#', C),
  go: source('Go', GO),
  rs: source('Rust', { ...C, strings: ["'"], multiline: ['"'] }),
  proto: source('Protocol Buffers', C),
  php: source('PHP', { ...C, line: ['//', '#'] }),
  py: source('Python', PYTHON),
  rb: source('Ruby', HASH),
  sh: source('Shell', HASH),
  bash: source('Shell', HASH),
  zsh: source('Shell', HASH),
  ps1: source('PowerShell', POWERSHELL),
  sql: source('SQL', DASHES),
  lua: source('Lua', LUA),
  graphql: source('GraphQL', HASH),
  gql: source('GraphQL', HASH),
  md: docs('Markdown', MARKUP),
  mdx: docs('MDX', MARKUP),
  markdown: docs('Markdown', MARKUP),
  rst: docs('reStructuredText'),
  adoc: docs('AsciiDoc'),
  txt: docs('Text'),
  json: data('JSON', JSON_SYNTAX),
  jsonc: data('JSON', JSON_SYNTAX),
  json5: data('JSON', JSON_SYNTAX),
  yaml: data('YAML', HASH),
  yml: data('YAML', HASH),
  toml: data('TOML', HASH),
  xml: data('XML', MARKUP),
  resx: data('XML', MARKUP),
  plist: data('XML', MARKUP),
  svg: data('SVG', MARKUP),
  csv: data('CSV'),
};

/** By file name, for files without a telling extension. */
const BY_NAME: Record<string, Language> = {
  Dockerfile: source('Dockerfile', HASH),
  Makefile: source('Makefile', HASH),
  Rakefile: source('Ruby', HASH),
  Gemfile: source('Ruby', HASH),
};

/** The language of a repo-relative path, by its file name, then its extension. */
export function languageOf(path: string): Language | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const named = BY_NAME[name];
  if (named) return named;
  const dot = name.lastIndexOf('.');
  // A dotfile's name is not an extension (`.gitignore`).
  if (dot <= 0) return undefined;
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()];
}
