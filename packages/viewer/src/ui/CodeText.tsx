// A diff's code in its colours (V93, decision 889): each row's text as `syntax.ts` tokenizes it,
// the rows of one file read in order, so a block comment carries to the next row.
import { useMemo } from 'react';
import { languageOf, tokenizeLines, type Token } from './syntax.js';

/** Each row's tokens, by the row, for the rows of `path`; none for a language not read. */
export function useTokens<Row extends { text: string }>(
  rows: readonly Row[],
  path: string | undefined,
): ReadonlyMap<Row, Token[]> | null {
  return useMemo(() => {
    const lang = path ? languageOf(path) : null;
    if (!lang) return null;
    const tokens = tokenizeLines(
      rows.map((row) => row.text),
      lang,
    );
    return new Map(rows.map((row, i) => [row, tokens[i] ?? []]));
  }, [rows, path]);
}

/** A row's text: its tokens as spans of their kind, else the text alone. */
export function CodeText({ text, tokens }: { text: string; tokens?: Token[] | undefined }) {
  if (!tokens) return <span className="text">{text}</span>;
  return (
    <span className="text">
      {tokens.map((token, i) =>
        token.kind ? (
          <span key={i} className={`tok-${token.kind}`}>
            {token.text}
          </span>
        ) : (
          token.text
        ),
      )}
    </span>
  );
}
