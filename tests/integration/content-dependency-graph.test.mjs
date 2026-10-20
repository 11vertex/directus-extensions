import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clients } from "./support/client.mjs";

const { state, admin } = clients();

describe("Content Dependency Graph", () => {
  it("maps how the seeded collections are connected", async () => {
    const graph = await admin.ok("GET", "/content-dependency-graph/graph");
    const edge = (id) => graph.edges.find((entry) => entry.id === id);
    assert.deepEqual(
      [edge("articles.author->authors")?.type, edge("articles.author->authors")?.onDelete],
      ["m2o", "SET NULL"]
    );
    assert.equal(edge("comments.article->articles")?.onDelete, "CASCADE");
    assert.equal(edge("articles.cover->directus_files")?.target, "directus_files");
    for (const name of state.collections) {
      assert.ok(graph.collections.some((collection) => collection.id === name), `${name} is a node`);
    }
  });

  it("lists items to pick from", async () => {
    const result = await admin.ok("GET", "/content-dependency-graph/browse/articles");
    assert.equal(result.labelField, "title");
    assert.deepEqual(result.items.map((item) => item.label).sort(), ["Draft article", "Published article"]);
  });

  it("shows what an item links to and what links to it", async () => {
    const result = await admin.ok("GET", `/content-dependency-graph/records/articles/${state.articles.published}`);
    const author = result.outgoing.find((relation) => relation.field === "author");
    assert.deepEqual(author.items.map((item) => item.label), ["Alice"]);
    const comments = result.incoming.find((relation) => relation.collection === "comments");
    assert.equal(comments.total, 2);
  });

  it("predicts what deleting an article would do", async () => {
    const result = await admin.ok("GET", `/content-dependency-graph/impact/articles/${state.articles.published}`);
    assert.equal(result.summary.blocked, false);
    assert.equal(result.summary.cascadeItems, 2, "both comments would be deleted");
    assert.equal(result.entries[0].outcome, "cascade");
  });

  it("predicts what deleting an author would do", async () => {
    const result = await admin.ok("GET", `/content-dependency-graph/impact/authors/${state.authors.alice}`);
    assert.equal(result.summary.nullifiedItems, 2, "both articles would lose their author");
    assert.equal(result.summary.cascadeItems, 0);
  });

  it("finds items nothing points to", async () => {
    const result = await admin.ok("GET", "/content-dependency-graph/orphans/authors");
    assert.equal(result.unreferenced.total, 1);
    assert.deepEqual(result.unreferenced.items.map((item) => item.label), ["Bob"]);
  });

  it("does not change any data", async () => {
    const before = await admin.ok("GET", "/items/comments?aggregate[count]=*");
    await admin.ok("GET", `/content-dependency-graph/impact/articles/${state.articles.published}`);
    const after = await admin.ok("GET", "/items/comments?aggregate[count]=*");
    assert.deepEqual(after, before);
  });

  it("returns 404 for unknown collections", async () => {
    const response = await admin.get("/content-dependency-graph/browse/does_not_exist");
    assert.equal(response.status, 404);
  });
});
