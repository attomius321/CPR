// The Activity tab's raw stream (V73): every line Symbiote recorded for it, in time order, each
// opening to its JSON as recorded — what the timeline groups, unchanged.
import { memo, useState, type MouseEvent } from 'react';
import { shownCommand } from './classify.js';
import type { RawLine } from './events.js';
import { timeOf } from './GroupRow.js';

const firstLine = (text: string) =>
  (text.split('\n').find((line) => line.trim() !== '') ?? '').trim();

/**
 * A line's gist: what a tool worked on (a command without its leading `cd`, its paths short: the
 * JSON below keeps it whole), what was said, a commit's subject.
 */
function gist(line: RawLine, worktree: string): string {
  const value = (line.value ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === 'string' ? value[key] : '');
  if (line.source === 'tool') return firstLine(shownCommand(text('subject'), worktree));
  if (line.source === 'commit') return text('subject');
  if (line.source === 'workspace') return text('branch');
  if (line.source === 'review') return firstLine(text('text'));
  return firstLine(
    text('text') || text('reason') || text('message') || text('tool') || text('source'),
  );
}

const RawRow = memo(function RawRow({ line, worktree }: { line: RawLine; worktree: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="activity-raw-line">
      <details open={open}>
        <summary
          onClick={(e: MouseEvent) => {
            e.preventDefault();
            setOpen(!open);
          }}
        >
          {line.at ? (
            <time dateTime={line.at}>{timeOf(line.at, true)}</time>
          ) : (
            <span className="activity-raw-untimed">—</span>
          )}
          <span className="chip">{line.source}</span>
          <span className="activity-raw-what">{line.what}</span>
          <span className="activity-raw-gist">{gist(line, worktree)}</span>
        </summary>
        {open && <pre className="activity-output">{JSON.stringify(line.value, null, 2)}</pre>}
      </details>
    </li>
  );
});

export function RawStream({ lines, worktree }: { lines: readonly RawLine[]; worktree: string }) {
  return (
    <ol className="activity-raw" aria-label="Raw events">
      {lines.map((line) => (
        <RawRow key={line.key} line={line} worktree={worktree} />
      ))}
    </ol>
  );
}
