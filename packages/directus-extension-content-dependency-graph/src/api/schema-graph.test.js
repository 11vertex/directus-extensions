import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSchemaGraph,
  classifyRelation,
  incomingFilter,
  incomingRelations,
  junctionRef,
  outgoingRef,
  outgoingRelations,
  pickLabelField,
  toRecordRef
} from "./schema-graph.js";
import { createSchema } from "./test-fixtures.js";

const schema = createSchema();
const relation = (collection, field) => schema.relations.find((entry) => entry.collection === collection && entry.field === field);

describe("classifyRelation", () => {
  it("detects every relation type", () => {
    assert.equal(classifyRelation(relation("articles", "author"), schema.relations), "o2m");
    assert.equal(classifyRelation(relation("articles", "editor"), schema.relations), "m2o");
    assert.equal(classifyRelation(relation("articles_tags", "tags_id"), schema.relations), "m2m");
    assert.equal(classifyRelation(relation("pages_blocks", "item"), schema.relations), "m2a");
    assert.equal(classifyRelation(relation("pages_blocks", "pages_id"), schema.relations), "m2a");
  });

  it("ignores relations without any target", () => {
    assert.equal(classifyRelation({ collection: "x", field: "y", related_collection: null, meta: {} }), null);
  });
});

describe("buildSchemaGraph", () => {
  const graph = buildSchemaGraph(schema);

  it("creates one node per collection, flagging system collections", () => {
    assert.equal(graph.collections.length, Object.keys(schema.collections).length);
    assert.equal(graph.collections.find((node) => node.id === "directus_users").system, true);
    assert.equal(graph.collections.find((node) => node.id === "articles").system, false);
  });

  it("omits alias fields from node field lists", () => {
    const authors = graph.collections.find((node) => node.id === "authors");
    assert.deepEqual(authors.fields.map((entry) => entry.field), ["id", "name", "favorite_article"]);
  });

  it("creates one edge per relation target, M2A fanning out", () => {
    assert.equal(graph.edges.length, 10);
    const m2a = graph.edges.filter((edge) => edge.field === "item");
    assert.deepEqual(m2a.map((edge) => edge.target).sort(), ["image_blocks", "text_blocks"]);
    const author = graph.edges.find((edge) => edge.id === "articles.author->authors");
    assert.equal(author.onDelete, "SET NULL");
    assert.equal(author.oneField, "articles");
    assert.equal(graph.edges.find((edge) => edge.field === "article").constraint, false);
  });
});

describe("incoming and outgoing relations", () => {
  it("lists everything pointing at a collection", () => {
    const ids = incomingRelations(schema, "articles").map((entry) => entry.id);
    assert.deepEqual(ids, ["articles_tags.articles_id", "articles.parent", "authors.favorite_article", "comments.article"]);
  });

  it("describes the far side of a junction", () => {
    const junction = incomingRelations(schema, "articles").find((entry) => entry.id === "articles_tags.articles_id").junction;
    assert.deepEqual(junction, { field: "tags_id", collection: "tags", allowed: null, collectionField: null });
    const m2aJunction = incomingRelations(schema, "pages")[0].junction;
    assert.equal(m2aJunction.collection, null);
    assert.equal(m2aJunction.collectionField, "collection");
  });

  it("includes M2A relations that allow the collection", () => {
    const [entry] = incomingRelations(schema, "text_blocks");
    assert.equal(entry.kind, "m2a");
    assert.equal(entry.collectionField, "collection");
    assert.equal(entry.constraint, false);
  });

  it("lists foreign keys stored on a collection", () => {
    const ids = outgoingRelations(schema, "pages_blocks").map((entry) => `${entry.field}:${entry.kind}`);
    assert.deepEqual(ids, ["item:m2a", "pages_id:m2o"]);
  });
});

describe("record helpers", () => {
  it("picks a readable label field", () => {
    assert.equal(pickLabelField(schema.collections.authors), "name");
    assert.equal(pickLabelField(schema.collections.directus_users), "email");
    assert.equal(pickLabelField(schema.collections.image_blocks), null);
  });

  it("builds references with label fallback", () => {
    assert.deepEqual(toRecordRef("tags", { id: 3, name: null }, "id", "name"), { collection: "tags", pk: 3, label: "3" });
  });

  it("filters M2A references by collection and stringified key", () => {
    const [entry] = incomingRelations(schema, "text_blocks");
    assert.deepEqual(incomingFilter(entry, "text_blocks", 7), {
      _and: [{ item: { _eq: "7" } }, { collection: { _eq: "text_blocks" } }]
    });
  });

  it("resolves outgoing and junction targets", () => {
    const [item, pagesId] = outgoingRelations(schema, "pages_blocks");
    assert.deepEqual(outgoingRef(item, { item: "4", collection: "text_blocks" }), { collection: "text_blocks", pk: "4" });
    assert.deepEqual(outgoingRef(pagesId, { pages_id: 2 }), { collection: "pages", pk: 2 });
    assert.equal(outgoingRef(pagesId, { pages_id: null }), null);
    assert.deepEqual(junctionRef({ field: "tags_id", collection: "tags" }, { tags_id: 9 }), { collection: "tags", pk: 9 });
  });
});
