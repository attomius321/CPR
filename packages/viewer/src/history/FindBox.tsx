// Git's search (V66f): a commit by its message, author or SHA. Enter and Shift+Enter step through
// the rows found; Escape clears the field.
import type { RefObject } from 'react';
import { SearchIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';

export function FindBox({
  inputRef,
  query,
  matches,
  at,
  onQuery,
  onStep,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  /** The rows found; null while finding, or with no words. */
  matches: readonly number[] | null;
  /** Which match the cursor is on (0-based), or -1. */
  at: number;
  onQuery: (query: string) => void;
  onStep: (forward: boolean) => void;
}) {
  const words = query.trim();
  const count =
    words === ''
      ? null
      : matches === null
        ? 'Finding…'
        : matches.length === 0
          ? 'None'
          : at >= 0
            ? `${at + 1} of ${matches.length}`
            : `${matches.length} found`;
  return (
    <label
      className="git-find"
      {...tip('Find a commit by its message, author or SHA', { keys: 'f' })}
    >
      <SearchIcon />
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        aria-label="Find a commit"
        placeholder="Find a commit"
        spellCheck={false}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onStep(!event.shiftKey);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onQuery('');
            event.currentTarget.blur();
          }
        }}
      />
      {count && (
        <span className="git-find-count" role="status">
          {count}
        </span>
      )}
    </label>
  );
}
