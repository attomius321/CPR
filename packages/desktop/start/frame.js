// The start page's frame (N1d), before its first paint: on Linux the page draws the window's
// corners and buttons. A file of its own, run as <head> is read: the page allows no inline script.
'use strict';

(() => {
  const api = window.symbioteStart;
  if (!api || api.frame !== 'own') return;
  const root = document.documentElement;
  root.dataset.frame = 'own';
  root.dataset.window = api.maximized ? 'maximized' : 'normal';

  // The buttons, once the bar exists; Maximize becomes Restore while the window fills the screen.
  document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.getElementById('window-buttons');
    if (!buttons) return;
    buttons.hidden = false;
    const toggle = document.getElementById('window-maximize');
    const name = () => {
      const maximized = root.dataset.window === 'maximized';
      toggle.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
      toggle.title = maximized ? 'Restore' : 'Maximize';
      toggle.classList.toggle('restore', maximized);
    };
    name();
    api.onWindowState(name);
    document
      .getElementById('window-minimize')
      .addEventListener('click', () => api.window('minimize'));
    toggle.addEventListener('click', () =>
      api.window(root.dataset.window === 'maximized' ? 'restore' : 'maximize'),
    );
    document.getElementById('window-close').addEventListener('click', () => api.window('close'));
  });
})();
