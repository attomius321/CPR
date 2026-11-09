// The brief's fields on Start (V18, V24c; V93, proof 06): what the server makes the agent's brief
// of, and the goal's Markdown preview (V63).
import { useState, type ReactNode, type RefObject } from 'react';
import type { BriefPart, CheckGuess, WorkKindSpec, WorkspaceOptions } from '@symbiote/core';
import { HINTS, morePartsOf, checkWords, type BriefForm } from './brief.js';
import { AttachIcon, ChevronIcon, ChoreIcon, MarkdownIcon } from '../ui/icons.js';
import { markdownNodes, useMarkdown } from '../ui/markdown.js';
import { HiveCheckLine, useHiveCheck } from './StartHive.js';
import { tip } from '../ui/tip.js';

/** The goal (or a kind's main part) as Markdown, as the agent's brief will be drawn (V63). */
function GoalPreview({ text }: { text: string }) {
  const lexer = useMarkdown();
  return (
    <div className="start-preview markdown" tabIndex={0}>
      {text.trim() === '' ? (
        <p className="start-preview-empty">Nothing to preview yet.</p>
      ) : lexer ? (
        markdownNodes(lexer(text))
      ) : (
        <p>{text}</p>
      )}
    </div>
  );
}

/**
 * The brief's fields (V93, proof 06): its title, its main part with the goal's tools (attach,
 * preview as Markdown, the length), Done when, the check, the more parts folded, its documents.
 */
export function StartBrief({
  form,
  edit,
  spec,
  options,
  main,
  mainHeading,
  heading,
  picker,
  length,
  tooLong,
  guess,
  hive,
  hiveCheck,
  documentsCard,
}: {
  form: BriefForm;
  edit: (next: BriefForm) => void;
  spec: WorkKindSpec;
  options: Pick<WorkspaceOptions, 'branchPrefixes' | 'maxBrief'>;
  /** The kind's one part a start needs, and its heading. */
  main: BriefPart;
  mainHeading: string;
  heading: (part: string) => string;
  /** The page's one file picker: Documents' Add files, and the goal's 📎. */
  picker: RefObject<HTMLInputElement | null>;
  length: number;
  tooLong: boolean;
  guess: CheckGuess | null;
  hive: boolean;
  hiveCheck: ReturnType<typeof useHiveCheck>;
  documentsCard: ReactNode;
}) {
  const [moreShown, setMoreShown] = useState(false);
  // The goal shown as Markdown (V63), until written again.
  const [previewing, setPreviewing] = useState(false);
  const more = morePartsOf(spec);
  const moreText = more.some((part) => (form.more[part] ?? '').trim() !== '');
  const moreOpen = moreShown || moreText;
  return (
    <div className="start-form">
      <div className="workspace-field">
        <label
          htmlFor="start-name"
          {...tip(
            `The workspace's name in Symbiote; its branch is named after it (${options.branchPrefixes[form.kind]}…) until you type another`,
          )}
        >
          Title
        </label>
        <input
          id="start-name"
          type="text"
          name="title"
          autoFocus
          autoComplete="off"
          value={form.title}
          placeholder="A short name: the workspace's and its branch's"
          onChange={(event) => edit({ ...form, title: event.target.value })}
        />
      </div>
      <div className="workspace-field">
        <label
          htmlFor="start-main"
          {...tip(
            'What the agent reads first, and the one part a start needs; kept as you write it, Markdown and all',
          )}
        >
          {mainHeading}
        </label>
        <div className="start-goal-frame">
          {previewing ? (
            <GoalPreview text={form.main} />
          ) : (
            <textarea
              id="start-main"
              className="start-goal"
              rows={7}
              value={form.main}
              placeholder={HINTS[main]}
              onChange={(event) => edit({ ...form, main: event.target.value })}
            />
          )}
          <div className="start-goal-tools" role="toolbar" aria-label={`${mainHeading} tools`}>
            <button
              type="button"
              className="icon-button"
              aria-label="Attach files"
              {...tip('Add files to the documents')}
              onClick={() => picker.current?.click()}
            >
              <AttachIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Preview"
              aria-pressed={previewing}
              {...tip(previewing ? 'Write' : 'Preview as Markdown')}
              onClick={() => setPreviewing(!previewing)}
            >
              <MarkdownIcon />
            </button>
            <span
              className={tooLong ? 'start-count error' : 'start-count'}
              {...tip("The brief's length: the title and every part")}
            >
              {length.toLocaleString('en')} / {options.maxBrief.toLocaleString('en')}
            </span>
          </div>
        </div>
      </div>
      <div className="workspace-field">
        <label
          htmlFor="start-done"
          {...tip('How the agent knows it is done: a check it can run (a test, a command) is best')}
        >
          Done when <span className="field-optional">(optional)</span>
        </label>
        <textarea
          id="start-done"
          rows={3}
          value={form.doneWhen}
          placeholder={`${HINTS.doneWhen} e.g. ${checkWords(guess)}, and …`}
          onChange={(event) => edit({ ...form, doneWhen: event.target.value })}
        />
      </div>
      {hive ? (
        <HiveCheckLine check={hiveCheck} />
      ) : (
        guess && (
          <p className="start-check-line workspace-check-guess">
            <ChoreIcon />
            The merge&apos;s check: <code>{guess.command}</code>{' '}
            <span>
              from <span className="mono">{guess.source}</span>
            </span>
          </p>
        )
      )}
      <div className={moreOpen ? 'start-more open' : 'start-more'}>
        <button
          type="button"
          className="start-more-toggle"
          aria-expanded={moreOpen}
          aria-label={`More: ${more.map(heading).join(', ')}, optional`}
          onClick={() => setMoreShown(!moreOpen)}
        >
          <ChevronIcon open={moreOpen} />
          <span className="start-more-words">
            {more
              .map(heading)
              .join(', ')
              .toLowerCase()
              .replace(/^./, (c) => c.toUpperCase())}
          </span>
          <span className="start-chip">optional</span>
        </button>
        {moreOpen &&
          more.map((part) => (
            <label key={part} className="workspace-field">
              {heading(part)}
              <textarea
                rows={2}
                value={form.more[part] ?? ''}
                placeholder={HINTS[part]}
                onChange={(event) =>
                  edit({ ...form, more: { ...form.more, [part]: event.target.value } })
                }
              />
            </label>
          ))}
      </div>
      {documentsCard}
      {tooLong && (
        <p className="error start-too-long">
          The brief is {length.toLocaleString('en')} characters; at most{' '}
          {options.maxBrief.toLocaleString('en')}.
        </p>
      )}
    </div>
  );
}
