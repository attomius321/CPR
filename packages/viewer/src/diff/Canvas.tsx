// A diff's canvas (V6, V8): the graph React Flow draws, the map below `MAP_ZOOM`, fewer edges while
// the view moves, and the selection brought into view.
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  useStore,
  useStoreApi,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { FileNode } from '../graph/FileNode.js';
import {
  edgesToDraw,
  projectAt,
  type FlowEdge,
  type FlowNode,
  type SymbolData,
} from '../graph/flow.js';
import { MAP_ZOOM, mapZoomStyle } from '../graph/mapzoom.js';
import { ProjectNode } from '../graph/ProjectNode.js';
import { SummaryNode } from '../graph/SummaryNode.js';
import { SymbolNode } from '../graph/SymbolNode.js';
import { useTheme } from '../shell/theme.js';

const nodeTypes = {
  symbol: SymbolNode,
  file: FileNode,
  summary: SummaryNode,
  project: ProjectNode,
};

interface CanvasProps {
  /** Decorated: reviewed marks and the selection. */
  nodes: FlowNode[];
  /** The layout's: the canvas picks and decorates those it draws (`edgesToDraw`). */
  edges: FlowEdge[];
  fileEdges: FlowEdge[];
  /** The undecorated layout: it changes only when what is drawn changes. */
  layoutNodes: FlowNode[];
  /** A layout for a newer view is being made: this one stays until it arrives. */
  pending: boolean;
  selected: string | null;
  /** In focus mode the whole (small) neighbourhood is fitted; otherwise the selection is centered.
   * */
  focus: boolean;
  /** The one project shown (by folder), or null: a new one is fitted as a whole, once. */
  scope: string | null;
  /** A panel beside it is being dragged wider or narrower. */
  resizing: boolean;
  onSelect: (id: string | null) => void;
  onToggleSummary: (id: string) => void;
  /** Symbols to bring into view: a group just shown or hidden. */
  reveal: string[] | null;
}

/** How long after React Flow's end of a move the edges come back, unless it moves again. */
const MOVE_END_DELAY = 100;
/** Nothing uses edge clicks or hovers: no invisible wide path beside each edge. */
const EDGE_OPTIONS = { interactionWidth: 0 };
const PRO_OPTIONS = { hideAttribution: true };
/** Smaller than React Flow's 200 × 150 (V37): beside the detail panel it covered the nodes. */
const MINIMAP_SIZE = { width: 160, height: 112 };

/** The minimap draws every node: its class must not change identity with each render. */
function minimapClass(n: Node): string {
  if (n.type === 'symbol') return `minimap-${(n.data as SymbolData).tone}`;
  if (n.type === 'summary') return 'minimap-summary';
  return n.type === 'project' ? 'minimap-project' : 'minimap-file';
}

/** The graph; brings the selected symbol into view when it, or the layout, changes. */
export function Canvas({
  nodes,
  edges,
  fileEdges,
  layoutNodes,
  pending,
  selected,
  focus,
  scope,
  resizing,
  onSelect,
  onToggleSummary,
  reveal,
}: CanvasProps) {
  const { fitView, screenToFlowPosition } = useReactFlow();
  // Zoomed out, the canvas is a map; labels scale with `--symbiote-zoom`, set without re-rendering
  // and only where they read it.
  const map = useStore((state) => state.transform[2] < MAP_ZOOM);
  // The canvas narrows when the detail panel opens or a panel is resized: centre the selection
  // again then (after the drop: following the drag would shake the canvas).
  const size = useStore((state) => `${state.width}x${state.height}`);
  const store = useStoreApi();
  useEffect(() => {
    const labels = mapZoomStyle(document);
    labels.update(store.getState().transform[2]);
    const unsubscribe = store.subscribe((state) => labels.update(state.transform[2]));
    return () => {
      unsubscribe();
      labels.remove();
    };
  }, [store]);

  // While the view moves, a large graph draws fewer edges. A move starts with the view's first
  // change (React Flow's start comes with any press, a click included) and ends a little after
  // React Flow says so: an animation interrupted by the next one ends after the next has started.
  const [moving, setMoving] = useState(false);
  const stop = useRef<ReturnType<typeof setTimeout>>(undefined);
  const move = useCallback(() => {
    clearTimeout(stop.current);
    setMoving(true);
  }, []);
  const moved = useCallback(() => {
    clearTimeout(stop.current);
    stop.current = setTimeout(() => setMoving(false), MOVE_END_DELAY);
  }, []);
  useEffect(() => () => clearTimeout(stop.current), []);
  const drawn = useMemo(
    () => edgesToDraw({ edges, fileEdges }, { map, moving, selected }),
    [edges, fileEdges, map, moving, selected],
  );

  // Stable, as React Flow hands them to every node: a new one re-renders thousands of them.
  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.type === 'symbol') onSelect(node.id);
      else if (node.type === 'summary') onToggleSummary(node.id);
      // On the map, a file box is what is clicked: zoom into it.
      else if (node.type === 'file' && map) {
        void fitView({ nodes: [{ id: node.id }], duration: 300, maxZoom: 1.1 });
      }
    },
    [map, fitView, onSelect, onToggleSummary],
  );
  const onPaneClick = useCallback(
    (event: ReactMouseEvent) => {
      // On the map, an empty part of a frame (frames never take the pointer there): zoom into
      // the frame. Anywhere else, the canvas: deselect.
      const frame = map
        ? projectAt(layoutNodes, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
        : undefined;
      if (frame) void fitView({ nodes: [{ id: frame }], duration: 300, maxZoom: 1.1 });
      else onSelect(null);
    },
    [map, layoutNodes, fitView, screenToFlowPosition, onSelect],
  );

  // The project last fitted as a whole: walking its symbols then centres each, as without one.
  const fitted = useRef(scope);
  useEffect(() => {
    // Fit once the layout asked for is drawn, not the one it replaces: the view moves once.
    if (resizing || pending) return;
    // Wait a frame so React Flow has measured nodes that just appeared.
    const frame = requestAnimationFrame(() => {
      const rescoped = fitted.current !== scope;
      fitted.current = scope;
      if (reveal)
        void fitView({ nodes: reveal.map((id) => ({ id })), duration: 300, maxZoom: 1.1 });
      else if (focus || rescoped) void fitView({ duration: 300, maxZoom: 1.1 });
      else if (selected) void fitView({ nodes: [{ id: selected }], duration: 300, maxZoom: 1.1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, focus, scope, layoutNodes, size, reveal, resizing, pending, fitView]);

  const theme = useTheme();
  return (
    <ReactFlow<Node, Edge>
      nodes={nodes}
      edges={drawn}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={EDGE_OPTIONS}
      onMove={move}
      onMoveEnd={moved}
      fitView
      onlyRenderVisibleElements
      {...(map ? { className: 'map' } : {})}
      colorMode={theme}
      minZoom={0.05}
      nodesConnectable={false}
      // The layout is computed: a drag that starts on a box pans the canvas instead of moving it.
      nodesDraggable={false}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      proOptions={PRO_OPTIONS}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeClassName={minimapClass} style={MINIMAP_SIZE} />
      {pending && (
        <Panel position="top-center" className="layout-pending" role="status">
          Laying out…
        </Panel>
      )}
    </ReactFlow>
  );
}
