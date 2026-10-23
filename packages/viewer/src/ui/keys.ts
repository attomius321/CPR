/** Keys the shell and its pages leave alone: typing, a dialog's or a menu's, the agent's terminal's. */
export function keyIsTaken(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
    return true;
  return document.querySelector('[aria-modal="true"], [role="menu"]') !== null;
}
