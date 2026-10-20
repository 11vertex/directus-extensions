import { edgeLabel, RELATION_TYPE_LABELS, RELATION_TYPES } from "./graph.js";

// Fixed palette for standalone exports (theme CSS variables do not exist outside the app).
const EXPORT_COLORS = {
  background: "#ffffff",
  node: "#f5f7fa",
  systemNode: "#e9edf2",
  border: "#a2b5cd",
  text: "#172940",
  muted: "#4f5464",
  m2o: "#6644ff",
  o2m: "#2ecda7",
  m2m: "#e35169",
  m2a: "#ffa439"
};

export const EDGE_DASH = { m2o: "", o2m: "", m2m: "6 4", m2a: "2 4" };

export function formatGraphJson({ graph, stats, cycles, filters }) {
  return JSON.stringify(
    {
      meta: { reportType: "content-dependency-graph", version: "1.0.0", exportedAt: new Date().toISOString(), filters },
      graph,
      stats,
      cycles
    },
    null,
    2
  );
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function formatGraphSvg(layout, { title = "Content dependency graph", showLabels = true } = {}) {
  const legendHeight = 40;
  const width = layout.width;
  const height = layout.height + legendHeight;
  const colors = EXPORT_COLORS;

  const markers = RELATION_TYPES.map(
    (type) =>
      `<marker id="arrow-${type}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${colors[type]}"/></marker>`
  ).join("");

  const edges = layout.edges
    .map((edge) => {
      const dash = EDGE_DASH[edge.type] ? ` stroke-dasharray="${EDGE_DASH[edge.type]}"` : "";
      return `<path d="${edge.path}" fill="none" stroke="${colors[edge.type]}" stroke-width="1.5"${dash} marker-end="url(#arrow-${edge.type})"><title>${escapeXml(`${edge.source}.${edge.field} → ${edge.target} (${edge.type})`)}</title></path>`;
    })
    .join("\n");

  const labels = showLabels
    ? layout.edges
        .map(
          (edge) =>
            `<text x="${edge.labelX}" y="${edge.labelY}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="${colors.muted}" stroke="${colors.background}" stroke-width="4" paint-order="stroke">${escapeXml(edgeLabel(edge))}</text>`
        )
        .join("\n")
    : "";

  const nodes = layout.nodes
    .map(
      (node) =>
        `<g transform="translate(${node.x} ${node.y})"><rect width="${node.width}" height="${node.height}" rx="6" fill="${node.system ? colors.systemNode : colors.node}" stroke="${colors.border}"/><text x="${node.width / 2}" y="${node.height / 2}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="${colors.text}"${node.system ? ' font-style="italic"' : ""}>${escapeXml(node.label)}</text><title>${escapeXml(node.id)}</title></g>`
    )
    .join("\n");

  const legend = RELATION_TYPES.map((type, index) => {
    const x = 20 + index * 170;
    const y = layout.height + 20;
    const dash = EDGE_DASH[type] ? ` stroke-dasharray="${EDGE_DASH[type]}"` : "";
    return `<line x1="${x}" y1="${y}" x2="${x + 30}" y2="${y}" stroke="${colors[type]}" stroke-width="2"${dash}/><text x="${x + 38}" y="${y}" dominant-baseline="middle" font-size="11" fill="${colors.muted}">${escapeXml(`${type.toUpperCase()} · ${RELATION_TYPE_LABELS[type]}`)}</text>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">
<title>${escapeXml(title)}</title>
<defs>${markers}</defs>
<rect width="100%" height="100%" fill="${colors.background}"/>
${edges}
${labels}
${nodes}
${legend}
</svg>
`;
}

function mermaidName(value) {
  const name = String(value).replace(/[^A-Za-z0-9_-]/g, "_");
  return /^[A-Za-z_]/.test(name) ? name : `_${name}`;
}

function mermaidWord(value) {
  return String(value ?? "unknown").replace(/[^A-Za-z0-9_]/g, "_") || "unknown";
}

function mermaidText(value) {
  return String(value).replaceAll('"', "'");
}

/** Mermaid `erDiagram` with the primary key and relational fields of every collection. */
export function formatMermaid({ nodes, edges }) {
  const lines = ["erDiagram"];
  const foreignKeys = new Map();
  for (const edge of edges) {
    if (!foreignKeys.has(edge.source)) foreignKeys.set(edge.source, new Set());
    foreignKeys.get(edge.source).add(edge.field);
  }

  for (const node of nodes) {
    const fieldTypes = new Map((node.fields ?? []).map((entry) => [entry.field, entry.type]));
    const attributes = [];
    if (node.primary) attributes.push(`    ${mermaidWord(fieldTypes.get(node.primary))} ${mermaidWord(node.primary)} PK`);
    for (const field of [...(foreignKeys.get(node.id) ?? [])].sort()) {
      if (field === node.primary) continue;
      attributes.push(`    ${mermaidWord(fieldTypes.get(field))} ${mermaidWord(field)} FK`);
    }

    if (attributes.length > 0) lines.push(`  ${mermaidName(node.id)} {`, ...attributes, "  }");
    else lines.push(`  ${mermaidName(node.id)}`);
  }

  for (const edge of edges) {
    const cardinality = edge.nullable === false ? "}o--||" : "}o--o|";
    lines.push(`  ${mermaidName(edge.source)} ${cardinality} ${mermaidName(edge.target)} : "${mermaidText(`${edge.field} (${edge.type})`)}"`);
  }

  return `${lines.join("\n")}\n`;
}
