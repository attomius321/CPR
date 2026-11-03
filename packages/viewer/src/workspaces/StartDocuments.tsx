import type { RefObject } from 'react';
import type { WorkspaceOptions } from '@symbiote/core';
import { AttachIcon, CloseIcon, FileIcon, ImageIcon, PlusIcon } from '../ui/icons.js';
import { documentSize, isImageName, type DocumentEntry } from './documents.js';
import { tip } from '../ui/tip.js';
import { Loading } from '../ui/Loading.js';

/**
 * The start page's Documents (V40): a row in the brief since V93 (the run's last card from V63),
 * the files given with the brief, each listed with its size once kept, "Adding…" on its way, or why it was not added; ✕
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
  // One row in the brief (V93, proofs 05-new-goal and 06-start): what it is, Add files at its end;
  // the files listed under it.
  return (
    <div className="start-documents-card" role="group" aria-labelledby="start-documents-label">
      <div className="start-documents-row">
        <AttachIcon />
        <span
          id="start-documents-label"
          className="start-documents-name"
          {...tip(
            `Files for the agent: screenshots, PDFs, notes, samples. At the start they go beside the workspace's record, in ${folder}, and its first prompt names each one.\nUp to ${options.maxFiles} files, ${documentSize(options.maxBytes)} each, ${documentSize(options.maxTotal)} in all; drop or paste them anywhere on the page. Clean up removes them.`,
          )}
        >
          Documents
        </span>
        <span className="start-documents-hint">(optional) mockups, specs, logs</span>
        <button
          type="button"
          className="button secondary small start-documents-add"
          onClick={() => input.current?.click()}
        >
          <PlusIcon /> Add files
        </button>
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
      {entries.length > 0 && (
        <ul className="start-documents">
          {entries.map((entry) => (
            <li key={entry.key} className={entry.state === 'failed' ? 'failed' : undefined}>
              {isImageName(entry.name) ? <ImageIcon /> : <FileIcon />}
              <span className="start-document-name" {...tip(entry.name)}>
                {entry.name}
              </span>
              <span className="start-document-state">
                {entry.state === 'uploading' ? (
                  <Loading inline>Adding…</Loading>
                ) : entry.state === 'failed' ? (
                  entry.error
                ) : (
                  documentSize(entry.size)
                )}
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
    </div>
  );
}
