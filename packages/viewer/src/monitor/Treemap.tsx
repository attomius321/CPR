import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { percent, type CodeNode } from './codemap.js';
import { layoutTreemap, type Tile } from './treemap.js';

const count = (value: number) => value.toLocaleString('en-US');

/**
 * The folder in view as a squarified treemap, two levels deep (RM1, decision 324): area is lines
 * of code, colour the file's kind. Laid out again when the folder or the box's size changes,
 * never on hover or selection (the viewer's rule): those only change classes.
 */
export function Treemap({
  node,
  hovered,
  selected,
  onHover,
  onPick,
}: {
  node: CodeNode;
  /** The tile or row under the pointer, by id. */
  hovered: string | null;
  /** The file picked, by path. */
  selected: string | null;
  onHover: (tile: Tile | null) => void;
  onPick: (tile: Tile) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const tiles = useMemo(() => layoutTreemap(node, size.w, size.h), [node, size.w, size.h]);
  const byId = useMemo(() => new Map(tiles.map((tile) => [tile.id, tile])), [tiles]);

  // One listener for every tile: the tile is the element's `data-id`.
  const tileAt = (event: MouseEvent) =>
    byId.get((event.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id ?? '') ??
    null;

  return (
    <div
      ref={box}
      className="monitor-map"
      onMouseOver={(event) => onHover(tileAt(event))}
      onMouseLeave={() => onHover(null)}
      onClick={(event) => {
        const tile = tileAt(event);
        if (tile) onPick(tile);
      }}
    >
      {tiles.map((tile) => (
        <div
          key={tile.id}
          data-id={tile.id}
          className={[
            'monitor-tile',
            `type-${tile.type}`,
            tile.kind ? `kind-${tile.kind}` : '',
            tile.id === hovered ? 'hovered' : '',
            tile.type === 'file' && tile.path === selected ? 'selected' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ left: tile.x, top: tile.y, width: tile.w, height: tile.h }}
        >
          {tile.type === 'frame' ? (
            tile.label !== 'none' && (
              <div className="monitor-band">
                <span className="monitor-tile-name">{tile.name}</span>
                <span className="monitor-tile-lines">{percent(tile.lines / node.lines)}</span>
              </div>
            )
          ) : (
            <>
              {tile.label !== 'none' && (
                <span className="monitor-tile-name">
                  {tile.name}
                  {tile.type === 'folder' ? '/' : ''}
                </span>
              )}
              {tile.label === 'full' && (
                <span className="monitor-tile-lines">{count(tile.lines)}</span>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
