import type { GraphNode } from '@symbiote/core';
import type { Anchor, Side } from './comments.js';
import type { DiffRow } from './detail.js';

/** A line of one side's file to open in VS Code (`POST ./api/open`). */
export interface OpenTarget {
  side: Side;
  file: string;
  line: number;
  column: number;
}

/** The server's answer: where it opened, or why it did not. */
export type OpenAnswer =
  | { ok: true; line: number; how: 'exact' | 'nearest'; moved: boolean }
  | { ok: false; error: string };

/** A symbol at its first line: head's, else base's (a removed symbol). */
export function symbolTarget(node: GraphNode): OpenTarget | null {
  const side: Side | null = node.head ? 'head' : node.base ? 'base' : null;
  const decl = side && node[side];
  if (!side || !decl) return null;
  const { line, col } = decl.range.start;
  return { side, file: decl.file, line, column: col };
}

/**
 * A row of a symbol's diff: on `side` (its line number clicked), else at its head line when it
 * has one (added and unchanged rows), else at its base line (removed rows).
 */
export function rowTarget(node: GraphNode, row: DiffRow, side?: Side): OpenTarget | null {
  const which = side ?? (row.head !== undefined ? 'head' : 'base');
  const line = row[which];
  const decl = node[which];
  return line !== undefined && decl ? { side: which, file: decl.file, line, column: 1 } : null;
}

/** The line picked for a comment. */
export function anchorTarget(anchor: Anchor): OpenTarget {
  return { side: anchor.side, file: anchor.path, line: anchor.line, column: 1 };
}

/** The line under the file line after an open. */
export function describeOpen(target: OpenTarget, answer: OpenAnswer): string {
  if (!answer.ok) return answer.error;
  if (answer.how === 'nearest') {
    const which = target.side === 'base' ? ' of base is not' : ' changed';
    return `Line ${target.line}${which} in your working copy: opened at line ${answer.line}, where it was`;
  }
  const moved = answer.moved
    ? ` (${target.line} at ${target.side}: moved in your working copy)`
    : '';
  return `Opened in VS Code at line ${answer.line}${moved}`;
}

/** Asks the server to open the line in VS Code, at the line where it is in the working copy. */
export async function openInEditor(target: OpenTarget): Promise<OpenAnswer> {
  let response: Response;
  try {
    response = await fetch('./api/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbiote': '1' },
      body: JSON.stringify(target),
    });
  } catch {
    return { ok: false, error: 'symbiote is not running: VS Code could not be asked to open it' };
  }
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // plain text (a refused request)
  }
  if (response.ok) return { ok: true, ...(value as Omit<OpenAnswer & { ok: true }, 'ok'>) };
  const error = (value as { error?: string } | undefined)?.error ?? text;
  return { ok: false, error: error || `VS Code could not be opened (${response.status})` };
}
