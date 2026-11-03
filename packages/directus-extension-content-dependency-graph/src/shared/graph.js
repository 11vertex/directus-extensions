// Pure graph helpers shared by the module (filtering, neighbourhoods, cycles, statistics).

export const RELATION_TYPES = ["m2o", "o2m", "m2m", "m2a"];

export const RELATION_TYPE_LABELS = {
  m2o: "Many to one",
  o2m: "One to many",
  m2m: "Many to many",
  m2a: "Many to any"
};

export function filterGraph(graph, { includeSystem = false, types = RELATION_TYPES, focus = null, depth = 1 } = {}) {
  let nodes = graph.collections.filter((node) => includeSystem || !node.system);
  let ids = new Set(nodes.map((node) => node.id));
  let edges = graph.edges.filter((edge) => types.includes(edge.type) && ids.has(edge.source) && ids.has(edge.target));

  if (focus && ids.has(focus)) {
    const keep = neighborhood(edges, focus, depth);
    nodes = nodes.filter((node) => keep.has(node.id));
    ids = keep;
    edges = edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target));
  }

  return { nodes, edges };
}

/** Collections within `depth` hops of `start`, ignoring edge direction. */
export function neighborhood(edges, start, depth = 1) {
  const adjacency = undirectedAdjacency(edges);
  const seen = new Set([start]);
  let frontier = [start];

  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const next = [];
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return seen;
}

function undirectedAdjacency(edges) {
  const adjacency = new Map();
  const link = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  };
  for (const edge of edges) {
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }
  return adjacency;
}

function directedAdjacency(edges) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    adjacency.get(edge.source).add(edge.target);
  }
  return adjacency;
}

/** Strongly connected components (Tarjan). */
export function stronglyConnected(nodeIds, edges) {
  const adjacency = directedAdjacency(edges);
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;

  const visit = (id) => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);

    for (const next of adjacency.get(id) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id), index.get(next)));
      }
    }

    if (low.get(id) === index.get(id)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      components.push(component.sort());
    }
  };

  for (const id of nodeIds) if (!index.has(id)) visit(id);
  return components;
}

/**
 * Every elementary cycle among collections (bounded). Each cycle starts at its alphabetically
 * smallest collection so it is reported once; `hops` lists the relation fields for each step.
 */
export function findCycles({ nodes, edges }, { maxCycles = 100, maxLength = 12, maxSteps = 50000 } = {}) {
  const ids = nodes.map((node) => node.id);
  const adjacency = directedAdjacency(edges);
  const cycles = [];
  let steps = 0;
  let truncated = false;

  const hops = (path) =>
    path.map((source, position) => {
      const target = path[(position + 1) % path.length];
      return {
        source,
        target,
        fields: edges.filter((edge) => edge.source === source && edge.target === target).map((edge) => edge.field)
      };
    });

  for (const component of stronglyConnected(ids, edges)) {
    for (const id of component) {
      if (adjacency.get(id)?.has(id) && cycles.length < maxCycles) cycles.push({ collections: [id], hops: hops([id]) });
    }
    if (component.length === 1) continue;

    for (let start = 0; start < component.length && !truncated; start++) {
      const origin = component[start];
      const allowed = new Set(component.slice(start));

      const walk = (id, path, onPath) => {
        if (truncated) return;
        for (const next of [...(adjacency.get(id) ?? [])].sort()) {
          if (!allowed.has(next)) continue;
          if (++steps > maxSteps || cycles.length >= maxCycles) {
            truncated = true;
            return;
          }
          if (next === origin) {
            if (path.length > 1) cycles.push({ collections: [...path], hops: hops(path) });
          } else if (!onPath.has(next) && path.length < maxLength) {
            onPath.add(next);
            path.push(next);
            walk(next, path, onPath);
            path.pop();
            onPath.delete(next);
          }
        }
      };

      walk(origin, [origin], new Set([origin]));
    }
  }

  return { cycles, truncated };
}

export function computeStats({ nodes, edges }, cycleResult = null) {
  const degree = new Map(nodes.map((node) => [node.id, { id: node.id, in: 0, out: 0, total: 0 }]));
  const byType = Object.fromEntries(RELATION_TYPES.map((type) => [type, 0]));

  for (const edge of edges) {
    byType[edge.type] = (byType[edge.type] ?? 0) + 1;
    const source = degree.get(edge.source);
    const target = degree.get(edge.target);
    if (source) {
      source.out += 1;
      source.total += 1;
    }
    if (target) {
      target.in += 1;
      target.total += 1;
    }
  }

  const degrees = [...degree.values()].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    byType,
    averageDegree: nodes.length ? Number(((edges.length * 2) / nodes.length).toFixed(2)) : 0,
    mostConnected: degrees.filter((entry) => entry.total > 0).slice(0, 10),
    isolated: degrees.filter((entry) => entry.total === 0).map((entry) => entry.id).sort(),
    selfReferencing: [...new Set(edges.filter((edge) => edge.source === edge.target).map((edge) => edge.source))].sort(),
    cycleCount: cycleResult?.cycles.length ?? 0
  };
}

export function edgeLabel(edge) {
  return `${edge.field} · ${edge.type.toUpperCase()}`;
}
