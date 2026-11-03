import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSchemaGraph } from "../api/schema-graph.js";
import { createSchema } from "../api/test-fixtures.js";
import { filterGraph } from "./graph.js";
import { computeLayout, edgeGeometry, nodeLabel, nodeWidth } from "./layout.js";

const graph = filterGraph(buildSchemaGraph(createSchema()), { includeSystem: true });

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("computeLayout", () => {
  const layout = computeLayout(graph);
  const byId = new Map(layout.nodes.map((entry) => [entry.id, entry]));

  it("places every node inside the canvas without overlaps", () => {
    assert.equal(layout.nodes.length, graph.nodes.length);
    for (const entry of layout.nodes) {
      assert.ok(entry.x >= 0 && entry.y >= 0);
      assert.ok(entry.x + entry.width <= layout.width && entry.y + entry.height <= layout.height);
    }
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) assert.ok(!overlaps(layout.nodes[i], layout.nodes[j]), `${layout.nodes[i].id} overlaps ${layout.nodes[j].id}`);
    }
  });

  it("puts referencing collections left of what they reference", () => {
    assert.ok(byId.get("articles_tags").x < byId.get("tags").x);
    assert.ok(byId.get("pages_blocks").x < byId.get("text_blocks").x);
    assert.ok(byId.get("comments").x < byId.get("articles").x);
  });

  it("puts isolated collections below the graph", () => {
    const lonely = byId.get("lonely");
    assert.equal(lonely.layer, -1);
    const connected = layout.nodes.filter((entry) => entry.layer >= 0);
    assert.ok(connected.every((entry) => entry.y + entry.height <= lonely.y));
  });

  it("gives every edge a path and a label anchor", () => {
    assert.equal(layout.edges.length, graph.edges.length);
    for (const entry of layout.edges) {
      assert.match(entry.path, /^M [\d.-]+ [\d.-]+ C /);
      assert.ok(Number.isFinite(entry.labelX) && Number.isFinite(entry.labelY));
    }
  });

  it("is deterministic and handles empty graphs", () => {
    assert.deepEqual(computeLayout(graph), layout);
    const empty = computeLayout({ nodes: [], edges: [] });
    assert.deepEqual(empty.nodes, []);
    assert.ok(empty.width > 0);
  });
});

describe("layout helpers", () => {
  it("truncates long labels and sizes nodes", () => {
    const label = nodeLabel("x".repeat(60));
    assert.equal(label.length, 34);
    assert.ok(label.endsWith("…"));
    assert.ok(nodeWidth("ab") >= 90);
  });

  it("uses a node's display label when given", () => {
    const layout = computeLayout({ nodes: [{ id: "directus_users", label: "Users" }], edges: [] });
    assert.equal(layout.nodes[0].label, "Users");
    assert.equal(layout.nodes[0].id, "directus_users");
  });

  it("draws self loops above the node", () => {
    const box = { id: "a", x: 100, y: 100, width: 120, height: 34 };
    const geometry = edgeGeometry(box, box);
    assert.ok(geometry.labelY < 100);
  });
});
