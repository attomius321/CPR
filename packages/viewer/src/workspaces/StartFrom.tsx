import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { StartBranch } from '@symbiote/core';
import { shortSha } from '../history/commits.js';
import { BranchIcon, CheckIcon, SearchIcon } from '../ui/icons.js';
import { markedParts, startChoices, type StartChoice } from './start-from.js';

/**
 * Start from (V66, decisions 475–478): the branch picked (or a History row's commit, `value`
 * empty) in a field that opens a search over the branches. A letter typed on the field opens it
 * with that letter; ↑ ↓ move, Enter picks, Escape closes it (and only it: the page leaves on
 * Escape), as do Tab and a click elsewhere.
 */
export function StartFrom({
  id,
  labelId,
  branches,
  at,
  value,
  onPick,
}: {
  id: string;
  /** The field's label, read before the value. */
  labelId: string;
  branches: readonly StartBranch[];
  at: string | undefined;
  value: string;
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const listId = `${ids}-list`;
  const optionId = (i: number) => `${ids}-${i}`;
  const groups = useMemo(() => startChoices(branches, at, query), [branches, at, query]);
  const choices = groups.flatMap((group) => group.choices);
  const indexOf = new Map(choices.map((choice, i) => [choice, i]));
  const current = Math.min(active, choices.length - 1);

  const show = (typed: string) => {
    const every = startChoices(branches, at, '').flatMap((group) => group.choices);
    setQuery(typed);
    // Nothing typed: at the one picked, as a select opens.
    setActive(
      typed
        ? 0
        : Math.max(
            0,
            every.findIndex((choice) => choice.value === value),
          ),
    );
    setOpen(true);
  };
  const hide = (refocus: boolean) => {
    setOpen(false);
    if (refocus) field.current?.focus();
  };
  const pick = (choice: StartChoice) => {
    hide(true);
    if (choice.value !== value) onPick(choice.value);
  };

  // A press elsewhere closes it, nothing picked.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  // The active entry in view, as the keys move it.
  useEffect(() => {
    if (open) document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
  }, [open, current]);

  const fieldKey = (event: KeyboardEvent) => {
    const letter =
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey;
    if (!letter && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    // The shell's own keys are letters too (m, s…): typed here, they are the search's.
    event.preventDefault();
    event.stopPropagation();
    show(letter ? event.key : '');
  };
  const searchKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.max(0, Math.min(choices.length - 1, current + step)));
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      const choice = choices[current];
      if (choice) pick(choice);
    } else if (event.key === 'Escape') {
      // The page's Escape leaves it: this one is the list's.
      event.stopPropagation();
      hide(true);
    } else return;
    event.preventDefault();
  };

  const label = value === '' && at ? `The commit ${shortSha(at)}` : value;
  const option = (choice: StartChoice) => {
    const i = indexOf.get(choice) ?? 0;
    const picked = choice.value === value;
    return (
      <div
        key={choice.value}
        id={optionId(i)}
        role="option"
        aria-selected={picked}
        className={i === current ? 'start-from-option active' : 'start-from-option'}
        onPointerMove={() => i !== current && setActive(i)}
        onClick={() => pick(choice)}
      >
        <span className="start-from-name">
          {markedParts(choice.label, choice.marks).map((part, n) =>
            part.marked ? <mark key={n}>{part.text}</mark> : part.text,
          )}
        </span>
        {picked && <CheckIcon />}
      </div>
    );
  };

  return (
    <div
      className="start-from"
      ref={box}
      // Tab, or the window left: closed, nothing picked.
      onBlur={(event) => {
        if (open && !box.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={field}
        id={id}
        type="button"
        className="start-from-field"
        aria-labelledby={`${labelId} ${id}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? hide(false) : show(''))}
        onKeyDown={fieldKey}
      >
        <BranchIcon />
        <span className="start-from-value">{label}</span>
      </button>
      {open && (
        <div
          className="start-from-popover"
          // A press in it keeps the focus in the search, a scrollbar's too.
          onMouseDown={(event) => {
            if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
          }}
        >
          <div className="start-from-search">
            <SearchIcon />
            <input
              type="text"
              role="combobox"
              aria-label="Search branches"
              aria-expanded="true"
              aria-autocomplete="list"
              {...(choices.length > 0
                ? { 'aria-controls': listId, 'aria-activedescendant': optionId(current) }
                : {})}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Search branches"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={searchKey}
            />
          </div>
          {choices.length === 0 ? (
            <p className="start-from-none">No branch matches</p>
          ) : (
            <div
              id={listId}
              role="listbox"
              aria-label="Branches"
              tabIndex={-1}
              className="start-from-list"
            >
              {groups.map((group) =>
                group.heading ? (
                  <div key={group.key} role="group" aria-labelledby={`${ids}-${group.key}`}>
                    <div id={`${ids}-${group.key}`} className="start-from-heading">
                      {group.heading}{' '}
                      <span className="start-from-count">{group.choices.length}</span>
                    </div>
                    {group.choices.map(option)}
                  </div>
                ) : (
                  group.choices.map(option)
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
