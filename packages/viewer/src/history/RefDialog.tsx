// Branches and tags made, renamed and deleted from Git's page (V66d): one dialog per action,
// git's refusal shown in it; an unmerged branch's deletion asks again, its lost commits counted.
import { useState, type FormEvent } from 'react';
import {
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  GitRefusal,
  renameBranch,
} from './git-api.js';
import { shortSha } from './commits.js';

/** What the dialog does: at a commit, or to a branch or tag by name. */
export type RefAction =
  | { kind: 'new-branch'; at: string }
  | { kind: 'new-tag'; at: string }
  | { kind: 'rename-branch'; name: string }
  | { kind: 'delete-branch'; name: string }
  | { kind: 'delete-tag'; name: string };

const TITLES: Record<RefAction['kind'], string> = {
  'new-branch': 'New branch',
  'new-tag': 'New tag',
  'rename-branch': 'Rename branch',
  'delete-branch': 'Delete branch',
  'delete-tag': 'Delete tag',
};

/**
 * The dialog of `action`. Done, `onDone` says what changed (the page lists again, the status bar
 * says it); Escape or Cancel closes it.
 */
export function RefDialog({
  action,
  onDone,
  onCancel,
}: {
  action: RefAction;
  onDone: (notice: { text: string; warning?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(action.kind === 'rename-branch' ? action.name : '');
  const [message, setMessage] = useState('');
  const [checkout, setCheckout] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** An unmerged branch: how many commits only it holds (asked again with Delete anyway). */
  const [unmerged, setUnmerged] = useState<number | null>(null);

  const run = async (force = false) => {
    setRunning(true);
    setError(null);
    try {
      switch (action.kind) {
        case 'new-branch': {
          const made = await createBranch(name.trim(), action.at, checkout);
          return onDone({
            text: `Made ${name.trim()} at ${shortSha(action.at)}${checkout && !made.warning ? ', checked out' : ''}`,
            ...(made.warning ? { warning: made.warning } : {}),
          });
        }
        case 'new-tag':
          await createTag(name.trim(), action.at, message);
          return onDone({ text: `Tagged ${shortSha(action.at)} ${name.trim()}` });
        case 'rename-branch':
          await renameBranch(action.name, name.trim());
          return onDone({ text: `Renamed ${action.name} to ${name.trim()}` });
        case 'delete-branch':
          await deleteBranch(action.name, force);
          return onDone({ text: `Deleted ${action.name}` });
        case 'delete-tag':
          await deleteTag(action.name);
          return onDone({ text: `Deleted the tag ${action.name}` });
      }
    } catch (e) {
      if (e instanceof GitRefusal && e.only !== undefined) setUnmerged(e.only);
      else setError((e as Error).message);
      setRunning(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!running) void run(unmerged !== null);
  };
  const named =
    action.kind === 'new-branch' || action.kind === 'new-tag' || action.kind === 'rename-branch';
  const deleting = action.kind === 'delete-branch' || action.kind === 'delete-tag';
  const verb = {
    'new-branch': 'Make the branch',
    'new-tag': 'Tag it',
    'rename-branch': 'Rename',
    'delete-branch': unmerged !== null ? 'Delete anyway' : 'Delete',
    'delete-tag': 'Delete',
  }[action.kind];
  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ref-dialog-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || running) return;
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
      >
        <h2 id="ref-dialog-title">
          {TITLES[action.kind]}
          {'at' in action && <code className="dialog-sha"> at {shortSha(action.at)}</code>}
          {'name' in action && <span className="ref ref-branch dialog-ref">{action.name}</span>}
          {deleting && '?'}
        </h2>
        {named && (
          <label className="git-field">
            <span className="field-label">{action.kind === 'new-tag' ? 'Tag' : 'Branch'} name</span>
            <input
              autoFocus
              value={name}
              spellCheck={false}
              placeholder={action.kind === 'new-tag' ? 'v1.2.0' : 'feature/its-name'}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        {action.kind === 'new-tag' && (
          <label className="git-field">
            <span className="field-label">
              Message <span className="field-optional">(optional: makes it annotated)</span>
            </span>
            <textarea
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
        )}
        {action.kind === 'new-branch' && (
          <label className="git-check">
            <input
              type="checkbox"
              checked={checkout}
              onChange={(event) => setCheckout(event.target.checked)}
            />
            Check it out
          </label>
        )}
        {action.kind === 'delete-branch' && (
          <p className={unmerged !== null ? 'error' : 'dialog-note'}>
            {unmerged !== null
              ? `${action.name} is not merged: ${unmerged} commit${unmerged === 1 ? '' : 's'} only it holds would be lost.`
              : 'Only if it is merged: git refuses an unmerged branch, and this asks again.'}
          </p>
        )}
        {action.kind === 'delete-tag' && (
          <p className="dialog-note">Here only: a remote&apos;s copy of the tag stays.</p>
        )}
        {error && <pre className="error">{error}</pre>}
        <div className="dialog-buttons">
          <button type="button" className="button ghost" disabled={running} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className={deleting ? 'button danger' : 'button'}
            autoFocus={!named}
            disabled={running || (named && name.trim() === '')}
          >
            {running ? 'Working…' : verb}
          </button>
        </div>
      </form>
    </div>
  );
}
