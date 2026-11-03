import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSchemaGraph } from "../api/schema-graph.js";
import { createSchema } from "../api/test-fixtures.js";
import { computeStats, filterGraph, findCycles, neighborhood, stronglyConnected } from "./graph.js";

const graph = buildSchemaGraph(createSchema());

const node = (id) => ({ id, fields: [] });
const edge = (source, target, field = "f") => ({ id: `${source}.${field}->${target}`, source, target, field, type: "m2o" });

describe("filterGraph", () => {
  it("hides system collections and their edges by default", () => {
    const filtered = filterGraph(graph);
    assert.ok(!filtered.nodes.some((entry) => entry.system));
    assert.ok(!filtered.edges.some((entry) => entry.target === "directus_users"));
    assert.equal(filterGraph(graph, { includeSystem: true }).edges.length, graph.edges.length);
  });

  it("filters by relation type", () => {
    const filtered = filterGraph(graph, { includeSystem: true, types: ["m2m"] });
    assert.deepEqual(filtered.edges.map((entry) => entry.field).sort(), ["articles_id", "tags_id"]);
    assert.equal(filtered.nodes.length, graph.collections.length);
  });

  it("focuses on a neighbourhood", () => {
    const filtered = filterGraph(graph, { focus: "tags", depth: 1 });
    assert.deepEqual(filtered.nodes.map((entry) => entry.id).sort(), ["articles_tags", "tags"]);
    const wider = filterGraph(graph, { focus: "tags", depth: 2 });
    assert.ok(wider.nodes.some((entry) => entry.id === "articles"));
  });
});

describe("neighborhood", () => {
  it("ignores direction", () => {
    assert.deepEqual([...neighborhood([edge("a", "b"), edge("c", "b")], "a", 2)].sort(), ["a", "b", "c"]);
  });
});

describe("findCycles", () => {
  it("reports self references and multi-collection cycles once", () => {
    const { cycles, truncated } = findCycles(filterGraph(graph, { includeSystem: true }));
    assert.equal(truncated, false);
    const keys = cycles.map((cycle) => cycle.collections.join(">")).sort();
    assert.deepEqual(keys, ["articles", "articles>authors"]);
    const pair = cycles.find((cycle) => cycle.collections.length === 2);
    assert.deepEqual(pair.hops.map((hop) => hop.fields), [["author"], ["favorite_article"]]);
  });

  it("enumerates every elementary cycle in a component", () => {
    const nodes = ["a", "b", "c"].map(node);
    const edges = [edge("a", "b"), edge("b", "a"), edge("b", "c"), edge("c", "a")];
    const keys = findCycles({ nodes, edges }).cycles.map((cycle) => cycle.collections.join(">")).sort();
    assert.deepEqual(keys, ["a>b", "a>b>c"]);
  });

  it("stops at the cycle limit", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const edges = ids.flatMap((source) => ids.filter((target) => target !== source).map((target) => edge(source, target)));
    const result = findCycles({ nodes: ids.map(node), edges }, { maxCycles: 5 });
    assert.equal(result.cycles.length, 5);
    assert.equal(result.truncated, true);
  });

  it("finds strongly connected components", () => {
    const components = stronglyConnected(["a", "b", "c"], [edge("a", "b"), edge("b", "a"), edge("b", "c")]);
    assert.deepEqual(components.map((component) => component.join(",")).sort(), ["a,b", "c"]);
  });
});

describe("computeStats", () => {
  it("counts nodes, edges, degrees and isolated collections", () => {
    const filtered = filterGraph(graph, { includeSystem: true });
    const stats = computeStats(filtered, findCycles(filtered));
    assert.equal(stats.nodeCount, 11);
    assert.equal(stats.edgeCount, 10);
    assert.deepEqual(stats.byType, { m2o: 4, o2m: 1, m2m: 2, m2a: 3 });
    assert.equal(stats.mostConnected[0].id, "articles");
    assert.deepEqual(stats.isolated, ["lonely"]);
    assert.deepEqual(stats.selfReferencing, ["articles"]);
    assert.equal(stats.cycleCount, 2);
  });
});
