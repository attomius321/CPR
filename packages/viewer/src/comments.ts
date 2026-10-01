import type { Graph, GraphNode } from '@cpr/core';
import type { DiffRow } from './detail.js';
import { label } from './flow.js';
import { fingerprint } from './review.js';

export type Side = 'base' | 'head';
export type ReviewEvent = 'comment' | 'approve' | 'request-changes';

/** A line of one side of a file: where an inline comment goes on the forge. */
export interface Anchor {
  side: Side;
  path: string;
  /** The file's path on the other side; differs for renames. */
  otherPath: string;
  line: number;
}

/** A comment written in the viewer, kept until the review is submitted. */
export interface Draft {
  id: string;
  symbol: string;
  /** Null: no changed line to attach to, so it goes into the review's summary. */
  anchor: Anchor | null;
  body: string;
  /** The symbol's fingerprint when the comment was written. */
  print: string;
  /** First line of the anchored side of the symbol then: the anchor moves with the symbol. */
  start: number | null;
  /** The symbol changed (or left the change) since: the comment goes into the summary. */
  outdated?: true;
}

export function newDraft(node: GraphNode, anchor: Anchor | null, body: string): Draft {
  return {
    id: draftId(),
    symbol: node.id,
    anchor,
    body: body.trim(),
    print: fingerprint(node),
    start: (anchor && node[anchor.side]?.range.start.line) ?? null,
  };
}

/**
 * Brings drafts up to date with a newer version of the change: a symbol whose code is the same
 * keeps its comments on the same lines of it, wherever it now starts; a symbol that changed
 * makes its comments outdated, so they go into the summary instead of onto a wrong line.
 */
export function refreshDrafts(graph: Graph, drafts: readonly Draft[]): Draft[] {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  return drafts.map((draft) => {
    if (draft.outdated) return draft;
    const node = nodes.get(draft.symbol);
    const decl = node && draft.anchor ? node[draft.anchor.side] : undefined;
    if (!node || fingerprint(node) !== draft.print || (draft.anchor && !decl)) {
      return { ...draft, anchor: null, outdated: true };
    }
    if (!draft.anchor || !decl || draft.start === null) return draft;
    const start = decl.range.start.line;
    if (start === draft.start && decl.file === draft.anchor.path) return draft;
    const line = draft.anchor.line - draft.start + start;
    return { ...draft, anchor: anchor(graph, draft.anchor.side, decl.file, line), start };
  });
}

/** What `POST /api/review` takes (the forge adapter's `Review`). */
export interface ReviewPayload {
  event: ReviewEvent;
  body: string;
  comments: (Anchor & { body: string })[];
}

/**
 * The anchor for a diff row: an added line on the head side, a removed line on the base side.
 * Unchanged lines may lie outside the forge's diff hunks, where it refuses comments.
 */
export function anchorFor(graph: Graph, node: GraphNode, row: DiffRow): Anchor | null {
  if (row.type === 'add' && node.head && row.head !== undefined) {
    return anchor(graph, 'head', node.head.file, row.head);
  }
  if (row.type === 'del' && node.base && row.base !== undefined) {
    return anchor(graph, 'base', node.base.file, row.base);
  }
  return null;
}

/** The first added line, else the first removed one. */
export function defaultAnchor(graph: Graph, node: GraphNode, rows: DiffRow[]): Anchor | null {
  const row = rows.find((r) => r.type === 'add') ?? rows.find((r) => r.type === 'del');
  return row ? anchorFor(graph, node, row) : null;
}

function anchor(graph: Graph, side: Side, path: string, line: number): Anchor {
  return { side, path, otherPath: otherPath(graph, side, path), line };
}

function otherPath(graph: Graph, side: Side, path: string): string {
  for (const file of graph.files) {
    const before = file.previousPath ?? file.path;
    if (side === 'head' && file.path === path) return before;
    if (side === 'base' && before === path) return file.path;
  }
  return path;
}

export function describeDraft(draft: Draft): string {
  return draft.outdated
    ? 'outdated: the symbol changed since; in the review summary'
    : describeAnchor(draft.anchor);
}

export function describeAnchor(anchor: Anchor | null): string {
  if (!anchor) return 'in the review summary (no changed line)';
  return `on ${anchor.side === 'base' ? 'removed ' : ''}line ${anchor.line} of ${anchor.path}`;
}

/**
 * The review to post: anchored drafts become inline comments; the others are quoted in the
 * summary under the symbol they are about.
 */
export function toReview(
  graph: Graph,
  drafts: readonly Draft[],
  event: ReviewEvent,
  body: string,
): ReviewPayload {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const general = drafts
    .filter((d) => d.anchor === null)
    .map((d) => {
      const node = nodes.get(d.symbol);
      const file = node && (node.head ?? node.base)?.file;
      const name = node ? label(node) : d.symbol;
      return `**\`${name}\`**${file ? ` (${file})` : ''}\n${d.body.trim()}`;
    });
  return {
    event,
    body: [body.trim(), ...general].filter(Boolean).join('\n\n'),
    comments: drafts.flatMap((d) => (d.anchor ? [{ ...d.anchor, body: d.body.trim() }] : [])),
  };
}

/** Whether the forge would take the review: a verdict alone is fine, a plain comment needs text. */
export function canSubmit(drafts: readonly Draft[], event: ReviewEvent, body: string): boolean {
  if (event === 'approve') return true;
  if (event === 'request-changes') return body.trim() !== '';
  return body.trim() !== '' || drafts.length > 0;
}

export async function postReview(payload: ReviewPayload): Promise<{ url: string }> {
  const response = await fetch('./api/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cpr': '1' },
    body: JSON.stringify(payload),
  });
  if (response.ok) return (await response.json()) as { url: string };
  const text = await response.text();
  let message = text;
  try {
    message = (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    // plain text
  }
  throw new Error(message || `${response.status} ${response.statusText}`);
}

export interface ReviewDraft {
  drafts: Draft[];
  body: string;
}

let counter = 0;
function draftId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}
