// The app's start page (N1b): what to open. `symbioteStart` is the preload's, for this page only.
'use strict';

const api = window.symbioteStart;
const params = new URLSearchParams(window.location.search);
const opening = params.get('opening');
const error = params.get('error');
const theme = params.get('theme');
const mac = navigator.userAgent.includes('Macintosh');

if (theme === 'light') document.documentElement.dataset.theme = 'light';
else if (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches) {
  document.documentElement.dataset.theme = 'light';
}

const folderName = (path) => path.split('/').filter(Boolean).pop() ?? path;

const statusLine = document.getElementById('status');
if (opening) {
  statusLine.hidden = false;
  statusLine.textContent = `Opening ${folderName(opening)}…`;
  statusLine.title = opening;
} else if (error) {
  statusLine.hidden = false;
  statusLine.classList.add('error');
  const repo = params.get('repo');
  statusLine.textContent = repo ? `${folderName(repo)}: ${error}` : error;
}

const openButton = document.getElementById('open');
document.getElementById('open-key').textContent = mac ? '⌘O' : 'Ctrl+O';
openButton.disabled = !!opening;
openButton.addEventListener('click', () => api.choose());
window.addEventListener('keydown', (event) => {
  if (opening || !(mac ? event.metaKey : event.ctrlKey) || event.key.toLowerCase() !== 'o') return;
  event.preventDefault();
  api.choose();
});

function drawRecent(repos) {
  const list = document.getElementById('recent');
  list.replaceChildren();
  document.getElementById('no-recent').hidden = repos.length > 0;
  for (const repo of repos) {
    const row = document.createElement('li');
    row.className = 'repo-row';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'repo';
    pick.disabled = !!opening;
    const name = document.createElement('span');
    name.className = 'repo-name';
    name.textContent = folderName(repo);
    const path = document.createElement('span');
    path.className = 'repo-path';
    path.textContent = repo;
    pick.append(name, path);
    pick.addEventListener('click', () => api.open(repo));
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'forget';
    forget.textContent = '×';
    forget.title = 'Remove from the list';
    forget.setAttribute('aria-label', `Remove ${folderName(repo)} from the list`);
    forget.addEventListener('click', () => drawRecent(api.forget(repo)));
    row.append(pick, forget);
    list.append(row);
  }
}

drawRecent(api.recent());
