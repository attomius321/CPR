// A workspace's Brief tab (V29a): what its agent was told, how it was started, its documents.
import type { WorkspaceSummary } from '@symbiote/core';
import { FileIcon, ImageIcon } from '../ui/icons.js';
import { markdownNodes, useMarkdown } from '../ui/markdown.js';
import { isImageName } from './documents.js';

/**
 * What the agent was told — since V24 the kind and title as `#`, each part under `##` — drawn as
 * Markdown, as its reports are; as written until the lexer is loaded. Above it, how the agent was
 * started (V30b).
 */
export function BriefTab({
  text,
  started,
  documents,
  removed = false,
}: {
  text: string;
  started: string | null;
  /** The files given with it (V40). */
  documents: WorkspaceSummary['documents'];
  /** Clean up removed them, their names kept (a finished workspace's, V77). */
  removed?: boolean;
}) {
  const lexer = useMarkdown();
  return (
    <div className="workspace-brief">
      {started && <p className="workspace-started">{started}</p>}
      {lexer ? (
        <div className="markdown">{markdownNodes(lexer(text))}</div>
      ) : (
        <div className="workspace-brief-text">{text}</div>
      )}
      {documents && (
        <section className="workspace-documents" aria-label="Documents">
          <h2>
            Documents <span className="count">{documents.files.length}</span>
          </h2>
          <p className="workspace-documents-folder">
            {removed ? (
              'Removed when it was cleaned up'
            ) : (
              <>
                In <code>{documents.folder}</code>
              </>
            )}
          </p>
          <ul>
            {documents.files.map((name) => (
              <li key={name}>
                {isImageName(name) ? <ImageIcon /> : <FileIcon />} {name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
