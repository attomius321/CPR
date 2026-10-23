// The Skills page (V41): pure helpers for the list, the editor and its checks. The skills come from
// `symbiote view` (`/api/skills`); the checks run here, as the person types (decision 274): only
// what the open standard, Anthropic's API or an agent would refuse, or a limit passed.
import type { FileGitState, Skill, SkillFolder, SkillsState } from '@symbiote/core';

/**
 * A frontmatter value as Symbiote's small YAML reader takes it: text (plain, quoted or a block),
 * `other` (a list, a map, nothing), `invalid` (YAML refuses it), or `unknown` (an anchor, an alias
 * or a tag: YAML Symbiote does not take apart).
 */
export type FieldValue =
  | { kind: 'text'; value: string; line: number }
  | { kind: 'other'; line: number }
  | { kind: 'invalid'; why: string; line: number }
  | { kind: 'unknown'; why: string; line: number };

/** A `SKILL.md` read: its frontmatter (`none`: no `---` first; `open`: no `---` after), its body. */
export interface ReadSkill {
  frontmatter: { fields: Map<string, FieldValue> } | 'none' | 'open';
  body: string;
  /** The body's first line, 1-based. */
  bodyLine: number;
}

const indentOf = (line: string) => line.length - line.trimStart().length;
const isBlank = (line: string) => line.trim() === '';
/** A map's key at the start of a line: `name:` or `name: value`. */
const KEY = /^([^\s:#-][^:]*?):(?:[ \t]+(.*))?$/;

/** Reads a `SKILL.md`: the frontmatter between its first two `---` lines, and the body after. */
export function readSkill(text: string): ReadSkill {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trimEnd() !== '---') {
    return { frontmatter: 'none', body: lines.join('\n'), bodyLine: 1 };
  }
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  if (end < 0) return { frontmatter: 'open', body: '', bodyLine: lines.length + 1 };
  return {
    frontmatter: { fields: readFields(lines.slice(1, end), 2) },
    body: lines.slice(end + 1).join('\n'),
    bodyLine: end + 2,
  };
}

/** The top-level keys of a frontmatter's lines (`first`: the first one's line number). */
function readFields(lines: string[], first: number): Map<string, FieldValue> {
  const fields = new Map<string, FieldValue>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const key = indentOf(line) === 0 && !line.startsWith('#') ? KEY.exec(line) : null;
    let next = i + 1;
    while (next < lines.length && (isBlank(lines[next] ?? '') || indentOf(lines[next] ?? '') > 0)) {
      next++;
    }
    if (key?.[1]) {
      const more = lines.slice(i + 1, next);
      while (more.length > 0 && isBlank(more.at(-1) ?? '')) more.pop();
      fields.set(key[1].trim(), valueOf((key[2] ?? '').trim(), more, first + i));
    }
    i = next;
  }
  return fields;
}

/** A value: what follows its key on the line (`rest`), and the lines indented under it. */
function valueOf(rest: string, more: string[], line: number): FieldValue {
  const invalid = (why: string): FieldValue => ({ kind: 'invalid', why, line });
  const text = (value: string): FieldValue => ({ kind: 'text', value, line });
  if (rest === '' || rest.startsWith('#')) {
    const firstMore = more.find((l) => !isBlank(l))?.trim();
    if (firstMore === undefined) return { kind: 'other', line };
    if (firstMore === '-' || firstMore.startsWith('- ') || KEY.test(firstMore)) {
      return { kind: 'other', line };
    }
    return plain(more, line);
  }
  const head = rest[0] ?? '';
  if (head === '|' || head === '>') return block(rest, more, line);
  if (head === '"' || head === "'") return quoted(rest, more, line);
  if (head === '[' || head === '{') return { kind: 'other', line };
  if (head === '&' || head === '*' || head === '!') {
    return { kind: 'unknown', why: 'an anchor, an alias or a tag', line };
  }
  if ('@`%'.includes(head)) return invalid(`YAML keeps ${head} for itself at a value's start`);
  if (rest === '-' || rest.startsWith('- ') || rest.startsWith('? ') || rest.startsWith(': ')) {
    return invalid('a plain value cannot start with "- ", "? " or ": "');
  }
  const value = plain([rest, ...more], line);
  return value.kind === 'text' ? text(value.value) : value;
}

/** Plain text: lines folded into one (a blank line is a line break), a ` #` comment dropped. */
function plain(lines: string[], line: number): FieldValue {
  const parts: string[] = [];
  for (const raw of lines) {
    const at = raw.search(/(^|\s)#/);
    const words = (at < 0 ? raw : raw.slice(0, at)).trim();
    if (words.includes(': ') || words.endsWith(':')) {
      return { kind: 'invalid', why: 'a plain value cannot hold ": "', line };
    }
    parts.push(words);
  }
  let value = '';
  for (const part of parts) {
    if (part === '') value += '\n';
    else value += value === '' || value.endsWith('\n') ? part : ` ${part}`;
  }
  return { kind: 'text', value: value.trim(), line };
}

/** A block: `|` keeps its line breaks, `>` folds them; `-` drops the last one, `+` keeps more. */
function block(header: string, more: string[], line: number): FieldValue {
  const match = /^([|>])([1-9]?)([+-]?)([1-9]?)\s*(#.*)?$/.exec(header);
  if (!match) return { kind: 'invalid', why: `"${header}" does not start a block`, line };
  const [, style, , chomp] = match;
  const indent = Math.min(...more.filter((l) => !isBlank(l)).map(indentOf), Infinity);
  const lines = more.map((l) => (isBlank(l) ? '' : l.slice(indent === Infinity ? 0 : indent)));
  let value: string;
  if (style === '|') value = lines.join('\n');
  else {
    value = '';
    for (const part of lines) {
      if (part === '') value += '\n';
      else value += value === '' || value.endsWith('\n') ? part : ` ${part}`;
    }
  }
  if (value !== '' && chomp !== '-') value += '\n';
  return { kind: 'text', value, line };
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '0': '\0',
  '"': '"',
  '\\': '\\',
  '/': '/',
  ' ': ' ',
  e: '\x1b',
};

/** A quoted value, over lines if it goes on: `"…"` with its escapes, `'…'` with `''`. */
function quoted(rest: string, more: string[], line: number): FieldValue {
  const source = [rest, ...more.map((l) => l.trim())].join('\n');
  const quote = source[0];
  let value = '';
  let i = 1;
  for (;;) {
    const c = source[i];
    if (c === undefined) return { kind: 'invalid', why: 'a quote not closed', line };
    if (quote === "'" && c === "'") {
      if (source[i + 1] === "'") {
        value += "'";
        i += 2;
        continue;
      }
      break;
    }
    if (quote === '"' && c === '"') break;
    if (quote === '"' && c === '\\') {
      const e = source[i + 1] ?? '';
      const hex = { x: 2, u: 4, U: 8 }[e];
      if (hex) {
        const code = Number.parseInt(source.slice(i + 2, i + 2 + hex), 16);
        if (Number.isNaN(code)) return { kind: 'invalid', why: `\\${e} without its digits`, line };
        value += String.fromCodePoint(code);
        i += 2 + hex;
      } else if (e === '\n') {
        i += 2;
      } else if (e in ESCAPES) {
        value += ESCAPES[e];
        i += 2;
      } else return { kind: 'invalid', why: `\\${e} is not an escape YAML knows`, line };
      continue;
    }
    if (c === '\n') {
      // A line break inside quotes folds into a space; an empty line is a line break.
      let blank = 0;
      while (source[i + 1] === '\n') {
        blank++;
        i++;
      }
      value += blank > 0 ? '\n'.repeat(blank) : ' ';
      i++;
      continue;
    }
    value += c;
    i++;
  }
  const after = source.slice(i + 1).trim();
  if (after !== '' && !after.startsWith('#')) {
    return { kind: 'invalid', why: 'text after the closing quote', line };
  }
  return { kind: 'text', value, line };
}

/** What the Skills page says of a skill. */
export interface SkillCheck {
  /** `error`: no agent would read it as meant; `warning`: one refuses it, or a limit is passed. */
  level: 'error' | 'warning' | 'note';
  text: string;
}

/** The standard's limits (agentskills.io), and Claude Code's cut in its list of skills. */
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const CLAUDE_CUT = 1536;
const MAX_LINES = 500;
const n = (value: number) => value.toLocaleString('en-US');

/** What is wrong with a skill's name, as the standard has it (as `symbiote view` checks it). */
export function skillNameProblem(name: string): string | null {
  if (name === '') return 'a name cannot be empty';
  if (name.length > MAX_NAME) return `a name is at most ${MAX_NAME} characters`;
  if (!/^[a-z0-9-]+$/.test(name)) return 'a name holds only lowercase letters, digits and hyphens';
  if (name.startsWith('-') || name.endsWith('-')) return 'a name cannot start or end with a hyphen';
  if (name.includes('--')) return 'a name cannot hold two hyphens in a row';
  return null;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * What the page says of `text` as the `SKILL.md` of the skill in folder `name`, with `files`
 * beside it: errors first, then the name, the description, the body and its links.
 */
export function skillChecks(
  skill: { name: string; files: readonly string[] },
  text: string,
): SkillCheck[] {
  const read = readSkill(text);
  if (read.frontmatter === 'none') {
    return [
      {
        level: 'error',
        text:
          'No frontmatter: the file starts with a line ---, then name: and description:, and ' +
          'another ---. Without it no agent has a description to pick the skill by.',
      },
    ];
  }
  if (read.frontmatter === 'open') {
    return [
      {
        level: 'error',
        text: 'The frontmatter is not closed: a line --- ends it. Until then no agent reads its name or description.',
      },
    ];
  }
  const { fields } = read.frontmatter;
  const checks: SkillCheck[] = [];
  for (const [key, value] of fields) {
    if (value.kind === 'invalid') {
      checks.push({
        level: 'error',
        text:
          `YAML cannot read ${key} (line ${value.line}): ${value.why}; quote it. Claude Code ` +
          'would then load the skill with no name or description.',
      });
    }
  }
  const textOf = (key: string): string | undefined => {
    const value = fields.get(key);
    return value?.kind === 'text' ? value.value : undefined;
  };
  for (const key of ['name', 'description']) {
    const value = fields.get(key);
    if (value?.kind === 'unknown') {
      checks.push({
        level: 'note',
        text: `Symbiote does not read ${key} (${value.why}): not checked.`,
      });
    }
  }

  const name = fields.get('name');
  if (!name) {
    checks.push({
      level: 'warning',
      text: `No name: Claude Code takes the folder's (${skill.name}); Codex and the standard need one.`,
    });
  } else if (name.kind === 'text') {
    const problem = skillNameProblem(name.value);
    if (problem) checks.push({ level: 'warning', text: `${capital(problem)} (the standard).` });
    if (name.value !== skill.name) {
      checks.push({
        level: 'warning',
        text: `The name is ${name.value}, its folder is ${skill.name}: the standard wants them the same.`,
      });
    }
    if (/claude|anthropic/.test(name.value)) {
      checks.push({
        level: 'warning',
        text: 'A name holding "claude" or "anthropic" is refused by Anthropic\'s API and claude.ai; Claude Code and Codex take it.',
      });
    }
  }

  const description = textOf('description');
  if (description === undefined || description.trim() === '') {
    if (
      fields.get('description')?.kind !== 'invalid' &&
      fields.get('description')?.kind !== 'unknown'
    ) {
      checks.push({
        level: 'warning',
        text:
          "No description: it is how an agent picks the skill. Claude Code uses the body's first " +
          'line; Codex and the standard need one.',
      });
    }
  } else {
    if (description.length > MAX_DESCRIPTION) {
      checks.push({
        level: 'warning',
        text: `The description is ${n(description.length)} characters: the standard takes ${n(MAX_DESCRIPTION)} at most.`,
      });
    }
    const listed = description.length + (textOf('when_to_use')?.length ?? 0);
    if (listed > CLAUDE_CUT) {
      checks.push({
        level: 'warning',
        text: `Claude Code cuts the description at ${n(CLAUDE_CUT)} characters in its list of skills (${n(listed)}).`,
      });
    }
    if (/[<>]/.test(description)) {
      checks.push({
        level: 'warning',
        text: "The description holds < or >: Anthropic's API and claude.ai refuse it; Claude Code and Codex take it.",
      });
    }
  }

  const body = read.body.replace(/\n$/, '');
  if (body.trim() === '') {
    checks.push({
      level: 'warning',
      text: 'No instructions after the frontmatter: the skill gives an agent nothing when it is picked.',
    });
  } else {
    const lines = body.split('\n').length;
    if (lines > MAX_LINES) {
      checks.push({
        level: 'warning',
        text: `The body is ${n(lines)} lines: keep it under ${MAX_LINES}, the detail in files it links to.`,
      });
    }
  }
  for (const target of missingLinks(read.body, skill.files)) {
    checks.push({
      level: 'warning',
      text: `Links to ${target}, which is not in the skill’s folder.`,
    });
  }
  return [
    ...checks.filter((c) => c.level === 'error'),
    ...checks.filter((c) => c.level !== 'error'),
  ];
}

/**
 * The body's links to files of the skill's own folder that are not there: Markdown links outside
 * code, neither web addresses, anchors, absolute paths nor paths that leave the folder (`..`).
 */
function missingLinks(body: string, files: readonly string[]): string[] {
  const have = new Set(['SKILL.md', ...files]);
  const missing: string[] = [];
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker[0] ?? null;
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const prose = line.replace(/`[^`]*`/g, '');
    for (const link of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = link[1] ?? '';
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || /^[#/$]/.test(target) || target.includes('{')) {
        continue;
      }
      let path = target.replace(/[#?].*$/, '').replace(/^\.\//, '');
      try {
        path = decodeURIComponent(path);
      } catch {
        // Kept as written.
      }
      if (path === '' || path.split('/').includes('..') || have.has(path)) continue;
      if (!missing.includes(path)) missing.push(path);
    }
  }
  return missing;
}

/** What the server would refuse of a new skill (as `symbiote view` checks it); null when nothing. */
export function newSkillProblem(
  name: string,
  description: string,
  taken: (name: string) => boolean,
): string | null {
  const problem = skillNameProblem(name);
  if (problem) return problem;
  if (name === 'synced' || name === 'anthropic-skills') {
    return `${name} is a folder Claude Code keeps for itself`;
  }
  if (taken(name)) return `.claude/skills/${name} is there already`;
  if (description.trim() === '') {
    return 'a description cannot be empty: it is how an agent finds the skill';
  }
  if (description.length > MAX_DESCRIPTION) {
    return `a description is at most ${n(MAX_DESCRIPTION)} characters`;
  }
  if (/[<>]/.test(description))
    return 'a description cannot hold < or >: the Claude API refuses them';
  return null;
}

/** What a skill's state in git means for it. */
export function skillGitNote(git: FileGitState): string {
  switch (git) {
    case 'new':
      return 'Not committed: commit it to share it with everyone who uses this repository.';
    case 'changed':
      return 'Changes not committed: commit them to share them.';
    case 'committed':
      return 'Shared: committed as it is.';
    case 'ignored':
      return 'Ignored by git here: it stays on this machine.';
    case 'none':
      return 'Not in git.';
  }
}

/** The skills by folder, in the server's order, each folder named with the agents that read it. */
export function skillGroups(
  state: SkillsState,
): { folder: SkillFolder; title: string; skills: Skill[] }[] {
  const groups: { folder: SkillFolder; title: string; skills: Skill[] }[] = [];
  for (const skill of state.skills) {
    const group = groups.find((g) => g.folder === skill.folder);
    if (group) {
      group.skills.push(skill);
      continue;
    }
    const agents =
      skill.folder === '.agents/skills'
        ? 'Codex'
        : state.codex.link === 'linked'
          ? 'Claude Code and Codex'
          : 'Claude Code';
    groups.push({ folder: skill.folder, title: `${skill.folder} · ${agents}`, skills: [skill] });
  }
  return groups;
}

/** Whether the draft would change the skill's text. */
export const isSkillEdited = (skill: Skill, draft: string | undefined): boolean =>
  draft !== undefined && draft !== skill.text;

/** `?skill=<path>`: the skill open, when there is one at that path; else the first. */
export function skillOfUrl(search: string, paths: readonly string[]): string | null {
  const asked = new URLSearchParams(search).get('skill');
  return paths.find((path) => path === asked) ?? paths[0] ?? null;
}

/** Lines, and about how many tokens (4 characters each). */
export function skillSize(text: string): string {
  const lines = text.replace(/\n$/, '').split('\n').length;
  return `${n(lines)} lines, about ${n(Math.ceil(text.length / 4))} tokens`;
}
