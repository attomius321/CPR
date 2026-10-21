// E1 spike: how much of a real change could be verified instead of read? Mechanical parts are
// changed symbols whose code, token by token (Symbiote's normalization: no formatting or comments),
// is the old code with the change's own renames applied, or with only an argument list changed
// at a call to a symbol whose signature changed.
//
// Renames are inferred, but only from what the change renamed itself:
//   - a symbol Symbiote matched as moved under another name (old name → new name),
//   - a renamed file or folder (path words),
//   - a removed and an added symbol of the same kind whose code is equal once their name
//     difference (and renames found so far) is applied — `EbFallback` → `CatchFallback` gives
//     `Eb` → `Catch`, then `"eb-fallback"` → `"catch-fallback"` is that rename.
// A rename maps words of names (camelCase, kebab-case, path segments), case kept.
//
// Each changed symbol gets one class:
//   moved        moved or renamed with identical code (Symbiote's hashes)
//   renamed      a removed + added pair, or a moved symbol, equal under the renames
//   ripple       same symbol, every difference is a rename, an import path or an argument list;
//                `linked` when it references a renamed, moved or re-signed symbol
//   decision     everything else: what a reviewer must read
//
// Usage: node spikes/e1-ripples/measure.mjs --out <file.json> [--sets r1,bitwarden,qwik-docs]
//          [--recent 15]  also the latest N commits touching TS of ky, zod, vite, bitwarden, qwik
//          [--recent-repos ky,zod]  of these repos only
//          [--grep 'rename|move|refactor']  only commits whose subject matches (set `refactor`)
// Besides ripples, a decision repeated in the change is counted as `repeat`: a modified symbol
// whose edit (string and number values masked) is another's, or an added symbol shaped as
// another (its name and values masked). The first of each group stays a decision.
//          [--only <sha prefix>,…]
// Build Symbiote first; repos come from scripts/regression/setup.mjs.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const regressionDir = process.env.SYMBIOTE_REGRESSION_DIR ?? join(homedir(), '.cache', 'symbiote-regression');
const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    sets: { type: 'string', default: 'r1,bitwarden,qwik-docs' },
    recent: { type: 'string', default: '0' },
    'recent-repos': { type: 'string', default: 'ky,zod,vite,bitwarden,qwik' },
    /** With --recent: only commits whose message matches (as the `refactor` set). */
    grep: { type: 'string' },
    only: { type: 'string' },
  },
});
const load = (path) => import(pathToFileURL(join(root, path)).href);
const { analyzeGit, createTypescriptAdapter, isTestFile } = await load('packages/core/dist/index.js');
const { ts } = createRequire(join(root, 'packages/core/package.json'))('ts-morph');
const plugins = {
  angular: (await load('packages/plugin-angular/dist/index.js')).default,
  qwik: (await load('packages/plugin-qwik/dist/index.js')).default,
};
const config = JSON.parse(readFileSync(join(root, 'scripts/regression/sets.json'), 'utf8'));

const work = [];
for (const name of values.sets.split(',').filter(Boolean)) {
  const set = config.sets[name];
  for (const [repo, ...revs] of set.comparisons) {
    const [base, head] = revs.length === 1 ? [`${revs[0]}~1`, revs[0]] : revs;
    work.push([name, repo, base, head, set.plugins ?? []]);
  }
}
const recentPlugins = { bitwarden: ['angular'], qwik: ['qwik'] };
for (const repo of Number(values.recent) > 0 ? values['recent-repos'].split(',') : []) {
  // With --grep, commits whose subject line matches (the message body often mentions anything).
  const subject = values.grep ? new RegExp(values.grep, 'i') : undefined;
  const shas = execFileSync(
    'git',
    ['log', '--first-parent', '--no-merges', `-n${subject ? 3000 : values.recent}`, '--format=%h%x09%s', 'main', '--', '*.ts', '*.tsx'],
    { cwd: join(regressionDir, repo), encoding: 'utf8', maxBuffer: 1 << 26 },
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([, title]) => !subject || subject.test(title))
    .slice(0, Number(values.recent))
    .map(([sha]) => sha);
  for (const sha of shas) work.push([values.grep ? 'refactor' : 'recent', repo, `${sha}~1`, sha, recentPlugins[repo] ?? []]);
}
const only = values.only?.split(',').filter(Boolean);
const selected = only ? work.filter((w) => only.some((sha) => w[3].startsWith(sha))) : work;

// ---- tokens, from the AST as Symbiote's hashes ------------------------------------------------

const TS_FILE = /\.(m|c)?[jt]sx?$/;
const files = new Map();
function source(cwd, rev, file) {
  const key = `${cwd}\0${rev}\0${file}`;
  if (!files.has(key)) {
    let text = '';
    try {
      text = execFileSync('git', ['show', `${rev}:${file}`], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
    } catch {
      text = '';
    }
    const sf = TS_FILE.test(file)
      ? ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      : undefined;
    files.set(key, { text, sf, lines: text.split('\n') });
  }
  return files.get(key);
}

const DECLARATION = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ModuleDeclaration,
]);

/** Tokens ({t, kind}) of a declaration, normalized like Symbiote's `tokens()`. */
function declTokens(cwd, rev, decl, id) {
  const { sf, lines } = source(cwd, rev, decl.file);
  if (!sf) return wordTokens(slice(lines, decl.range));
  const out = [];
  if (id.endsWith('#(module)')) {
    // Top-level code: the statements that are not declarations of their own.
    for (const s of sf.statements) if (!DECLARATION.has(s.kind)) collect(s, sf, out);
    return out;
  }
  const start = sf.getPositionOfLineAndCharacter(decl.range.start.line - 1, decl.range.start.col - 1);
  const end = sf.getPositionOfLineAndCharacter(decl.range.end.line - 1, decl.range.end.col - 1);
  let node = sf;
  for (;;) {
    const child = node.getChildren(sf).find((c) => c.getStart(sf) <= start && c.end >= end);
    if (!child) break;
    node = child;
  }
  collect(node, sf, out);
  return out;
}

function collect(node, sf, out) {
  if (node.kind === ts.SyntaxKind.JSDoc || node.kind === ts.SyntaxKind.SemicolonClassElement) return;
  const children = node.getChildren(sf);
  if (children.length === 0) return leaf(node, sf, out);
  const last = children.length - 1;
  const arrow = ts.isArrowFunction(node);
  children.forEach((child, i) => {
    if (i === last && (child.kind === ts.SyntaxKind.SemicolonToken || child.kind === ts.SyntaxKind.CommaToken)) return;
    if (arrow && (child.kind === ts.SyntaxKind.OpenParenToken || child.kind === ts.SyntaxKind.CloseParenToken)) return;
    collect(child, sf, out);
  });
}

function leaf(node, sf, out) {
  switch (node.kind) {
    case ts.SyntaxKind.EndOfFileToken:
      return;
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      out.push({ t: JSON.stringify(node.text), kind: 'str' });
      return;
    case ts.SyntaxKind.JsxText: {
      const text = node.getText(sf).replace(/\s+/g, ' ').trim();
      if (text) out.push({ t: text, kind: 'str' });
      return;
    }
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.PrivateIdentifier:
      out.push({ t: node.getText(sf), kind: 'id' });
      return;
    case ts.SyntaxKind.TemplateHead:
    case ts.SyntaxKind.TemplateMiddle:
    case ts.SyntaxKind.TemplateTail:
      out.push({ t: node.getText(sf), kind: 'str' });
      return;
    default:
      out.push({ t: node.getText(sf), kind: 'punct' });
  }
}

/** Templates (`.html`, `.mdx`): words (with dashes) and punctuation; text counts as strings. */
function wordTokens(text) {
  return (text.match(/[A-Za-z_$][\w$-]*|\d+|\S/g) ?? []).map((t) => ({ t, kind: /^[A-Za-z_$]/.test(t) ? 'id' : 'punct' }));
}

function slice(lines, range) {
  const { start, end } = range;
  if (start.line === end.line) return (lines[start.line - 1] ?? '').slice(start.col - 1, end.col - 1);
  const parts = [(lines[start.line - 1] ?? '').slice(start.col - 1)];
  for (let l = start.line; l < end.line - 1; l++) parts.push(lines[l] ?? '');
  parts.push((lines[end.line - 1] ?? '').slice(0, end.col - 1));
  return parts.join('\n');
}

// ---- renames as word substitutions -------------------------------------------------------

const WORDS = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+|[^A-Za-z\d]+/g;
const words = (s) => s.match(WORDS) ?? [];
const isWord = (w) => /^[A-Za-z]/.test(w);

/** `OutOfOrderSuspenseRoot` → `OutOfOrderPendingRoot`: `suspense` → `Pending` (words, lower-cased
 * keys). */
function substitution(before, after) {
  const a = words(before);
  const b = words(after);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const from = a.slice(pre, a.length - suf).filter(isWord);
  const to = b.slice(pre, b.length - suf).filter(isWord);
  if (from.length === 0 || to.length === 0 || from.length > 3 || to.length > 3) return undefined;
  // `a` → `b` would rename every `a`: too short to be the change's own word.
  if (from.join('').length < 2) return undefined;
  if (a.slice(pre, a.length - suf).some((w) => !isWord(w)) || b.slice(pre, b.length - suf).some((w) => !isWord(w))) return undefined;
  return { from: from.map((w) => w.toLowerCase()), to };
}

const caseLike = (model, word) =>
  model === model.toUpperCase() && model.length > 1
    ? word.toUpperCase()
    : model[0] === model[0].toUpperCase()
      ? word[0].toUpperCase() + word.slice(1)
      : word.toLowerCase();

/**
 * A token's text with the change's renames applied, every way they apply: one change can
 * rename a word two ways (`errorBoundaryName` → `caughtErrorName`, `ErrorBoundary` → `Catch`).
 */
function renamings(text, subs) {
  if (subs.length === 0) return new Set([text]);
  const w = words(text);
  let partial = new Set(['']);
  let i = 0;
  // Positions are walked once; at each, every rename that matches (or none) extends the texts.
  const ends = new Map([[0, partial]]);
  for (i = 0; i < w.length; i++) {
    const here = ends.get(i);
    if (!here) continue;
    const next = (to, text2) => {
      const set = ends.get(to) ?? new Set();
      for (const p of here) if (set.size < 64) set.add(p + text2);
      ends.set(to, set);
    };
    next(i + 1, w[i]);
    for (const s of subs) {
      if (s.from.every((f, k) => w[i + k]?.toLowerCase() === f)) {
        next(i + s.from.length, s.to.map((t, k) => caseLike(w[i + Math.min(k, s.from.length - 1)], t)).join(''));
      }
    }
  }
  partial = ends.get(w.length) ?? new Set([text]);
  return partial;
}
const renamed = (text, subs) => [...renamings(text, subs)][0] ?? text;

const sameUnder = (a, b, subs) =>
  a.length === b.length &&
  a.every((tok, k) => tok.t === b[k].t || (tok.kind !== 'punct' && renamings(tok.t, subs).has(b[k].t)));

// ---- token diff --------------------------------------------------------------------------

/** Differing stretches of two token lists: [aStart, aEnd, bStart, bEnd), after a LCS. */
function hunks(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre].t === b[pre].t) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf].t === b[b.length - 1 - suf].t) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  if (A.length === 0 && B.length === 0) return [];
  if (A.length * B.length > 4_000_000) return null;
  const n = A.length;
  const m = B.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = A[i].t === B[j].t ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  let open = null;
  const close = () => {
    if (open) out.push([open[0] + pre, i + pre, open[1] + pre, j + pre]);
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && A[i].t === B[j].t) {
      close();
      i++;
      j++;
    } else {
      open ??= [i, j];
      if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) i++;
      else j++;
    }
  }
  close();
  return out;
}

const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set([')', ']', '}']);
/** The callee name of the call whose argument list holds tokens [start, end), if any. */
function enclosingCall(tokens, start, end) {
  let depth = 0;
  for (let k = start; k < end; k++) {
    if (OPEN[tokens[k].t]) depth++;
    else if (CLOSE.has(tokens[k].t)) depth--;
    if (depth < 0) return undefined;
  }
  if (depth !== 0) return undefined;
  depth = 0;
  for (let k = start - 1; k >= 0; k--) {
    const t = tokens[k].t;
    if (CLOSE.has(t)) depth++;
    else if (OPEN[t]) {
      if (depth > 0) depth--;
      else if (t === '(') {
        let p = k - 1;
        if (tokens[p]?.t === '>') {
          let angle = 0;
          for (; p >= 0; p--) {
            if (tokens[p].t === '>') angle++;
            else if (tokens[p].t === '<' && --angle === 0) break;
          }
          p--;
        }
        return tokens[p]?.kind === 'id' ? tokens[p].t : undefined;
      } else return undefined;
    }
  }
  return undefined;
}

// ---- per comparison ----------------------------------------------------------------------

/** Tokens with string and number values masked: the shape of an edit, not its values. */
const mask = (tokens) =>
  tokens.map((tok) => (tok.kind === 'str' ? '"…"' : /^\d/.test(tok.t) ? '0' : tok.t));

const linesOf = (decl) => (decl ? decl.range.end.line - decl.range.start.line + 1 : 0);

/** Lines a line diff shows for two texts: removed plus added (as GitHub counts them). */
function diffLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  if (A.length * B.length > 4_000_000) return A.length + B.length;
  const lcs = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  return A.length + B.length - 2 * lcs[0][0];
}
const lastName = (id) => id.slice(id.lastIndexOf('#') + 1).split('.').pop();
const calleeName = (decl) => (decl.kind === 'constructor' && decl.container ? lastName(decl.container) : decl.name);

const adapters = new Map();
const runs = [];
for (const [set, repo, base, head, pluginNames] of selected) {
  const cwd = join(regressionDir, repo);
  const key = pluginNames.join(',');
  if (!adapters.has(key)) adapters.set(key, createTypescriptAdapter({ plugins: pluginNames.map((p) => plugins[p]) }));
  const started = performance.now();
  const run = { set, repo, base, head };
  try {
    const analysis = await analyzeGit({ cwd, base, head, mergeBase: false, adapter: adapters.get(key) });
    const B = analysis.revisions.base.sha ?? base;
    const H = analysis.revisions.head.sha ?? head;
    const changes = analysis.changes.filter((c) => c.status !== 'unchanged');
    const toks = new Map();
    const tokensOf = (c, side) => {
      const k = `${side}:${c.id}:${c.previousId ?? ''}`;
      if (!toks.has(k)) toks.set(k, declTokens(cwd, side === 'base' ? B : H, c[side], side === 'base' ? (c.previousId ?? c.id) : c.id));
      return toks.get(k);
    };

    // Renames the change made: moved symbols with a new name, renamed files and folders.
    const subs = [];
    const addSub = (s, why) => {
      if (s && !subs.some((x) => x.from.join() === s.from.join() && x.to.join() === s.to.join())) subs.push({ ...s, why });
    };
    for (const c of changes) {
      if (c.status === 'modified' && c.previousId && c.base && c.head && c.base.name !== c.head.name) {
        addSub(substitution(c.base.name, c.head.name), `symbol ${c.base.name}`);
      }
    }
    for (const f of analysis.files) {
      if (f.status !== 'renamed' || !f.previousPath) continue;
      const a = f.previousPath.split('/');
      const b = f.path.split('/');
      if (a.length === b.length) a.forEach((seg, i) => seg !== b[i] && addSub(substitution(seg.replace(/\.[^.]*$/, ''), b[i].replace(/\.[^.]*$/, '')), `file ${f.previousPath}`));
    }

    // Removed + added pairs, equal under their own name difference and the renames so far.
    const removed = changes.filter((c) => c.status === 'removed' && c.base);
    const added = changes.filter((c) => c.status === 'added' && c.head);
    const paired = new Map(); // added id → removed id
    for (let round = 0, found = true; found && round < 5; round++) {
      found = false;
      for (const a of added) {
        if (paired.has(a.id)) continue;
        for (const r of removed) {
          if ([...paired.values()].includes(r.id) || r.base.kind !== a.head.kind) continue;
          // Tiny code (`const A = 1`) proves nothing.
          if (tokensOf(r, 'base').length < 12) continue;
          const own = r.base.name === a.head.name ? undefined : substitution(r.base.name, a.head.name);
          if (r.base.name !== a.head.name && !own) continue;
          const trial = own ? [own, ...subs] : subs;
          if (!sameUnder(tokensOf(r, 'base'), tokensOf(a, 'head'), trial)) continue;
          paired.set(a.id, r.id);
          if (own) addSub(own, `pair ${r.base.name}`);
          found = true;
          break;
        }
      }
    }
    const pairedRemoved = new Set(paired.values());

    // What a ripple may reference: renamed, moved, paired or re-signed symbols.
    const roots = new Set();
    const callees = new Set();
    for (const c of changes) {
      if (c.previousId || paired.has(c.id) || pairedRemoved.has(c.id)) roots.add(c.id);
      if (c.previousId) roots.add(c.previousId);
      if (c.status === 'modified' && c.delta?.signature && c.base && c.head) {
        roots.add(c.id);
        callees.add(calleeName(c.head));
        callees.add(calleeName(c.base));
      }
    }
    const linked = new Set(analysis.edges.filter((e) => roots.has(e.to)).map((e) => e.from));

    const symbols = [];
    for (const c of changes) {
      const decl = c.head ?? c.base;
      const text = (side) => slice(source(cwd, side === 'base' ? B : H, c[side].file).lines, c[side].range);
      const entry = {
        id: c.id,
        status: c.status,
        lines: Math.max(linesOf(c.base), linesOf(c.head)),
        // Lines a diff shows: all of an added or removed symbol, the changed lines of the rest.
        diff: c.base && c.head ? diffLines(text('base'), text('head')) : c.head ? linesOf(c.head) : linesOf(c.base),
        test: isTestFile(decl.file),
        at: {
          ...(c.base ? { base: [B, c.base.file, c.base.range.start.line, c.base.range.end.line] } : {}),
          ...(c.head ? { head: [H, c.head.file, c.head.range.start.line, c.head.range.end.line] } : {}),
        },
      };
      symbols.push(entry);
      if (paired.has(c.id) || pairedRemoved.has(c.id)) {
        entry.class = 'renamed';
        // One diff, as for a renamed file: the removed half shows nothing of its own.
        const r = changes.find((x) => x.id === paired.get(c.id));
        entry.diff = r ? diffLines(slice(source(cwd, B, r.base.file).lines, r.base.range), text('head')) : 0;
        if (r) entry.at.base = [B, r.base.file, r.base.range.start.line, r.base.range.end.line];
        continue;
      }
      if (c.status !== 'modified' || !c.base || !c.head) {
        entry.class = 'decision';
        if (c.status === 'added') {
          const own = c.head.name;
          const toks = tokensOf(c, 'head');
          if (toks.length >= 12) entry.shape = JSON.stringify(mask(toks.map((tok) => (tok.t === own ? { t: '<name>', kind: 'id' } : tok))));
        }
        continue;
      }
      if (c.previousId && !c.delta?.signature && !c.delta?.body) {
        entry.class = 'moved';
        continue;
      }
      const before = tokensOf(c, 'base');
      const after = tokensOf(c, 'head');
      const diff = hunks(before, after);
      if (diff === null) {
        entry.class = 'decision';
        entry.why = 'too big to diff';
        continue;
      }
      const kinds = new Set();
      const args = [];
      let explained = diff.length > 0 || Boolean(c.previousId);
      for (const [a0, a1, b0, b1] of diff) {
        const A = before.slice(a0, a1);
        const Bt = after.slice(b0, b1);
        if (A.length > 0 && sameUnder(A, Bt, subs)) {
          kinds.add(A.some((tok, k) => tok.t !== Bt[k].t && tok.kind === 'str') ? 'rename-in-text' : 'rename');
          continue;
        }
        const callee = (Bt.length ? enclosingCall(after, b0, b1) : undefined) ?? (A.length ? enclosingCall(before, a0, a1) : undefined);
        if (callee && [...renamings(callee, subs)].some((name) => callees.has(name))) {
          kinds.add('argument');
          args.push(Bt.map((tok) => tok.t).join(' '));
          continue;
        }
        explained = false;
        entry.hunk = `${A.map((tok) => tok.t).join(' ').slice(0, 100)}  →  ${Bt.map((tok) => tok.t).join(' ').slice(0, 100)}`;
        break;
      }
      if (!explained) {
        entry.class = 'decision';
        const shape = diff.map(([a0, a1, b0, b1]) => [mask(before.slice(a0, a1)), mask(after.slice(b0, b1))]);
        if (shape.flat(2).length >= 3) entry.edit = JSON.stringify(shape);
        continue;
      }
      entry.class = c.previousId ? 'renamed' : 'ripple';
      entry.kinds = [...kinds];
      entry.linked = linked.has(c.id) || linked.has(c.previousId ?? '');
      if (args.length) entry.args = args;
    }
    // The same edit, or the same new code, again: read once, the rest by their values.
    const firstOf = new Map();
    for (const entry of symbols) {
      const key = entry.edit ? `edit:${entry.edit}` : entry.shape ? `new:${entry.shape}` : undefined;
      if (!key) continue;
      if (!firstOf.has(key)) firstOf.set(key, entry.id);
      else {
        entry.class = 'repeat';
        entry.like = firstOf.get(key);
        entry.kinds = [entry.edit ? 'edit' : 'added'];
      }
    }
    for (const entry of symbols) {
      delete entry.edit;
      delete entry.shape;
    }
    Object.assign(run, { subs: subs.map((s) => `${s.from.join(' ')} → ${s.to.join('')} (${s.why})`), symbols });
  } catch (error) {
    run.error = String(error?.stack ?? error).slice(0, 400);
  }
  run.ms = Math.round(performance.now() - started);
  runs.push(run);
  const count = (cls) => run.symbols?.filter((s) => s.class === cls).length ?? 0;
  console.error(
    `${set} ${repo} ${head}: ${run.error ? `ERROR ${run.error.split('\n')[0]}` : `${run.symbols.length} changed: ${count('decision')} decisions, ${count('moved')} moved, ${count('renamed')} renamed, ${count('ripple')} ripples`} (${run.ms} ms)`,
  );
}
writeFileSync(values.out, JSON.stringify({ runs }));
console.error(`wrote ${values.out}`);
