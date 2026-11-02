import { useCallback, useEffect, useState } from 'react';
import { keyIsTaken } from '../ui/keys.js';
import { loadWidths, saveWidth } from '../ui/widths.js';

const CHANGES_KEY = 'symbiote.viewer.changes';
const FOCUS_KEY = 'symbiote.viewer.focus';

/** Whether the person turned a workspace's Focus on (V89, decision 830), kept in this browser. */
function loadFocus(): boolean {
  try {
    return window.localStorage.getItem(FOCUS_KEY) === 'on';
  } catch {
    return false;
  }
}

function saveFocus(on: boolean): void {
  try {
    window.localStorage.setItem(FOCUS_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/**
 * A workspace's Focus (V89, decision 830): the terminal with the sidenav as its rail and no side
 * card; remembered in this browser, as the sidenav's fold is, for every workspace.
 */
export function useFocus(): [boolean, () => void] {
  const [focus, setFocus] = useState(loadFocus);
  const toggle = useCallback(
    () =>
      setFocus((on) => {
        saveFocus(!on);
        return !on;
      }),
    [],
  );
  return [focus, toggle];
}

/** Whether the person hid the changes panel (V29d), kept in this browser; shown by default. */
function loadChangesShown(): boolean {
  try {
    return window.localStorage.getItem(CHANGES_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

function saveChangesShown(shown: boolean): void {
  try {
    window.localStorage.setItem(CHANGES_KEY, shown ? 'shown' : 'hidden');
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/**
 * The branch's changes beside a workspace (V29d): shown unless the person hid them, with `]` or
 * the head's button, and as wide as they were dragged (V34); both kept in this browser.
 */
export function useChangesPanel() {
  const [changesShown, setChangesShown] = useState(loadChangesShown);
  // As wide as the person dragged them (V34), kept in this browser.
  const [changesWidth, setChangesWidth] = useState(() => loadWidths().changes);
  const [resizing, setResizing] = useState(false);
  const resizeChanges = useCallback((width: number | null) => {
    setChangesWidth(width ?? undefined);
    saveWidth('changes', width);
  }, []);
  const toggleChanges = useCallback(
    () =>
      setChangesShown((shown) => {
        saveChangesShown(!shown);
        return !shown;
      }),
    [],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ']' || keyIsTaken(event)) return;
      event.preventDefault();
      toggleChanges();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleChanges]);
  return { changesShown, toggleChanges, changesWidth, resizeChanges, resizing, setResizing };
}
