#!/usr/bin/env node
// Keeps the plans' decisions linked to what replaced them, and each area's plans to the page of
// what holds now (chore/living-docs, decisions 776–779). Plans stay as written but for what this
// script owns:
//
// - On a replaced decision's row, at the end of its question: `*(superseded by 82 of V17)*`, or
//   `*(partly superseded by 507 of V72)*`, from what the newer rows say they replace
//   (`supersedes 80`, `replaces 378, 446's centring`: a number with `'s …` or words after it is
//   replaced in part). A number two decisions share, or no decision has, is listed, not marked.
// - `docs/decisions.md`: every decision by area and plan, in the index's order, with its status.
// - For an area with a page in `docs/area/` (titled as the index's heading): a line under that
//   heading in `docs/PLAN.md`, and a banner under each of its plans' reference line.
//
//   node scripts/plan/consolidate.mjs            # lists what it would change; changes nothing
//   node scripts/plan/consolidate.mjs --write    # changes it; on `main`, with "Docs: merged"
//   node scripts/plan/consolidate.mjs --check    # exits 1 when something would change
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const write = args.includes('--write');
const check = args.includes('--check');

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const docs = join(root, 'docs');
const indexPath = join(docs, 'PLAN.md');
const registerPath = join(docs, 'decisions.md');

/** The marker this script writes on a replaced row, and only it. */
const MARKER = /\s*\*\((?:partly )?superseded by [^)]*\)\*/g;
/** The lines this script writes under an index heading and a plan's reference line. */
const INDEX_LINE = /^What holds now: \[/;
const BANNER = /^> What holds now: \[/;
/** A table cell boundary: a pipe not escaped. */
const PIPE = /(?<!\\)\|/g;

const read = (path) => readFileSync(path, 'utf8');
const lines = (text) => text.split('\n');

/** GitHub's anchor for a heading: lower case, punctuation out, spaces to hyphens. */
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');

/** The cells of a table row, without the outer pipes. */
function cells(line) {
  const parts = line.split(PIPE);
  return parts.slice(1, -1).map((c) => c.trim());
}

// --- The index: areas, their plans in order, and their pages ------------------------------------

const index = read(indexPath);
/** Areas in the index's order: `{ name, plans: [file] }`. */
const areas = [];
/** Plan file → `{ area, id }`, the first row that links it. */
const planOf = new Map();
{
  let inIndex = false;
  let area = null;
  for (const line of lines(index)) {
    if (/^## /.test(line)) inIndex = line.trim() === '## Index';
    if (!inIndex) continue;
    const heading = line.match(/^### (.+?)\s*$/);
    if (heading) {
      area = { name: heading[1], plans: [] };
      areas.push(area);
      continue;
    }
    if (!area || !line.startsWith('|')) continue;
    const first = cells(line)[0] ?? '';
    const link = first.match(/^\[([^\]]+)\]\(plan\/([^)#]+\.md)(?:#[^)]*)?\)/);
    if (!link || planOf.has(link[2])) continue;
    const id = /^[A-Z]{1,3}\d+[a-z]?$/.test(link[1]) ? link[1] : link[2].replace(/\.md$/, '');
    planOf.set(link[2], { area: area.name, id });
    area.plans.push(link[2]);
  }
}

/** Area name → its page's file in `docs/area/`. */
const pages = new Map();
const notes = [];
const areaDir = join(docs, 'area');
if (existsSync(areaDir)) {
  for (const file of readdirSync(areaDir)
    .filter((f) => f.endsWith('.md'))
    .sort()) {
    const title = read(join(areaDir, file)).match(/^# (.+?)\s*$/m)?.[1];
    if (title && areas.some((a) => a.name === title)) pages.set(title, file);
    else notes.push(`area/${file}: its title names no area of the index ("${title ?? ''}")`);
  }
}

// --- The decisions ------------------------------------------------------------------------------

const planFiles = readdirSync(join(docs, 'plan'))
  .filter((f) => f.endsWith('.md'))
  .sort();
/** A plan's name in a status: its index ID, else its file's name. */
const idOf = (file) => planOf.get(file)?.id ?? file.replace(/\.md$/, '');

/** Every decision row: `{ n, file, at (line index), line, question }`. */
const rows = [];
const texts = new Map();
for (const file of planFiles) {
  const text = read(join(docs, 'plan', file));
  texts.set(file, text);
  const all = lines(text);
  let inTable = false;
  for (let i = 0; i < all.length; i++) {
    const line = all[i];
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    // A decision table's head: `#` first, a `Decision` column, then the separator.
    if (!inTable && /^\|[\s|:-]+\|$/.test(all[i + 1] ?? '')) {
      const head = cells(line);
      inTable = head[0] === '#' && head.includes('Decision');
      i++;
      continue;
    }
    const n = inTable ? line.match(/^\| (\d+) \|/)?.[1] : null;
    if (!n) continue;
    rows.push({
      n: Number(n),
      file,
      at: i,
      line,
      question: (cells(line)[1] ?? '').replace(MARKER, '').trim(),
    });
  }
}
const byNumber = new Map();
for (const r of rows) byNumber.set(r.n, [...(byNumber.get(r.n) ?? []), r]);

/**
 * What a row says it replaces: after each `supersedes` or `replaces`, the list up to the end of
 * its clause; each item a number, replaced wholly when nothing follows it.
 */
function replaced(row) {
  const text = row.line.replace(MARKER, '');
  const found = [];
  for (const m of text.matchAll(/\b(?:supersedes|replaces)\b/gi)) {
    const rest = text.slice(m.index + m[0].length);
    const end = rest.search(/\||\(|\)|;|\*\*|\.\s|\.$/);
    const clause = end === -1 ? rest : rest.slice(0, end);
    for (const item of clause.trim().split(/,\s+|\s+and\s+/)) {
      const named = item.trim().match(/^(?:decisions?\s+)?(\d+)\b(.*)$/s);
      if (!named) break;
      found.push({ n: Number(named[1]), partly: named[2].trim() !== '' });
    }
  }
  return found;
}

/** Old row (by file and line) → `{ wholly: [row], partly: [row] }`. */
const statuses = new Map();
const key = (r) => `${r.file}:${r.at}`;
for (const row of rows) {
  const by = new Map();
  for (const ref of replaced(row)) {
    if (ref.n === row.n) continue;
    const olds = byNumber.get(ref.n) ?? [];
    const self = `${row.n} of ${idOf(row.file)}`;
    if (olds.length === 0) {
      notes.push(`${self}: no decision ${ref.n}`);
      continue;
    }
    if (olds.length > 1) {
      const where = olds.map((o) => idOf(o.file)).join(' and ');
      notes.push(`${self}: decision ${ref.n} is in ${where}: not marked`);
      continue;
    }
    // Named twice in one row: wholly wins.
    by.set(ref.n, (by.get(ref.n) ?? true) && ref.partly);
  }
  for (const [n, partly] of by) {
    const old = byNumber.get(n)[0];
    const status = statuses.get(key(old)) ?? { wholly: [], partly: [] };
    status[partly ? 'partly' : 'wholly'].push(row);
    statuses.set(key(old), status);
  }
}

/** "82 of V17", "689 and 690 of HV1, 700 of V9": by plan, in number order. */
function named(list) {
  const groups = new Map();
  for (const r of [...list].sort((a, b) => a.n - b.n)) {
    const id = idOf(r.file);
    groups.set(id, [...(groups.get(id) ?? []), r.n]);
  }
  return [...groups]
    .map(
      ([id, ns]) =>
        `${ns.length > 1 ? `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}` : ns[0]} of ${id}`,
    )
    .join(', ');
}

/** A row's status in words, or null when in force. */
function statusOf(row) {
  const s = statuses.get(key(row));
  if (!s) return null;
  if (s.wholly.length && s.partly.length)
    return `superseded by ${named(s.wholly)}; partly by ${named(s.partly)}`;
  return s.wholly.length
    ? `superseded by ${named(s.wholly)}`
    : `partly superseded by ${named(s.partly)}`;
}

// --- The changes ----------------------------------------------------------------------------------

/** Path → new text, for every file that changes. */
const changes = new Map();
const marks = [];

/** A row with its question's marker as the status says. */
function marked(row, status) {
  const cuts = [...row.line.matchAll(PIPE)].map((m) => m.index);
  const [, start, end] = cuts;
  const cell = row.line.slice(start + 1, end);
  // A row this script never marked keeps its spacing.
  if (!status && cell.replace(MARKER, '') === cell) return row.line;
  const question = cell.replace(MARKER, '').trimEnd();
  return `${row.line.slice(0, start + 1)}${question}${status ? ` *(${status})*` : ''} ${row.line.slice(end)}`;
}

for (const file of planFiles) {
  const all = lines(texts.get(file));
  for (const row of rows.filter((r) => r.file === file)) {
    const status = statusOf(row);
    const next = marked(row, status);
    if (next !== row.line) {
      all[row.at] = next;
      if (status) marks.push(`mark  ${row.n}  ${status}`);
      else marks.push(`clear ${row.n} of ${idOf(file)}`);
    }
  }
  // The banner: under the reference line, for a plan of an area with a page; written again each
  // run, so a page that goes takes its banners with it.
  const area = planOf.get(file)?.area;
  const page = area ? pages.get(area) : undefined;
  const at = all.findIndex((l, i) => i < 8 && BANNER.test(l));
  if (at !== -1) all.splice(at, all[at + 1] === '' ? 2 : 1);
  if (page) {
    const banner = `> What holds now: [${area}](../area/${page}). This plan is kept as it was written.`;
    const ref = all.findIndex((l, i) => i < 8 && l.startsWith('[Index]('));
    const r = ref === -1 ? 0 : ref;
    if (all[r + 1] === '') all.splice(r + 2, 0, banner, '');
    else all.splice(r + 1, 0, '', banner, '');
  }
  const next = all.join('\n');
  if (next !== texts.get(file)) changes.set(join(docs, 'plan', file), next);
}

// The index: a line under each heading of an area with a page.
{
  const all = lines(index);
  // What this script wrote before goes first: a heading, a blank line, its line.
  const clean = all.filter(
    (line, i) =>
      !(INDEX_LINE.test(line) && all[i - 1] === '' && /^### /.test(all[i - 2] ?? '')) &&
      !(line === '' && INDEX_LINE.test(all[i - 1] ?? '') && /^### /.test(all[i - 3] ?? '')),
  );
  const out = [];
  for (const line of clean) {
    out.push(line);
    const heading = line.match(/^### (.+?)\s*$/);
    const page = heading ? pages.get(heading[1]) : undefined;
    if (page) {
      out.push(
        '',
        `What holds now: [${heading[1]}](area/${page}) · its decisions: [the register](decisions.md#${slug(heading[1])}).`,
      );
    }
  }
  const next = out.join('\n');
  if (next !== index) changes.set(indexPath, next);
}

// The register.
{
  const distinct = new Set(rows.map((r) => r.n)).size;
  const out = [
    '# Decisions',
    '',
    '[Index](PLAN.md)',
    '',
    "Every decision of the plans, by area and plan in the index's order: its number, its question,",
    'and whether a later decision replaced it. The decision and why are in its plan, kept as',
    "written; what holds now is in the area's page (`area/`). Generated by",
    '`scripts/plan/consolidate.mjs --write`: do not edit it by hand.',
    '',
    `${distinct} decisions, ${rows.length} rows (a number two plans used is listed twice).`,
  ];
  /** A question's links, written from `plan/<file>`, as seen from `docs/`. */
  const rebased = (text, file) =>
    text.replace(/\]\(([^)\s]+)\)/g, (link, target) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) return link;
      if (target.startsWith('#')) return `](plan/${file}${target})`;
      if (target.startsWith('../')) return `](${target.slice(3)})`;
      return `](plan/${target})`;
    });
  const table = (files) => {
    const listed = files.flatMap((f) => rows.filter((r) => r.file === f));
    if (listed.length === 0) return [];
    return [
      '',
      '| # | Question | Status | Plan |',
      '|---|---|---|---|',
      ...listed.map(
        (r) =>
          `| ${r.n} | ${rebased(r.question, r.file)} | ${statusOf(r) ?? 'in force'} | [${idOf(r.file)}](plan/${r.file}) |`,
      ),
    ];
  };
  for (const area of areas) {
    const body = table(area.plans);
    if (body.length === 0) continue;
    out.push('', `## ${area.name}`);
    const page = pages.get(area.name);
    if (page) out.push('', `What holds now: [${area.name}](area/${page}).`);
    out.push(...body);
  }
  const outside = table(planFiles.filter((f) => !planOf.has(f)));
  if (outside.length) out.push('', '## Not in the index', ...outside);
  const next = `${out.join('\n')}\n`;
  if (!existsSync(registerPath) || read(registerPath) !== next) changes.set(registerPath, next);
}

// --- Report ---------------------------------------------------------------------------------------

for (const line of marks) console.log(line);
for (const path of changes.keys())
  console.log(`${write ? 'wrote' : 'would write'}  ${path.slice(root.length + 1)}`);
for (const note of notes) console.log(`note  ${note}`);
if (changes.size === 0) console.log('Nothing to change.');
if (write) for (const [path, text] of changes) writeFileSync(path, text);
if (check && changes.size > 0) process.exit(1);
