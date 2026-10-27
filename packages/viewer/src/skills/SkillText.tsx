import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { markdownNodes, useMarkdown } from '../ui/markdown.js';
import { ChevronIcon, CollapseIcon, ExpandIcon } from '../ui/icons.js';
import { tip } from '../ui/tip.js';
import { linePieces, markdownLines, type LineKind } from './markdown-lines.js';
import { readSkill } from './skills.js';

/** What the text's box shows: the text to edit, or the skill drawn. */
type View = 'markdown' | 'preview';
const VIEWS: Record<View, string> = { markdown: 'Markdown', preview: 'Preview' };

/**
 * A skill's `SKILL.md` (V64, decision 460): the text area, its words transparent, over a drawn copy
 * of the same text with its line numbers and Markdown's colours. Both are one font, padding and
 * wrap, and the copy's pieces join back into each line (`markdown-lines.ts`), so a caret, a
 * selection and a wrapped line fall where the copy draws them. Over it at the top right: the view
 * (Markdown or Preview) and Expand (decision 461).
 */
export function SkillText({
  name,
  text,
  area,
  expanded,
  onText,
  onSave,
  onExpand,
}: {
  name: string;
  text: string;
  /** The text area, for the caret's line (Open in VS Code). */
  area: RefObject<HTMLTextAreaElement | null>;
  expanded: boolean;
  onText: (text: string) => void;
  /** Ctrl+S (⌘S). */
  onSave: () => void;
  onExpand: (expanded: boolean) => void;
}) {
  const [view, setView] = useState<View>('markdown');
  const lines = useMemo(() => markdownLines(text), [text]);
  // The numbers' column fits the last line's number, two digits at least.
  const digits = Math.max(2, String(lines.length).length);
  return (
    <div className="skills-code" style={{ '--digits': digits } as CSSProperties}>
      <div className="skills-code-tools">
        <ViewMenu view={view} onView={setView} />
        <button
          type="button"
          className="icon-button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-pressed={expanded}
          {...tip(expanded ? 'Back to the list and the checks' : 'The text over the whole page', {
            ...(expanded ? { keys: 'Esc' } : {}),
          })}
          onClick={() => onExpand(!expanded)}
        >
          {expanded ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>
      {view === 'preview' ? (
        <SkillPreview text={text} />
      ) : (
        <div className="skills-code-scroll">
          <div className="skills-code-body">
            <div className="skills-code-lines" aria-hidden="true">
              {lines.map((line, i) => (
                <CodeLine key={i} n={i + 1} text={line.text} kind={line.kind} />
              ))}
            </div>
            <textarea
              ref={area}
              aria-label={`${name} SKILL.md`}
              value={text}
              spellCheck={false}
              onChange={(event) => onText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 's' || !(event.ctrlKey || event.metaKey)) return;
                event.preventDefault();
                onSave();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** A line of the drawn copy: drawn again only when its text or its place changes. */
const CodeLine = memo(function CodeLine({
  n,
  text,
  kind,
}: {
  n: number;
  text: string;
  kind: LineKind;
}) {
  return (
    <div className={`skills-code-line ${kind}`}>
      <span className="skills-code-number">{n}</span>
      <span className="skills-code-text">
        {linePieces(text, kind).map((piece, i) => (
          <span key={i} className={piece.kind ? `md-${piece.kind}` : undefined}>
            {piece.text}
          </span>
        ))}
      </span>
    </div>
  );
});

/** Markdown ▾: the text to edit, or the skill drawn. */
function ViewMenu({ view, onView }: { view: View; onView: (view: View) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    // Esc closes the menu only: the page's Esc (Expand's) waits for the next one.
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="more-actions" ref={box}>
      <button
        type="button"
        className="skills-view-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {VIEWS[view]}
        <ChevronIcon open />
      </button>
      {open && (
        <div className="more-menu" role="menu" aria-label="View">
          {(['markdown', 'preview'] as const).map((each) => (
            <button
              key={each}
              type="button"
              role="menuitemradio"
              aria-checked={each === view}
              onClick={() => {
                setOpen(false);
                onView(each);
              }}
            >
              {VIEWS[each]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The skill as an agent's Markdown is drawn: its name and description, then its instructions. */
function SkillPreview({ text }: { text: string }) {
  const lexer = useMarkdown();
  const read = readSkill(text);
  const fields = typeof read.frontmatter === 'object' ? read.frontmatter.fields : null;
  const shown = (['name', 'description'] as const).flatMap((key) => {
    const value = fields?.get(key);
    return value?.kind === 'text' ? [[key, value.value] as const] : [];
  });
  return (
    <div className="skills-preview markdown" tabIndex={0}>
      {shown.length > 0 && (
        <dl className="skills-preview-front">
          {shown.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {read.body.trim() === '' ? (
        <p className="hint">No instructions after the frontmatter yet.</p>
      ) : lexer ? (
        markdownNodes(lexer(read.body))
      ) : (
        <p>{read.body}</p>
      )}
    </div>
  );
}
