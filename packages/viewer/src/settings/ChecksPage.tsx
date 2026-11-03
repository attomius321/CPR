import { useRef, useState } from 'react';
import type { CheckSetting } from '@symbiote/core';
import { Help } from '../ui/Help.js';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, ResetIcon, TrashIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';
import { checkGitNote, checksEdited, checksProblem, cleanCommands } from './checks.js';
import { SettingsCard } from './SettingsCard.js';

/** What the page says after a save or a reset. */
export interface ChecksNotice {
  text: string;
  error?: boolean;
  /** The file changed since it was read (409): read it again, the draft kept. */
  stale?: boolean;
}

/**
 * Checks (fix/settings-page): the check the merger runs before a merge lands and Hive on every
 * commit — one for both modes — as commands run in order, saved as `merge.checks`. Without one,
 * the check Symbiote finds is shown in its place, and Reset gives it back.
 */
export function ChecksPage({
  setting,
  error,
  hive,
  draft,
  busy,
  notice,
  onDraft,
  onDiscard,
  onSave,
  onLoad,
  onBack,
}: {
  /** As read; null while it is read, or when it could not be (`error`). */
  setting: CheckSetting | null;
  error: string | null;
  hive: boolean;
  draft: string[] | undefined;
  busy: boolean;
  notice: ChecksNotice | null;
  onDraft: (commands: string[]) => void;
  onDiscard: () => void;
  /** The commands to save; null removes `merge.checks`, for the one Symbiote finds. */
  onSave: (commands: string[] | null) => void;
  onLoad: () => void;
  onBack: () => void;
}) {
  const [resetting, setResetting] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const set = setting?.commands;
  const found = setting?.found;
  // The rows: the draft, else the check in use; one empty row when there is none.
  const base = set ?? found?.commands;
  const rows = draft ?? (base && base.length > 0 ? base : ['']);
  const edited = checksEdited(base, draft);
  const problem = edited ? checksProblem(rows) : null;
  const canSave = edited && !problem && !busy && setting !== null;

  /** Focuses the row at `index`'s field once it is drawn. */
  const focusRow = (index: number, part: 'input' | 'button' = 'input') =>
    requestAnimationFrame(() => {
      const row = list.current?.children[index];
      const target =
        part === 'input'
          ? row?.querySelector('input')
          : row?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      target?.focus();
    });
  const change = (index: number, text: string) =>
    onDraft(rows.map((c, i) => (i === index ? text : c)));
  const add = (at = rows.length) => {
    onDraft([...rows.slice(0, at), '', ...rows.slice(at)]);
    focusRow(at);
  };
  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onDraft(next.length > 0 ? next : ['']);
    focusRow(Math.min(index, next.length - 1));
  };
  const move = (index: number, by: -1 | 1) => {
    const to = index + by;
    const next = [...rows];
    [next[index], next[to]] = [next[to] ?? '', next[index] ?? ''];
    onDraft(next);
    focusRow(to, 'button');
  };

  const chip = (
    <span className={`settings-state${set ? ' changed' : ''}`}>
      {set ? "The project's" : found ? 'Found' : 'None'}
    </span>
  );
  const reset =
    set &&
    (resetting ? (
      <span className="workspace-confirm">
        merge.checks leaves {setting.file}.{' '}
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            setResetting(false);
            onSave(null);
          }}
        >
          Reset
        </button>{' '}
        <button type="button" className="button ghost" onClick={() => setResetting(false)}>
          Keep it
        </button>
      </span>
    ) : (
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        {...tip('Remove merge.checks: the check Symbiote finds runs')}
        onClick={() => setResetting(true)}
      >
        <ResetIcon /> Reset to found
      </button>
    ));

  return (
    <SettingsCard
      label="Checks"
      title={
        <>
          Checks
          {setting && chip}
        </>
      }
      actions={reset}
      onBack={onBack}
    >
      {error && (
        <p className="settings-warning" role="alert">
          {error}
        </p>
      )}
      {setting?.warning && (
        <p className="settings-warning" role="alert">
          {setting.warning}
        </p>
      )}
      {!setting && !error && <p className="hint">Reading the check…</p>}
      {setting && (
        <>
          <div className="settings-section">
            <h3>
              Commands
              <Help label="About the check">
                <p>
                  The merger runs it on the merged result before a merge lands, and Hive on every
                  commit of a Hive workspace: one check for both modes. The commands run in order in
                  the workspace&apos;s worktree; the first that fails stops it.
                </p>
                <p>
                  Saved in {setting.file} as <code>merge.checks</code>. Put an install first if the
                  check needs dependencies.
                </p>
              </Help>
            </h3>
            <p className="settings-about">
              {hive
                ? 'What Hive runs on every commit, and the merger before a merge lands. In order; the first that fails stops it.'
                : 'What the merger runs before a merge lands, and Hive on every commit while it is on. In order; the first that fails stops it.'}
            </p>
            {!set && (
              <p className="settings-row-note checks-source">
                {found ? (
                  <>
                    None is set: Symbiote runs the check it finds in <code>{found.source}</code>.
                    Change it to set your own.
                  </>
                ) : (
                  <>
                    None is set or found: a merge waits for you to land it
                    {hive ? '' : ', and Hive mode cannot turn on'}. Add the commands that check this
                    repository.
                  </>
                )}
              </p>
            )}
            <ol ref={list} className="checks-list" aria-label="Commands">
              {rows.map((command, index) => (
                <li key={index} className="checks-row">
                  <span className="checks-step" aria-hidden="true">
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    className="checks-command"
                    aria-label={`Command ${index + 1}`}
                    aria-invalid={problem !== null && command.trim() === '' && rows.length === 1}
                    value={command}
                    placeholder="pnpm check"
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => change(index, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        if (canSave) onSave(cleanCommands(rows));
                      } else if (event.key === 'Enter') {
                        event.preventDefault();
                        if (event.ctrlKey || event.metaKey) {
                          if (canSave) onSave(cleanCommands(rows));
                        } else add(index + 1);
                      }
                    }}
                  />
                  <span className="checks-tools">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move command ${index + 1} up`}
                      {...tip('Move up')}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUpIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move command ${index + 1} down`}
                      {...tip('Move down')}
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove command ${index + 1}`}
                      {...tip('Remove')}
                      disabled={rows.length === 1 && command === ''}
                      onClick={() => remove(index)}
                    >
                      <TrashIcon />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            <button type="button" className="button secondary checks-add" onClick={() => add()}>
              <PlusIcon /> Add a command
            </button>
            {problem && <p className="settings-size error">{problem}</p>}
          </div>
          <div className="settings-actions">
            {notice ? (
              <span className={`settings-notice${notice.error ? ' error' : ''}`} role="status">
                {notice.text}
                {notice.stale && (
                  <>
                    {' '}
                    <button type="button" className="link" onClick={onLoad}>
                      Read it again
                    </button>
                  </>
                )}
              </span>
            ) : (
              <span className="settings-git">{checkGitNote(setting)}</span>
            )}
            {edited && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={onDiscard}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              className="button"
              disabled={!canSave}
              {...tip("Save it in the project's config", { keys: 'Ctrl+S' })}
              onClick={() => onSave(cleanCommands(rows))}
            >
              Save changes
            </button>
          </div>
          {set && found && (
            <details className="settings-default">
              <summary>The check Symbiote finds</summary>
              <p className="settings-row-note">
                From <code>{found.source}</code>; it runs once merge.checks is reset.
              </p>
              <pre>{found.commands.join('\n')}</pre>
            </details>
          )}
        </>
      )}
    </SettingsCard>
  );
}
