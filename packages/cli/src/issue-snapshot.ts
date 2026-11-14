// The issue as the classifier reads it (HV9b, decision 1001): its title, its author's role, its
// labels, its body and the comments of the project's members and of its author (1043, 1044),
// cleaned as the Issues page cleans them (IS1, decision 949), at most 20,000 characters, hashed.
// Anyone can write an issue: Symbiote's own message tags are removed from it, and what the forge
// would not show (HTML comments, scripts, zero-width and bidirectional characters) is dropped
// and flagged.
import { createHash } from 'node:crypto';
import type {
  Issue,
  IssueAuthor,
  IssueComment,
  IssueSnapshot,
  IssueSnapshotFlag,
} from '@symbiote/core';

/** The longest text the classifier reads (decision 1001): longer is cut and flagged. */
export const MAX_ISSUE = 20_000;

/** Roles of a project's members (GitHub's `OWNER`, `MEMBER`, `COLLABORATOR`; GitLab's levels). */
const MEMBER_ROLES = new Set(['owner', 'maintainer', 'member', 'collaborator']);
/** GitLab's Developer access level: below it (guest, reporter), someone is not a member (1043). */
const DEVELOPER = 30;

/** Whether `author` is one of the project's members. */
export function isMember(author: IssueAuthor, forge: Issue['forge']): boolean {
  if (forge === 'gitlab') return (author.level ?? 0) >= DEVELOPER;
  return author.role !== undefined && MEMBER_ROLES.has(author.role);
}

const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const WHOLE = /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const IMG = /<img\b[^>]*>/gi;
const TAG = /<\/?[a-z][^>]*>|<\/?>/gi;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
/** Text that would open or close the classifier's message's own tags. */
const OWN_TAGS = /<\s*\/?\s*(issue|project)\b[^>]*>/gi;
/** `text` without the classifier's message's own tags: each one marked `[tag removed]`. */
export const withoutOwnTags = (text: string) => text.replace(OWN_TAGS, '[tag removed]');

/** Fenced code blocks and inline code: the Issues page shows them as written. */
const CODE =
  /(^ {0,3}(?:```|~~~)[^\n]*\n[\s\S]*?(?:^ {0,3}(?:```|~~~)[ \t]*$|(?![\s\S]))|(`+)(?!`)[^\n]*?[^`\n]\2(?!`))/m;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The entities HTML text uses most; any other is left as written (as `issue-text.ts`). */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}

/** A tag's attribute, quoted or not, decoded. */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decode(value);
}

/** Text outside code, as the forge shows it; whether it held what the forge does not show. */
function cleanHtml(text: string): { text: string; hidden: boolean } {
  const hidden = /<!--/.test(text) || /<(script|style)\b/i.test(text);
  const cleaned = text
    .replace(COMMENT, '')
    .replace(WHOLE, '')
    .replace(IMG, (tag) => {
      const src = attribute(tag, 'src');
      const alt = attribute(tag, 'alt')?.trim() || 'image';
      return src ? `[${alt}](${src})` : '';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    // Marked, not dropped as another tag: the classifier sees that the issue tried.
    .replace(OWN_TAGS, '[tag removed]')
    .replace(TAG, '');
  return { text: decode(cleaned), hidden };
}

/**
 * An issue's Markdown as the classifier reads it: outside code, HTML comments, scripts and styles
 * dropped, images as links, `<br>` a break, other tags removed and their text kept, entities
 * decoded; code as written. Zero-width and bidirectional characters are dropped, and Symbiote's
 * own tags removed everywhere. `hidden`: something the forge does not show was dropped.
 */
export function cleanIssueText(markdown: string): { text: string; hidden: boolean } {
  let hidden = new RegExp(INVISIBLE.source).test(markdown);
  const pieces = markdown.replace(INVISIBLE, '').split(CODE);
  // split's groups: the code, then the inline code's backticks (undefined for a fence).
  let text = '';
  for (let i = 0; i < pieces.length; i += 3) {
    const prose = cleanHtml(pieces[i] ?? '');
    hidden ||= prose.hidden;
    text += prose.text + (pieces[i + 1] ?? '');
  }
  return {
    text: withoutOwnTags(text)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    hidden,
  };
}

/** Who wrote a comment the classifier reads: a member, the issue's author, or neither. */
function commenter(issue: Issue, comment: IssueComment): 'member' | 'author' | null {
  if (isMember(comment.author, issue.forge)) return 'member';
  return comment.author.login === issue.author.login ? 'author' : null;
}

/** The snapshot of `issue` taken at `at`. */
export function issueSnapshot(issue: Issue, at: string): IssueSnapshot {
  let hidden = false;
  const clean = (markdown: string) => {
    const cleaned = cleanIssueText(markdown);
    hidden ||= cleaned.hidden;
    return cleaned.text;
  };
  const comments = issue.thread
    .map((comment) => ({ comment, by: commenter(issue, comment) }))
    .filter((c): c is { comment: IssueComment; by: 'member' | 'author' } => c.by !== null);
  const outside = issue.thread.length - comments.length + issue.moreComments;
  const role = issue.author.role ?? 'not given without a token';
  const lines = [
    `Title: ${clean(issue.title)}`,
    `Author's role: ${role}`,
    `Labels: ${issue.labels.length > 0 ? issue.labels.map((l) => clean(l.name)).join(', ') : 'none'}`,
    `Opened: ${issue.created}; last updated: ${issue.updated}`,
    `Comments by people outside the project, left out: ${outside}${issue.commentsNeedToken ? ' (comments need a token: none read)' : ''}`,
    '',
    'Body:',
    clean(issue.body) || '(empty)',
  ];
  for (const { comment, by } of comments) {
    const who = by === 'member' ? `a ${comment.author.role ?? 'member'}` : "the issue's author";
    lines.push('', `Comment by ${who}, ${comment.created}:`, clean(comment.body) || '(empty)');
  }
  const flags: IssueSnapshotFlag[] = hidden ? ['hidden-text'] : [];
  let text = lines.join('\n');
  if (text.length > MAX_ISSUE) {
    text = `${text.slice(0, MAX_ISSUE)}\n[cut at ${MAX_ISSUE} characters]`;
    flags.push('cut');
  }
  const read = {
    title: issue.title,
    body: issue.body,
    labels: issue.labels.map((l) => l.name).sort(),
    role: issue.author.role ?? null,
    comments: comments.map(({ comment }) => [comment.author.login, comment.created, comment.body]),
  };
  return {
    hash: createHash('sha256').update(JSON.stringify(read)).digest('hex'),
    at,
    text,
    read: {
      members: comments.filter((c) => c.by === 'member').length,
      author: comments.filter((c) => c.by === 'author').length,
    },
    outside,
    ...(issue.commentsNeedToken ? { commentsNeedToken: true as const } : {}),
    flags,
  };
}
