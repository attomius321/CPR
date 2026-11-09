// The nexus page's questions in the viewer's dialog (decisions 542, 928): Stop's and `git init`'s.
import { el, type Child } from './dom.js';
import { shownPath, type Row } from './search.js';
import type { PageState } from './state.js';

/**
 * The question before a Symbiote stops, in the viewer's dialog (its `ConfirmDialog`): staying is
 * the default, Escape stays.
 */
export function confirmStop(name: string): Promise<boolean> {
  return ask({
    question: `Stop ${name}?`,
    detail: [
      'Its symbiote view ends, with its terminals and any agent working in them. Open it again from Symbiotes.',
    ],
    stay: 'Keep it running',
    go: 'Stop',
  });
}

/**
 * The question before `git init` (decision 928), as Stop's: Cancel is the default, Escape
 * cancels.
 */
export function confirmInit(row: Row, state: { known: PageState['known'] }): Promise<boolean> {
  const where = state.known ? shownPath(row.path, state.known.home) : row.path;
  return ask({
    question: `Make ${row.name} a git repository?`,
    detail: [
      'Symbiote runs ',
      el('code', {}, 'git init'),
      ` in ${where}: a .git folder is added, nothing else. No commit is made: commit from its Git page to start workspaces. Then its Symbiote opens.`,
    ],
    stay: 'Cancel',
    go: 'Make it a repository',
  });
}

/** A question in the viewer's dialog: `stay` focused, the default; Escape stays. */
function ask({
  question,
  detail,
  stay,
  go,
}: {
  question: string;
  detail: Child[];
  stay: string;
  go: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const keep = el('button', { type: 'button', class: 'button' }, stay);
    const yes = el('button', { type: 'button', class: 'button ghost' }, go);
    const box = el(
      'div',
      {
        class: 'dialog',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': 'nexus-ask-question',
        'aria-describedby': 'nexus-ask-detail',
      },
      el('h2', { id: 'nexus-ask-question' }, question),
      el('p', { id: 'nexus-ask-detail' }, ...detail),
      el('div', { class: 'dialog-buttons' }, yes, keep),
    );
    const backdrop = el('div', { class: 'dialog-backdrop' }, box);
    const answer = (value: boolean) => {
      backdrop.remove();
      resolve(value);
    };
    keep.addEventListener('click', () => answer(false));
    yes.addEventListener('click', () => answer(true));
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      answer(false);
    });
    document.body.append(backdrop);
    keep.focus();
  });
}
