import { useEffect, useState } from 'react';
import type { LibraryState } from '@symbiote/core';
import { Help } from '../ui/Help.js';
import { BackIcon, FolderIcon } from '../ui/icons.js';
import { commitMessage, libraryGitText, libraryName, librarySync } from './library.js';
import { PaneHead } from './PaneHead.js';

/** What the page says after a change, under the pane. */
export interface LibraryNotice {
  text: string;
  error?: boolean;
}

const STATES = { new: 'new', changed: 'changed', deleted: 'deleted' } as const;

/**
 * The skill library's pane (SK1): where it is, its git and its changes; Commit, Push and Pull as
 * Settings allow (decision 428): none of them when git is left to the person.
 */
export function LibraryPane({
  library,
  skills,
  busy,
  notice,
  onCommit,
  onPush,
  onPull,
  onSettings,
  onBack,
}: {
  library: LibraryState;
  /** How many skills it holds. */
  skills: number;
  busy: boolean;
  notice: LibraryNotice | null;
  onCommit: (message: string) => void;
  onPush: () => void;
  onPull: () => void;
  onSettings: () => void;
  onBack: () => void;
}) {
  const { git } = library;
  const changes = git?.changes ?? [];
  const suggested = commitMessage(changes);
  const [message, setMessage] = useState(suggested);
  const [typed, setTyped] = useState(false);
  // Other changes, another first message: until the person writes their own.
  useEffect(() => {
    if (!typed) setMessage(suggested);
  }, [suggested, typed]);
  const pushes = library.commits === 'push';
  const sync = git ? librarySync(git) : '';
  /** Symbiote commits here: the message, and Commit, Push and Pull on the line of actions. */
  const commits = git && library.commits !== 'none' ? git : null;

  return (
    <section className="skills-pane skills-library" aria-label="Skill library">
      <button type="button" className="button ghost skills-back" onClick={onBack}>
        <BackIcon /> All skills
      </button>
      <PaneHead
        icon={<FolderIcon />}
        title={
          <>
            {libraryName(library)}
            <span className="skills-state">
              {git ? (git.branch ?? 'No branch') : 'Plain folder'}
            </span>
          </>
        }
      >
        <code>{library.folder}</code> · {libraryGitText(library)}
        {sync && ` ${sync}.`}
      </PaneHead>
      {library.checkout && (
        <p className="skills-warning">
          This is the checkout&apos;s own {library.checkout}: its skills are listed with the
          checkout&apos;s.
        </p>
      )}
      {library.exists && !library.checkout && skills === 0 && (
        <p className="hint library-empty">
          No skills in it yet: New skill makes one here, or ask Scribe for one.
        </p>
      )}
      {git && (
        <>
          <h3>Changes</h3>
          {changes.length > 0 ? (
            <ul className="library-changes" aria-label="Changes">
              {changes.map((change) => (
                <li key={change.path}>
                  <code>{change.path}</code>
                  <span className={`skills-mark ${change.state === 'new' ? 'added' : 'changed'}`}>
                    {STATES[change.state]}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint library-clean">Nothing to commit.</p>
          )}
          {commits ? (
            <form
              id="library-commit"
              className="library-commit"
              aria-label="Commit"
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || changes.length === 0 || message.trim() === '') return;
                onCommit(message.trim());
                setTyped(false);
              }}
            >
              <div className="skills-field">
                <span className="field-label">
                  <label htmlFor="library-message">Message</label>
                  <Help label="About the commit">
                    Commits only the library&apos;s folder, on {git.branch ?? 'no branch'}: anything
                    else staged in that repository stays staged.
                    {pushes && ' Then pushes to its upstream, else to origin.'}
                  </Help>
                </span>
                <input
                  id="library-message"
                  value={message}
                  autoComplete="off"
                  onChange={(event) => {
                    setMessage(event.target.value);
                    setTyped(true);
                  }}
                />
              </div>
            </form>
          ) : (
            <p className="library-git-note">
              Symbiote leaves this git to you: commit in <code>{git.root}</code>.{' '}
              <button type="button" className="link" onClick={onSettings}>
                Let Symbiote commit
              </button>
            </p>
          )}
        </>
      )}
      <div className="skills-actions">
        {notice && (
          <span className={`skills-notice${notice.error ? ' error' : ''}`} role="status">
            {notice.text}
          </span>
        )}
        <button type="button" className="button ghost" onClick={onSettings}>
          Change in Settings
        </button>
        {commits && pushes && commits.upstream && (
          <button type="button" className="button ghost" disabled={busy} onClick={onPull}>
            Pull
          </button>
        )}
        {commits && pushes && commits.ahead > 0 && (
          <button type="button" className="button ghost" disabled={busy} onClick={onPush}>
            Push
          </button>
        )}
        {commits && (
          <button
            type="submit"
            form="library-commit"
            className="button"
            disabled={busy || changes.length === 0 || message.trim() === '' || !commits.branch}
          >
            {pushes ? 'Commit and push' : 'Commit'}
          </button>
        )}
      </div>
    </section>
  );
}
