import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { CodeFile, CodeMap, FileKind } from '@symbiote/monitor';
import { Help } from '../ui/Help.js';
import { getJson, postJson, serverWords } from '../ui/http.js';
import { BackIcon } from '../ui/icons.js';
import { keyIsTaken } from '../ui/keys.js';
import { Resizer } from '../ui/Resizer.js';
import { loadWidths, saveWidth } from '../ui/widths.js';
import { useShell } from '../shell/shell-context.js';
import { CodeList, type ListTab } from './CodeList.js';
import {
  codeTree,
  concentration,
  crumbs,
  HEAT,
  headline,
  KINDS,
  percent,
  type CodeNode,
  type Colour,
} from './codemap.js';
import { TreemapView } from './TreemapView.js';
import type { Tile } from './treemap.js';
import { tip } from '../ui/tip.js';

const API = '/api/monitor';

/** What the details show: a tile's or a row's node, or a folder's smaller files. */
interface Spot {
  id: string;
  name: string;
  path: string;
  lines: number;
  files: number;
  folder: boolean;
  more: boolean;
  file?: CodeFile;
}

const count = (value: number) => value.toLocaleString('en-US');

/** The headline's words, its numbers in the text's colour (RM2): the figures stand out. */
const figures = (words: string) =>
  words.split(/(\d[\d,]*(?:\u00a0%)?)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="monitor-figure">
        {part}
      </span>
    ) : (
      part
    ),
  );

/** Why a file is set aside, in words. */
const ASIDE: Record<NonNullable<CodeFile['aside']>, string> = {
  binary: 'not text',
  lockfile: "a package manager's lockfile",
  generated: 'linguist-generated in .gitattributes',
  vendored: 'linguist-vendored in .gitattributes',
  ignored: 'left out by .symbioteignore or its defaults',
  minified: 'minified',
};

const spotOfNode = (node: CodeNode): Spot => ({
  id: node.path,
  name: node.name,
  path: node.path,
  lines: node.lines,
  files: node.files,
  folder: !!node.children,
  more: false,
  ...(node.file ? { file: node.file } : {}),
});

/**
 * The Monitor page (RM1): where the checked-out commit's code is. The folder in view as the
 * heading with Back before it (RM2), the concentration in words, a treemap of the folder (zoomed
 * by click; back by Back, the breadcrumbs, Backspace or Escape), long files in heat, and the
 * ranked list beside it; the folder is in the address (`?path=`).
 */
export function MonitorPage({ path = '' }: { path?: string | undefined }) {
  const shell = useShell();
  const [map, setMap] = useState<CodeMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kinds, setKinds] = useState<ReadonlySet<FileKind>>(() => new Set(['source']));
  const [colour, setColour] = useState<Colour>('lines');
  const [tab, setTab] = useState<ListTab>('children');
  const [hovered, setHovered] = useState<Spot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ text: string; error?: boolean } | null>(null);
  const [width, setWidth] = useState(() => loadWidths().monitor);
  const [resizing, setResizing] = useState(false);
  const colourLabel = useId();

  useEffect(() => {
    let live = true;
    getJson<CodeMap>(API)
      .then((read) => live && setMap(read))
      .catch((failed: unknown) => live && setError(serverWords((failed as Error).message)));
    return () => {
      live = false;
    };
  }, []);

  const tree = useMemo(() => (map ? codeTree(map.files, kinds) : null), [map, kinds]);
  const trail = useMemo(() => (tree ? crumbs(tree, path) : []), [tree, path]);
  const node = trail.at(-1);
  const index = useMemo(() => {
    const nodes = new Map<string, CodeNode>();
    const walk = (n: CodeNode) => {
      nodes.set(n.path, n);
      n.children?.forEach(walk);
    };
    if (tree) walk(tree);
    return nodes;
  }, [tree]);
  /** Each kind's lines: the chips' counts. */
  const totals = useMemo(() => {
    const lines = new Map<FileKind, number>();
    for (const file of map?.files ?? [])
      lines.set(file.kind, (lines.get(file.kind) ?? 0) + file.code);
    return lines;
  }, [map]);
  const unit = [...kinds].every((k) => k === 'source' || k === 'test') ? 'lines of code' : 'lines';

  const go = useCallback(
    (to: string) => {
      setSelected(null);
      setHovered(null);
      setOpened(null);
      shell?.navigate({ page: 'monitor', ...(to ? { path: to } : {}) });
    },
    [shell],
  );

  // Backspace goes up a folder; Escape lets go of the file picked, else goes up (RM2).
  const up = trail.at(-2);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (keyIsTaken(event)) return;
      if (event.key === 'Escape' && selected) setSelected(null);
      else if ((event.key === 'Backspace' || event.key === 'Escape') && up) go(up.path);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [up, selected, go]);

  const toggle = (kind: FileKind) =>
    setKinds((on) => {
      const next = new Set(on);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const pickTile = (tile: Tile) => {
    if (tile.type === 'file') setSelected(tile.path === selected ? null : tile.path);
    else if (tile.path !== node?.path) go(tile.path);
  };
  const pickNode = (picked: CodeNode) => {
    if (picked.children) go(picked.path);
    else setSelected(picked.path === selected ? null : picked.path);
  };
  const hoverTile = (tile: Tile | null) =>
    setHovered(
      tile && {
        id: tile.id,
        name: tile.name,
        path: tile.path,
        lines: tile.lines,
        files: tile.files,
        folder: tile.type === 'frame' || tile.type === 'folder',
        more: tile.type === 'more',
        ...(index.get(tile.path)?.file ? { file: index.get(tile.path)!.file! } : {}),
      },
    );
  const resize = useCallback((next: number | null) => {
    setWidth(next ?? undefined);
    saveWidth('monitor', next);
  }, []);

  const open = async (file: string) => {
    setOpened(null);
    try {
      const result = await postJson<{ line: number; moved: boolean }>(`${API}/open`, {
        path: file,
      });
      setOpened({ text: result.moved ? `Opened, at line ${result.line} now.` : 'Opened.' });
    } catch (failed) {
      setOpened({ text: (failed as Error).message, error: true });
    }
  };

  const selectedNode = selected ? index.get(selected) : undefined;
  const shown = hovered ?? (selectedNode ? spotOfNode(selectedNode) : null);
  const words = node ? headline(concentration(node), unit) : [];

  return (
    <div
      className={`monitor${resizing ? ' resizing' : ''}`}
      style={width ? ({ '--monitor-width': `${width}px` } as CSSProperties) : undefined}
    >
      <div className="commits-title settings-bar">
        <h1>Monitor</h1>
        <Help label="About the Monitor">
          <p>
            Where this checkout&apos;s code is: every file of the commit checked out, its area in
            the picture its lines of code — lines that are not blank and not only a comment.
          </p>
          <p>
            Click a folder to go in; Back, Backspace or Escape goes up a folder, the path to any
            folder above. The list ranks the same numbers; the line in it is where half of the code
            is reached.
          </p>
          <p>
            A file&apos;s colour is its length: yellow from 250 lines of code, orange from 500, red
            from 1,000. Colour: Kind gives each kind of file its own colour instead.
          </p>
        </Help>
        {map && (
          <span className="chip monitor-commit" {...tip(map.commit, { code: true })}>
            {map.branch ? `${map.branch} · ` : ''}
            {map.commit.slice(0, 7)}
          </span>
        )}
      </div>
      {error && (
        <p className="commits-error error" role="alert">
          {error}
        </p>
      )}
      {!map && !error && <p className="main-hint">Reading the commit&apos;s files…</p>}
      {map && tree && node && (
        <>
          <div className="monitor-head">
            <div className="monitor-tools">
              <div className="monitor-kinds" role="group" aria-label="What counts">
                {KINDS.map(({ kind, label }) => (
                  <button
                    key={kind}
                    type="button"
                    className="monitor-kind"
                    aria-pressed={kinds.has(kind)}
                    onClick={() => toggle(kind)}
                  >
                    <span className={`monitor-swatch kind-${kind}`} aria-hidden="true" />
                    {label}
                    <span className="monitor-kind-lines">{count(totals.get(kind) ?? 0)}</span>
                  </button>
                ))}
              </div>
              <div className="monitor-colour">
                <span className="monitor-tools-label" id={colourLabel}>
                  Colour
                </span>
                <span className="scopes" role="group" aria-labelledby={colourLabel}>
                  {(
                    [
                      ['lines', 'Lines'],
                      ['kind', 'Kind'],
                    ] as const
                  ).map(([choice, label]) => (
                    <button
                      key={choice}
                      type="button"
                      className={colour === choice ? 'scope active' : 'scope'}
                      aria-pressed={colour === choice}
                      onClick={() => setColour(choice)}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </div>
            </div>
            <div className="monitor-place">
              <button
                type="button"
                className="icon-button monitor-back"
                aria-label={up ? `Back to ${up.name || 'All files'}` : 'Back'}
                {...tip(up ? `Back to ${up.name || 'All files'}` : 'Back', { keys: 'Backspace' })}
                disabled={!up}
                onClick={() => up && go(up.path)}
              >
                <BackIcon />
              </button>
              <nav className="monitor-crumbs" aria-label="Folder in view">
                {trail.map((folder, i) =>
                  i === trail.length - 1 ? (
                    <span key={folder.path} aria-current="page">
                      {folder.name || 'All files'}
                    </span>
                  ) : (
                    <span key={folder.path}>
                      <button type="button" className="link" onClick={() => go(folder.path)}>
                        {folder.name || 'All files'}
                      </button>
                      <span className="monitor-crumb-sep" aria-hidden="true">
                        /
                      </span>
                    </span>
                  ),
                )}
              </nav>
              {colour === 'lines' && (
                <div className="monitor-legend" role="group" aria-label="Lines in a file">
                  <span className="monitor-tools-label">Lines in a file</span>
                  <span className="monitor-legend-step">
                    <span className="monitor-swatch kind-source" aria-hidden="true" />
                    under {count(HEAT[0])}
                  </span>
                  {HEAT.map((bound, i) => (
                    <span key={bound} className="monitor-legend-step">
                      <span className={`monitor-swatch heat-${i + 1}`} aria-hidden="true" />
                      {count(bound)}
                      {i === HEAT.length - 1 ? '+' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <p className="monitor-headline">
              {words.length > 0
                ? figures(words.join(' '))
                : 'No lines of the kinds turned on here.'}
            </p>
          </div>
          <div className="monitor-body">
            <TreemapView
              node={node}
              colour={colour}
              hovered={hovered?.id ?? null}
              selected={selected}
              onHover={hoverTile}
              onPick={pickTile}
            />
            <Resizer
              label="Resize the ranked list"
              side="after"
              variable="--monitor-width"
              min={260}
              room={320}
              onResize={resize}
              onDrag={setResizing}
            />
            <aside className="monitor-side">
              <CodeList
                node={node}
                colour={colour}
                tab={tab}
                onTab={setTab}
                hovered={hovered?.id ?? null}
                selected={selected}
                onHover={(row) => setHovered(row && spotOfNode(row))}
                onPick={pickNode}
              />
              <Details
                spot={shown}
                folder={node}
                total={tree.lines}
                unit={unit}
                picked={selectedNode?.file ? selectedNode.path : null}
                onOpen={(file) => void open(file)}
                opened={opened}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

/** The numbers of what is under the pointer, else of the file picked (details on demand). */
function Details({
  spot,
  folder,
  total,
  unit,
  picked,
  onOpen,
  opened,
}: {
  spot: Spot | null;
  folder: CodeNode;
  total: number;
  unit: string;
  picked: string | null;
  onOpen: (file: string) => void;
  opened: { text: string; error?: boolean } | null;
}) {
  let body: ReactNode;
  if (!spot) {
    body = (
      <p className="monitor-details-hint">
        Point at a tile or a row for its numbers; click a file to keep them here.
      </p>
    );
  } else {
    const file = spot.file;
    body = (
      <>
        <p className="monitor-details-name">
          {spot.name}
          {spot.folder ? '/' : ''}
        </p>
        {spot.path && !spot.more && <p className="monitor-details-path">{spot.path}</p>}
        <dl className="monitor-details-numbers">
          <dt>Lines</dt>
          <dd>
            {count(spot.lines)} {unit}
            {spot.folder || spot.more ? ` in ${count(spot.files)} files` : ''}
          </dd>
          {file && (
            <>
              <dt>Also</dt>
              <dd>
                {count(file.comments)} comment lines, {count(file.blank)} blank
              </dd>
              <dt>Language</dt>
              <dd>{file.language}</dd>
              {file.aside && (
                <>
                  <dt>Set aside</dt>
                  <dd>{ASIDE[file.aside]}</dd>
                </>
              )}
            </>
          )}
          <dt>Share</dt>
          <dd>
            {percent(spot.lines / Math.max(1, folder.lines))} of {folder.name || 'all files'}
            {folder.path ? ` · ${percent(spot.lines / Math.max(1, total))} of all` : ''}
          </dd>
        </dl>
      </>
    );
  }
  return (
    <section className="monitor-details" aria-label="Details" aria-live="polite">
      {body}
      {picked && (!spot || spot.path === picked) && (
        <div className="monitor-details-actions">
          <button type="button" className="button secondary" onClick={() => onOpen(picked)}>
            Open in VS Code
          </button>
          {opened && (
            <span className={opened.error ? 'error' : 'monitor-details-hint'} role="status">
              {opened.text}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
