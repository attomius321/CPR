// One prompt in Settings: its text to change, its placeholders, Save and Reset, and what the page
// says after either.
import { useLayoutEffect, useRef, useState } from 'react';
import type { PromptKey, PromptSetting } from '@symbiote/core';
import { draftProblem, insertAt, isEdited, sizeOf, agentName } from './settings.js';
import { useAlphaCeph } from '../shell/names.js';
import { tip } from '../ui/tip.js';
import { ResetIcon } from '../ui/icons.js';
import { SettingsCard } from './SettingsCard.js';

/** What the page says after a save or a reset, under that prompt. */
export interface Notice {
  key: PromptKey;
  text: string;
  error?: boolean;
  /** The file changed since it was read (409): load it again, the drafts kept. */
  stale?: boolean;
}

/**
 * One prompt: its text to change, its placeholders, Save and Reset. A page of its own, its name,
 * chip and Reset in the card's head; or a section of its agent's page (`part`), those on its first
 * line (V62, the person's mockup). What it is and what its placeholders are is said under their
 * headings.
 */
export function PromptEditor({
  prompt,
  part,
  name = prompt.title,
  draft,
  busy,
  notice,
  note,
  onDraft,
  onDiscard,
  onSave,
  onLoad,
  onBack,
}: {
  prompt: PromptSetting;
  part?: boolean;
  /** Its section's name on an agent's page: the prompt's title, or the page's word for it. */
  name?: string | undefined;
  draft: string | undefined;
  busy: boolean;
  notice: Notice | null;
  /** Where a save goes and whether it is shared (`gitNote`), beside Save until one says more. */
  note: string | null;
  onDraft: (text: string) => void;
  onDiscard: () => void;
  /** The text to save; null for Symbiote's. */
  onSave: (text: string | null) => void;
  onLoad: () => void;
  onBack: () => void;
}) {
  // Nucleus's group by its name: Alpha Ceph's while Hive mode is on (decision 682).
  const group = agentName(prompt.group, useAlphaCeph());
  const text = draft ?? prompt.text;
  const edited = isEdited(prompt, draft);
  const problem = draftProblem(prompt, text);
  const [resetting, setResetting] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const canSave = edited && !problem && !busy;
  // As tall as its text, wrapped lines too, up to 70 % of the window (its CSS max-height).
  useLayoutEffect(() => {
    const field = area.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + 2}px`;
  }, [text]);

  const insert = (name: string) => {
    const field = area.current;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? text.length;
    const next = insertAt(text, start, end, `{${name}}`);
    onDraft(next.text);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const chip = (
    <span className={`settings-state${prompt.changed ? ' changed' : ''}`}>
      {prompt.changed ? "The project's" : "Symbiote's"}
    </span>
  );
  const reset =
    prompt.changed &&
    (resetting ? (
      <span className="workspace-confirm">
        The project&apos;s text leaves {`prompts.${prompt.key}`}.{' '}
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
        onClick={() => setResetting(true)}
      >
        <ResetIcon /> Reset to default
      </button>
    ));
  // On its own page the prompt's text is a section under "Prompt"; on its agent's, the section is
  // the prompt's own, and its placeholders' heading one level down.
  const Sub = part ? 'h4' : 'h3';
  const body = (
    <>
      {prompt.warning && (
        <p className="settings-warning" role="alert">
          {prompt.warning}
        </p>
      )}
      <div className="settings-section">
        {!part && <h3>Prompt</h3>}
        <p className="settings-about">{prompt.about}</p>
        <textarea
          ref={area}
          aria-label={`${prompt.title} prompt`}
          value={text}
          spellCheck={false}
          rows={4}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            const saving =
              (event.key === 's' && (event.ctrlKey || event.metaKey)) ||
              (event.key === 'Enter' && (event.ctrlKey || event.metaKey));
            if (!saving) return;
            event.preventDefault();
            if (canSave) onSave(text);
          }}
        />
        <p className={`settings-size${problem ? ' error' : ''}`}>
          {problem ?? sizeOf(prompt, text)}
        </p>
        {prompt.fixed && (
          <div className="settings-fixed">
            <p>Symbiote adds this after it, as the answer it reads; it cannot be changed:</p>
            <pre>{prompt.fixed}</pre>
          </div>
        )}
      </div>
      {prompt.placeholders.length > 0 ? (
        <div className="settings-section settings-placeholders">
          <Sub>Placeholders</Sub>
          <p className="settings-about">
            Each is filled in when the prompt is used; click one to insert it at the cursor.
          </p>
          <ul>
            {prompt.placeholders.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  className="link"
                  {...tip('Insert it at the cursor')}
                  onClick={() => insert(p.name)}
                >
                  {`{${p.name}}`}
                </button>
                <span>
                  {p.about}
                  {p.required && <strong> (required)</strong>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="settings-section settings-about">
          No placeholders: the agent is given it as written.
        </p>
      )}
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
          note && <span className="settings-git">{note}</span>
        )}
        {edited && (
          <button type="button" className="button secondary" disabled={busy} onClick={onDiscard}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="button"
          disabled={!canSave}
          {...tip("Save it in the project's config", { keys: 'Ctrl+S' })}
          onClick={() => onSave(text)}
        >
          Save changes
        </button>
      </div>
      {prompt.changed && (
        <details className="settings-default">
          <summary>Symbiote&apos;s text</summary>
          <pre>{prompt.default}</pre>
        </details>
      )}
    </>
  );
  return part ? (
    <section className="settings-part settings-prompt" aria-label={name}>
      <div className="settings-part-head">
        <h3>
          {name}
          {chip}
        </h3>
        {reset}
      </div>
      {body}
    </section>
  ) : (
    <SettingsCard
      label={`${group}: ${prompt.title}`}
      title={
        <>
          {`${group}: ${prompt.title}`}
          {chip}
        </>
      }
      actions={reset}
      onBack={onBack}
    >
      {body}
    </SettingsCard>
  );
}
