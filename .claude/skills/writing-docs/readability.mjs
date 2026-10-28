// Measures the prose of Markdown files: words a sentence, the sentences over a limit, sentences
// crowded with asides, possessives or colons, long paragraphs, and the outline of the headings.
// Code blocks, inline code, tables, link targets, HTML lines and front matter are not measured.
// Usage: node .claude/skills/writing-docs/readability.mjs <file.md | -> [more…] [--max 25]
//        [--top 15] [--outline]   ("-" reads stdin: git show main:README.md | node … -)

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const OUTLINE = take('--outline', 0) !== undefined;
const MAX = Number(take('--max', 1)?.[0] ?? 25);
const TOP = Number(take('--top', 1)?.[0] ?? 15);
const LONG_PARAGRAPH = 80;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const POSSESSIVE = /\b(?!(?:it|that|there|here|what|let)['’]s\b)[A-Za-z0-9]+['’]s\b|\bits\b/gi;
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|cf)\./gi;
const END = /[.!?]+["'”’)\]]*(?=\s|$)/g;
const MASKED_DOT = '․'; // stands for an abbreviation's dot, so it ends no sentence

/** Takes an option, and its values, out of the arguments. */
function take(name, values) {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  return args.splice(at, values + 1).slice(1);
}

function breaks(text) {
  return text.split('\n').length - 1;
}

/** Replaces a pattern but keeps its line breaks, so each cleaned line keeps its line number. */
function swap(text, pattern, by) {
  return text.replace(pattern, (match, inner) => {
    const kept = by(typeof inner === 'string' ? inner : '');
    return kept + '\n'.repeat(breaks(match) - breaks(kept));
  });
}

/** A paragraph without what is not prose: inline code becomes one word, a link its text. */
function clean(text) {
  let out = swap(text, /`+[^`]*`+/g, () => 'code');
  out = swap(out, /!\[[^\]]*\]\([^)]*\)/g, () => '');
  out = swap(out, /\[([^\]]*)\]\([^)]*\)/g, (inner) => inner);
  out = swap(out, /\[([^\]]*)\]\[[^\]]*\]/g, (inner) => inner);
  out = swap(out, /<[^>\n]*>/g, () => '');
  return out.replace(/https?:\/\/\S+/g, 'link').replace(/[*_~]+/g, '');
}

/** A Markdown text's paragraphs (each list item one) as numbered lines, and its headings. */
function read(text) {
  const lines = text.split(/\r?\n/);
  const paragraphs = [];
  const headings = [];
  const skipped = { tableRows: 0, codeBlocks: 0 };
  let current;
  let fence;
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }
  const close = () => {
    if (!current) return;
    const texts = clean(current.map((part) => part.text).join('\n')).split('\n');
    const parts = current.map((part, k) => ({ line: part.line, text: texts[k]?.trim() ?? '' }));
    paragraphs.push(parts);
    current = undefined;
  };
  const add = (line, part) => {
    current ??= [];
    current.push({ line, text: part });
  };
  for (; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim();
    const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (fence) {
      if (marker?.startsWith(fence)) fence = undefined;
      continue;
    }
    if (marker) {
      close();
      fence = marker;
      skipped.codeBlocks++;
      continue;
    }
    const quoted = trimmed.replace(/^(?:>\s?)+/, '');
    const heading = /^(#{1,6})\s+(.*)$/.exec(quoted);
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(quoted);
    if (!quoted || /^(?:-{3,}|\*{3,}|_{3,})$/.test(quoted) || quoted.startsWith('<')) {
      close();
    } else if (heading) {
      close();
      headings.push({ line: i + 1, level: heading[1].length, text: heading[2].trim() });
    } else if (quoted.startsWith('|')) {
      close();
      skipped.tableRows++;
    } else if (item) {
      close();
      add(i + 1, item[1]);
    } else {
      add(i + 1, quoted);
    }
  }
  close();
  return { paragraphs, headings, skipped };
}

function counts(sentence) {
  const inside = sentence.trim().replace(/[:;]$/, '');
  return {
    asides: sentence.split('(').length - 1,
    possessives: sentence.match(POSSESSIVE)?.length ?? 0,
    stops: inside.split(/[:;]/).length - 1,
  };
}

/** A paragraph's sentences, each with its first line, words, asides, possessives and stops. */
function sentences(parts) {
  let text = '';
  const starts = [];
  for (const part of parts) {
    starts.push({ line: part.line, at: text.length });
    text += `${part.text} `;
  }
  const masked = text.replace(ABBREVIATION, (match) => match.replaceAll('.', MASKED_DOT));
  const ends = [...masked.matchAll(END)].map((end) => end.index + end[0].length);
  ends.push(masked.length);
  const found = [];
  let from = 0;
  for (const to of ends) {
    const sentence = masked.slice(from, to);
    const words = sentence.match(WORD)?.length ?? 0;
    if (words > 0) {
      const at = from + sentence.length - sentence.trimStart().length;
      const line = starts.findLast((start) => start.at <= at)?.line ?? parts[0]?.line ?? 0;
      found.push({ line, words, text: sentence.trim(), ...counts(sentence) });
    }
    from = to;
  }
  return found;
}

function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

function preview(text) {
  const plain = text.replaceAll(MASKED_DOT, '.');
  return plain.length > 90 ? `${plain.slice(0, 89)}…` : plain;
}

function report(name, text) {
  const { paragraphs, headings, skipped } = read(text);
  const measured = paragraphs.map((parts) => sentences(parts));
  const all = measured.flat();
  const say = (line) => console.log(line);
  say(name);
  if (all.length === 0) {
    say('  no prose found');
    return;
  }
  const lengths = all.map((sentence) => sentence.words).sort((a, b) => a - b);
  const words = lengths.reduce((sum, count) => sum + count, 0);
  const over = all.filter((sentence) => sentence.words > MAX);
  const crowded = (key, least) => all.filter((sentence) => sentence[key] >= least).length;
  const total = (list) => list.reduce((sum, sentence) => sum + sentence.words, 0);
  const long = measured.filter((list) => total(list) > LONG_PARAGRAPH).length;
  const average = (words / all.length).toFixed(1);
  const share = Math.round((100 * over.length) / all.length);
  const median = quantile(lengths, 0.5);
  const p90 = quantile(lengths, 0.9);
  const n = (value) => value.toLocaleString('en-US');
  say(`  ${n(words)} words in ${n(all.length)} sentences: ${average} words a sentence`);
  say(`  median ${median}, 90th percentile ${p90}, longest ${lengths.at(-1) ?? 0}`);
  say(`  sentences over ${MAX} words: ${over.length} (${share} %)`);
  say(`  sentences with 2 or more asides in brackets: ${crowded('asides', 2)}`);
  say(`  sentences with 3 or more possessives (its, a name's): ${crowded('possessives', 3)}`);
  say(`  sentences with 2 or more colons or semicolons inside: ${crowded('stops', 2)}`);
  say(`  paragraphs or list items over ${LONG_PARAGRAPH} words: ${long}`);
  say(`  not measured: ${skipped.tableRows} table rows, ${skipped.codeBlocks} code blocks`);
  const longest = [...over].sort((a, b) => b.words - a.words).slice(0, TOP);
  if (longest.length > 0) say(`  longest sentences over ${MAX} words:`);
  for (const sentence of longest) {
    say(`    ${name}:${sentence.line}  ${sentence.words} words  ${preview(sentence.text)}`);
  }
  if (!OUTLINE) return;
  say('  outline:');
  for (const heading of headings) {
    say(`    ${'  '.repeat(heading.level - 1)}${heading.text}  (line ${heading.line})`);
  }
}

if (args.length === 0 || !(MAX > 0) || !(TOP > 0)) {
  console.error('Usage: readability.mjs <file.md | -> [more…] [--max 25] [--top 15] [--outline]');
  process.exit(1);
}
for (const file of args) {
  try {
    report(file === '-' ? 'stdin' : file, readFileSync(file === '-' ? 0 : file, 'utf8'));
  } catch (error) {
    console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
