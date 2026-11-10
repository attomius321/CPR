// The canvas as drawn now, read in the page (page.evaluate(readCanvas)).
/** Reads the canvas as drawn now (runs in the page). */
export const readCanvas = () => {
  const q = (s, el = document) => [...el.querySelectorAll(s)];
  const vp = document.querySelector('.react-flow__viewport');
  const zoom = vp ? new DOMMatrixReadOnly(getComputedStyle(vp).transform).a : null;
  const flow = document.querySelector('.react-flow');
  const pane = flow?.getBoundingClientRect();
  const symbols = q('.react-flow__node-symbol');
  const context = symbols.filter((n) => n.querySelector('.symbol.tone-context, .symbol.tone-external, .symbol.tone-unknown'));
  const names = q('.react-flow__node-symbol .symbol-name');
  const files = q('.react-flow__node-file');
  const fileNames = q('.react-flow__node-file .file-name, .react-flow__node-file .file-label, .react-flow__node-file [class*="name"]');
  const all = q('.react-flow__node');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of all) {
    const r = n.getBoundingClientRect();
    minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);
    maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
  }
  const font = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
  return {
    zoom,
    map: !!document.querySelector('.react-flow.map, .canvas .map, main.map, .map'),
    pane: pane && { w: Math.round(pane.width), h: Math.round(pane.height) },
    drawn: {
      symbols: symbols.length,
      changed: symbols.length - context.length,
      context: context.length,
      summaries: q('.react-flow__node-summary').length,
      files: files.length,
      frames: q('.react-flow__node-project').length,
      edges: q('.react-flow__edge').length,
      findingCounts: q('.react-flow__node-symbol .symbol-count').length,
    },
    nameFontPx: font(names[0]),
    fileFontPx: font(fileNames[0]),
    namesCut: names.filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    namesShown: names.length,
    filesCut: fileNames.filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    filesShown: fileNames.length,
    layoutScreen: { w: Math.round(maxX - minX), h: Math.round(maxY - minY) },
    elements: document.getElementsByTagName('*').length,
  };
};
