import type { RefObject } from 'react';
import type { WorkspaceOptions } from '@symbiote/core';
import { Help } from '../ui/Help.js';
import { CloseIcon, DocumentsIcon, FileIcon, ImageIcon, PlusIcon } from '../ui/icons.js';
import { documentSize, isImageName, type DocumentEntry } from './documents.js';
import { StartCard } from './StartCard.js';
import { tip } from '../ui/tip.js';

/**
 * The start page's Documents (V40), the run's last card since V63: the files given with the
 * brief, each listed with its size once kept, "Adding…" on its way, or why it was not added; ✕
 * takes one off. Add files picks more (`input`, the page's one picker: the goal's 📎 opens it
 * too); a drop or a paste anywhere on the page adds them as well (StartPage).
 */
export function StartDocuments({
  entries,
  options,
  folder,
  input,
  onAdd,
  onRemove,
}: {
  entries: readonly DocumentEntry[];
  options: WorkspaceOptions['documents'];
  /** Where they will go, for this branch. */
  folder: string;
  input: RefObject<HTMLInputElement | null>;
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <StartCard
      icon={<DocumentsIcon />}
      id="start-documents-label"
      className="start-documents-card"
      title={
        <>
          Documents <span className="field-optional">(optional)</span>
        </>
      }
      help={
        <Help label="About documents">
          <p>
            Files for the agent: screenshots, PDFs, notes, samples. At the start they go beside the
            workspace&apos;s record, in <code>{folder}</code>, and its first prompt names each one.
          </p>
          <p>
            Up to {options.maxFiles} files, {documentSize(options.maxBytes)} each,{' '}
            {documentSize(options.maxTotal)} in all. Clean up removes them.
          </p>
        </Help>
      }
    >
      {entries.length > 0 && (
        <ul className="start-documents">
          {entries.map((entry) => (
            <li key={entry.key} className={entry.state === 'failed' ? 'failed' : undefined}>
              {isImageName(entry.name) ? <ImageIcon /> : <FileIcon />}
              <span className="start-document-name" {...tip(entry.name)}>
                {entry.name}
              </span>
              <span className="start-document-state">
                {entry.state === 'uploading'
                  ? 'Adding…'
                  : entry.state === 'failed'
                    ? entry.error
                    : documentSize(entry.size)}
              </span>
              <button
                type="button"
                className="start-document-remove"
                aria-label={`Remove ${entry.name}`}
                {...tip('Remove')}
                onClick={() => onRemove(entry.key)}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="start-documents-add">
        <button type="button" className="button secondary" onClick={() => input.current?.click()}>
          <PlusIcon /> Add files
        </button>
        <span className="start-documents-hint">or drop or paste them</span>
        <p className="start-documents-about">Add context files, docs, mockups, or requirements.</p>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label="Add files"
          onChange={(event) => {
            onAdd(Array.from(event.target.files ?? []));
            // The same file picked again is a change.
            event.target.value = '';
          }}
        />
      </div>
    </StartCard>
  );
}
