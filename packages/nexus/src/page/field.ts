// The nexus page's field and the list's keys (decisions 910, 913, 926): a search or a path typed,
// the pick moved by the keys, home's tree opened and closed, a folder gone into.
import { completed, into, typedPath, up } from './complete.js';
import { listView } from './list-view.js';
import { movedPick, type Pick } from './pick.js';
import type { Row } from './search.js';
import type { PageState } from './state.js';
import { folderName } from './home-view.js';

/** The field and the pick over the page's state. */
export function fieldKeys(
  state: PageState,
  {
    list,
    render,
    select,
    act,
  }: {
    list: ReturnType<typeof listView>;
    render: () => void;
    select: (root: string | null, options?: { focusFrame?: boolean }) => void;
    act: (row: Row) => void;
  },
) {
  /** A picked place in the list. */
  function pickOf(at: number): Pick | null {
    const row = state.lastView.rows[at];
    if (!row) return null;
    const nth = state.lastView.rows.slice(0, at).filter((other) => other.path === row.path).length;
    return { path: row.path, at, ...(nth > 0 ? { nth } : {}) };
  }

  /** Opens or closes a folder of home's tree (decision 926). */
  function toggleFolder(row: Row): void {
    if (row.depth === undefined || row.leaf === true) return;
    if (state.openFolders.has(row.path)) state.openFolders.delete(row.path);
    else state.openFolders.add(row.path);
    render();
  }

  /**
   * Go in, on a folder's card: its folders shown in home's tree (the tree opened down to it, the
   * field cleared), or typed as a path when the tree does not hold it.
   */
  function goIn(row: Row): void {
    if (!state.known) return;
    const homePath = state.known.home;
    const inTree =
      state.tree !== null &&
      row.path.startsWith(`${homePath}/`) &&
      state.tree.all.includes(row.path);
    if (!inTree) {
      typeInField(folderName(row.path, homePath));
      return;
    }
    for (let at = row.path; at.startsWith(`${homePath}/`); at = at.slice(0, at.lastIndexOf('/'))) {
      state.openFolders.add(at);
    }
    state.query = '';
    list.field.value = '';
    state.browsed = null;
    if (state.selected !== null) select(null);
    state.pick = { path: row.path, at: 0 };
    render();
    // The same row, now in the tree: its last place (the tree is below the groups).
    const places = state.lastView.rows.flatMap((r, n) => (r.path === row.path ? [n] : []));
    const last = places.at(-1);
    if (last !== undefined) state.pick = pickOf(last);
    render();
    list.reveal();
    list.field.focus();
  }

  /**
   * The field's text: a search, or a path (decision 910). The pick starts again from the top; the
   * address names a folder typed, so a reload keeps it.
   */
  function setQuery(value: string, { fromField = false }: { fromField?: boolean } = {}): void {
    state.query = value;
    if (!fromField && list.field.value !== value) list.field.value = value;
    state.pick = null;
    const typed = state.known ? typedPath(value, state.known.home) : null;
    state.browsed = typed ? typed.folder : null;
    if (state.selected === null) select(null);
    else render();
  }

  /** Puts `text` in the field, the caret at its end, the focus in it. */
  function typeInField(text: string): void {
    if (state.selected !== null) select(null);
    setQuery(text);
    list.field.focus();
    list.field.setSelectionRange(text.length, text.length);
  }

  /** The field's keys: the pick, Enter, Esc, and a path's Tab, → and Backspace (decision 910). */
  function onKey(event: KeyboardEvent): void {
    const field = list.field;
    const row = state.pick === null ? null : (state.lastView.rows[state.pick.at] ?? null);
    const atEnd =
      field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
    const typed = state.known ? typedPath(state.query, state.known.home) : null;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'PageDown':
      case 'PageUp': {
        event.preventDefault();
        state.pick = movedPick(state.lastView.rows, state.pick, event.key);
        render();
        list.reveal();
        return;
      }
      case 'Enter':
        event.preventDefault();
        if (row) act(row);
        return;
      case 'Escape':
        if (state.query === '') return;
        event.preventDefault();
        setQuery('');
        return;
      case 'Tab': {
        if (event.shiftKey || !typed || !state.lastView.entries) return;
        const next = completed(state.query, state.lastView.entries);
        if (next === state.query) return;
        event.preventDefault();
        setQuery(next);
        return;
      }
      case 'ArrowRight':
        // Home's tree, the field empty (decision 926): → opens the picked folder, then goes in.
        if (state.query === '' && row?.depth !== undefined && row.leaf !== true) {
          event.preventDefault();
          if (!row.open) toggleFolder(row);
          else {
            const nextRow = state.lastView.rows[(state.pick?.at ?? 0) + 1];
            if (nextRow?.depth !== undefined && nextRow.depth > row.depth) {
              state.pick = pickOf((state.pick?.at ?? 0) + 1);
              render();
              list.reveal();
            }
          }
          return;
        }
        if (!typed || !atEnd || !row || row.repository || row.missing) return;
        event.preventDefault();
        setQuery(into(state.query, row));
        return;
      case 'ArrowLeft': {
        // ← closes the picked folder, or goes to the folder holding it.
        if (state.query !== '' || row?.depth === undefined) return;
        event.preventDefault();
        if (row.open) {
          toggleFolder(row);
          return;
        }
        const at = state.pick?.at ?? 0;
        for (let n = at - 1; n >= 0; n--) {
          const above = state.lastView.rows[n];
          if (above?.depth === undefined) break;
          if (above.depth < row.depth) {
            state.pick = pickOf(n);
            render();
            list.reveal();
            break;
          }
        }
        return;
      }
      case 'Backspace': {
        if (!typed || !atEnd) return;
        const above = up(state.query);
        if (above === null) return;
        event.preventDefault();
        setQuery(above);
        return;
      }
    }
  }

  return { pickOf, toggleFolder, goIn, setQuery, typeInField, onKey };
}
