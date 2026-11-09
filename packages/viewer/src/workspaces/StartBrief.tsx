import { markdownNodes, useMarkdown } from '../ui/markdown.js';

/** The goal (or a kind's main part) as Markdown, as the agent's brief will be drawn (V63). */
export function GoalPreview({ text }: { text: string }) {
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
