// Deterministic layered ("Sugiyama-lite") layout: referencing collections on the left,
// referenced collections on the right, isolated collections in a grid underneath.

export const NODE_HEIGHT = 34;
const CHAR_WIDTH = 7.4;
const NODE_PADDING = 28;
const MIN_WIDTH = 90;
const MAX_CHARS = 34;
const LAYER_GAP = 140;
const ROW_GAP = 24;
const MARGIN = 40;
const PARALLEL_OFFSET = 14;

export function nodeLabel(id) {
  return id.length > MAX_CHARS ? `${id.slice(0, MAX_CHARS - 1)}…` : id;
}

export function nodeWidth(label) {
  return Math.max(MIN_WIDTH, Math.round(label.length * CHAR_WIDTH + NODE_PADDING));
}

/** Break cycles with a DFS: back edges are reversed so the remaining graph is acyclic. */
function acyclicEdges(ids, pairs) {
  const successors = new Map(ids.map((id) => [id, []]));
  for (const [source, target] of pairs) successors.get(source).push(target);

  const state = new Map();
  const result = [];

  const visit = (id) => {
    state.set(id, 1);
    for (const next of successors.get(id)) {
      if (state.get(next) === 1) {
        result.push([next, id]);
        continue;
      }
      if (!state.has(next)) visit(next);
      result.push([id, next]);
    }
    state.set(id, 2);
  };

  for (const id of ids) if (!state.has(id)) visit(id);
  return result;
}

function assignLayers(ids, dag) {
  const predecessors = new Map(ids.map((id) => [id, []]));
  const successors = new Map(ids.map((id) => [id, []]));
  const indegree = new Map(ids.map((id) => [id, 0]));

  for (const [source, target] of dag) {
    successors.get(source).push(target);
    predecessors.get(target).push(source);
    indegree.set(target, indegree.get(target) + 1);
  }

  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order = [];
  const layer = new Map();

  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    layer.set(id, Math.max(0, ...predecessors.get(id).map((pred) => layer.get(pred) + 1)));
    for (const next of successors.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }

  // Pull pure sources next to their closest dependency to keep edges short.
  for (const id of order) {
    if (predecessors.get(id).length === 0 && successors.get(id).length > 0) {
      layer.set(id, Math.min(...successors.get(id).map((next) => layer.get(next))) - 1);
    }
  }

  const min = Math.min(...order.map((id) => layer.get(id)));
  for (const id of order) layer.set(id, layer.get(id) - min);
  return { layer, order };
}

function orderLayers(layer, order, neighbours, iterations) {
  const count = Math.max(...order.map((id) => layer.get(id))) + 1;
  const layers = Array.from({ length: count }, () => []);
  for (const id of order) layers[layer.get(id)].push(id);

  const position = new Map();
  const remember = () => layers.forEach((ids) => ids.forEach((id, index) => position.set(id, (index + 0.5) / ids.length)));
  remember();

  const sweep = (index, compare) => {
    const scores = new Map(
      layers[index].map((id) => {
        const related = neighbours.get(id).filter((other) => compare(layer.get(other)));
        const score = related.length ? related.reduce((sum, other) => sum + position.get(other), 0) / related.length : position.get(id);
        return [id, score];
      })
    );
    layers[index].sort((a, b) => scores.get(a) - scores.get(b) || a.localeCompare(b));
    remember();
  };

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let index = 1; index < count; index++) sweep(index, (other) => other < index);
    for (let index = count - 2; index >= 0; index--) sweep(index, (other) => other > index);
  }
  return layers;
}

function point(x, y) {
  return `${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`;
}

function bezierMid(p0, p1, p2, p3) {
  return {
    x: (p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8,
    y: (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8
  };
}

export function edgeGeometry(source, target, offset = 0) {
  if (source.id === target.id) {
    const lift = 34 + Math.abs(offset) * 1.5;
    const start = [source.x + source.width - 22, source.y];
    const end = [source.x + source.width, source.y + source.height / 2];
    const c1 = [start[0], start[1] - lift];
    const c2 = [end[0] + lift, end[1]];
    const mid = bezierMid(start, c1, c2, end);
    return { path: `M ${point(...start)} C ${point(...c1)}, ${point(...c2)}, ${point(...end)}`, labelX: mid.x + 6, labelY: mid.y - 6 };
  }

  const sourceCenter = source.x + source.width / 2;
  const targetCenter = target.x + target.width / 2;
  const sy = source.y + source.height / 2;
  const ty = target.y + target.height / 2;
  let start;
  let end;
  let c1;
  let c2;

  if (target.x >= source.x + source.width) {
    start = [source.x + source.width, sy];
    end = [target.x, ty];
    const dx = Math.max(40, (end[0] - start[0]) / 2);
    c1 = [start[0] + dx, sy + offset];
    c2 = [end[0] - dx, ty + offset];
  } else if (target.x + target.width <= source.x) {
    start = [source.x, sy];
    end = [target.x + target.width, ty];
    const dx = Math.max(40, (start[0] - end[0]) / 2);
    c1 = [start[0] - dx, sy + offset];
    c2 = [end[0] + dx, ty + offset];
  } else {
    const right = Math.max(source.x + source.width, target.x + target.width);
    const bulge = 50 + Math.abs(ty - sy) * 0.25 + Math.abs(offset);
    start = [source.x + source.width, sy];
    end = [target.x + target.width, ty];
    c1 = [right + bulge, sy];
    c2 = [right + bulge, ty];
    if (sourceCenter === targetCenter && sy === ty) c2 = [right + bulge, ty + 1];
  }

  const mid = bezierMid(start, c1, c2, end);
  return { path: `M ${point(...start)} C ${point(...c1)}, ${point(...c2)}, ${point(...end)}`, labelX: mid.x, labelY: mid.y };
}

export function computeLayout({ nodes, edges }, { iterations = 6 } = {}) {
  const ids = nodes.map((node) => node.id);
  const known = new Set(ids);
  const usable = edges.filter((edge) => known.has(edge.source) && known.has(edge.target));
  const connected = new Set(usable.flatMap((edge) => [edge.source, edge.target]));
  const linked = ids.filter((id) => connected.has(id));
  const isolated = ids.filter((id) => !connected.has(id));

  const pairKeys = new Set();
  const pairs = [];
  for (const edge of usable) {
    const key = `${edge.source}\u0000${edge.target}`;
    if (edge.source === edge.target || pairKeys.has(key)) continue;
    pairKeys.add(key);
    pairs.push([edge.source, edge.target]);
  }

  const neighbours = new Map(linked.map((id) => [id, []]));
  for (const [source, target] of pairs) {
    neighbours.get(source).push(target);
    neighbours.get(target).push(source);
  }

  const boxes = new Map();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const labelOf = (id) => nodeLabel(nodeById.get(id)?.label ?? id);
  const box = (id, x, y, layer) => {
    const label = labelOf(id);
    const entry = { id, label, x, y, width: nodeWidth(label), height: NODE_HEIGHT, layer, system: Boolean(nodeById.get(id)?.system) };
    boxes.set(id, entry);
    return entry;
  };

  let graphWidth = 0;
  let graphHeight = 0;

  if (linked.length > 0) {
    const { layer, order } = assignLayers(linked, acyclicEdges(linked, pairs));
    const layers = orderLayers(layer, order, neighbours, iterations);
    const tallest = Math.max(...layers.map((ids) => ids.length));
    const fullHeight = tallest * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;
    let x = MARGIN;

    layers.forEach((column, index) => {
      const columnWidth = Math.max(...column.map((id) => nodeWidth(labelOf(id))));
      const columnHeight = column.length * (NODE_HEIGHT + ROW_GAP) - ROW_GAP;
      const top = MARGIN + (fullHeight - columnHeight) / 2;
      column.forEach((id, row) => {
        const entry = box(id, x, top + row * (NODE_HEIGHT + ROW_GAP), index);
        entry.x = x + (columnWidth - entry.width) / 2;
      });
      x += columnWidth + LAYER_GAP;
    });

    graphWidth = x - LAYER_GAP + MARGIN;
    graphHeight = MARGIN * 2 + fullHeight;
  }

  if (isolated.length > 0) {
    const cellWidth = Math.max(...isolated.map((id) => nodeWidth(labelOf(id)))) + 20;
    const available = Math.max(graphWidth, 720) - MARGIN * 2;
    const columns = Math.max(1, Math.floor(available / cellWidth));
    const top = graphHeight > 0 ? graphHeight + 20 : MARGIN;

    isolated.forEach((id, index) => {
      box(id, MARGIN + (index % columns) * cellWidth, top + Math.floor(index / columns) * (NODE_HEIGHT + ROW_GAP), -1);
    });

    const rows = Math.ceil(isolated.length / columns);
    graphWidth = Math.max(graphWidth, MARGIN * 2 + Math.min(columns, isolated.length) * cellWidth);
    graphHeight = top + rows * (NODE_HEIGHT + ROW_GAP) - ROW_GAP + MARGIN;
  }

  const groups = new Map();
  for (const edge of usable) {
    const key = [edge.source, edge.target].sort().join("\u0000");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }

  const laidEdges = [];
  for (const group of groups.values()) {
    group.forEach((edge, index) => {
      const offset = (index - (group.length - 1) / 2) * PARALLEL_OFFSET;
      laidEdges.push({ ...edge, ...edgeGeometry(boxes.get(edge.source), boxes.get(edge.target), offset) });
    });
  }

  // Self loops and same-column curves can extend past the last column.
  const extra = laidEdges.some((edge) => edge.source === edge.target || boxes.get(edge.source).layer === boxes.get(edge.target).layer) ? 120 : 0;

  return {
    width: Math.max(Math.ceil(graphWidth + extra), 320),
    height: Math.max(Math.ceil(graphHeight), 160),
    nodes: ids.map((id) => boxes.get(id)),
    edges: laidEdges.sort((a, b) => a.id.localeCompare(b.id))
  };
}
