import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSchemaGraph } from "../api/schema-graph.js";
import { createSchema } from "../api/test-fixtures.js";
import { filterGraph } from "./graph.js";
import { computeLayout } from "./layout.js";
import { formatGraphJson, formatGraphSvg, formatMermaid } from "./reports.js";

const graph = filterGraph(buildSchemaGraph(createSchema()), { includeSystem: true });

describe("reports", () => {
  it("formats JSON with metadata", () => {
    const parsed = JSON.parse(formatGraphJson({ graph, stats: { nodeCount: 1 }, cycles: [], filters: { includeSystem: true } }));
    assert.equal(parsed.meta.reportType, "content-dependency-graph");
    assert.equal(parsed.meta.filters.includeSystem, true);
    assert.equal(parsed.graph.edges.length, graph.edges.length);
  });

  it("renders a standalone SVG with escaped text", () => {
    const layout = computeLayout({ nodes: [{ id: "a<b>&c", fields: [] }], edges: [] });
    const svg = formatGraphSvg(layout, { title: 'Graph "x"' });
    assert.ok(svg.startsWith("<?xml"));
    assert.ok(svg.includes("a&lt;b&gt;&amp;c"));
    assert.ok(svg.includes("&quot;x&quot;"));
    assert.ok(!svg.includes("var(--"));
  });

  it("renders every edge in the SVG", () => {
    const svg = formatGraphSvg(computeLayout(graph));
    assert.equal((svg.match(/marker-end=/g) ?? []).length, graph.edges.length);
  });

  it("writes a Mermaid erDiagram", () => {
    const mermaid = formatMermaid(graph);
    const lines = mermaid.trim().split("\n");
    assert.equal(lines[0], "erDiagram");
    assert.ok(lines.includes('  articles }o--o| authors : "author (o2m)"'));
    assert.ok(lines.includes('  articles }o--|| directus_users : "editor (m2o)"'));
    assert.ok(lines.includes("    integer favorite_article FK"));
    assert.ok(lines.includes("  lonely {"));
  });

  it("sanitises Mermaid entity names", () => {
    const mermaid = formatMermaid({ nodes: [{ id: "9 bad.name", primary: "id", fields: [] }], edges: [] });
    assert.ok(mermaid.includes("_9_bad_name {"));
    assert.ok(mermaid.includes("unknown id PK"));
  });
});
