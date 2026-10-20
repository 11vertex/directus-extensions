import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cascadePaths, describeDeleteOutcome, describeDeselect, summarizeImpact } from "./impact.js";
import { incomingRelations } from "./schema-graph.js";
import { createSchema } from "./test-fixtures.js";

const schema = createSchema();
const incoming = (collection, id) => incomingRelations(schema, collection).find((entry) => entry.id === id);

describe("describeDeleteOutcome", () => {
  it("reports nothing when no item references the record", () => {
    assert.equal(describeDeleteOutcome(incoming("articles", "authors.favorite_article"), 0).outcome, "none");
  });

  it("maps foreign key rules to outcomes", () => {
    assert.equal(describeDeleteOutcome(incoming("articles", "articles_tags.articles_id"), 2).outcome, "cascade");
    assert.equal(describeDeleteOutcome(incoming("authors", "articles.author"), 2).outcome, "nullify");
    assert.equal(describeDeleteOutcome(incoming("articles", "authors.favorite_article"), 1).outcome, "block");
    assert.equal(describeDeleteOutcome({ ...incoming("articles", "articles.parent"), onDelete: "SET DEFAULT" }, 1).outcome, "set-default");
  });

  it("treats relations without a constraint as dangling", () => {
    assert.equal(describeDeleteOutcome(incoming("articles", "comments.article"), 3).outcome, "dangling");
    assert.equal(describeDeleteOutcome(incoming("text_blocks", "pages_blocks.item"), 1).outcome, "dangling");
  });

  it("blocks SET NULL on a NOT NULL column", () => {
    const editor = incoming("directus_users", "articles.editor");
    assert.equal(editor.nullable, false);
    assert.equal(describeDeleteOutcome(editor, 1).outcome, "block");
  });
});

describe("summarizeImpact", () => {
  it("totals items per outcome and flags blockers", () => {
    const summary = summarizeImpact([
      { id: "a", outcome: "cascade", count: 2 },
      { id: "b", outcome: "nullify", count: 3 },
      { id: "c", outcome: "block", count: 1 },
      { id: "d", outcome: "dangling", count: 4 },
      { id: "e", outcome: "none", count: 0 }
    ]);
    assert.equal(summary.blocked, true);
    assert.deepEqual(summary.blockingRelations, ["c"]);
    assert.equal(summary.referencingItems, 10);
    assert.equal(summary.cascadeItems, 2);
    assert.equal(summary.nullifiedItems, 3);
    assert.equal(summary.danglingItems, 4);
  });

  it("is not blocked without blocking relations", () => {
    assert.equal(summarizeImpact([]).blocked, false);
  });
});

describe("cascadePaths", () => {
  it("follows CASCADE foreign keys", () => {
    assert.deepEqual(
      cascadePaths(schema, "articles").map((step) => [step.collection, step.depth, step.via]),
      [["articles_tags", 1, "articles_tags.articles_id"]]
    );
    assert.deepEqual(cascadePaths(schema, "pages").map((step) => step.collection), ["pages_blocks"]);
    assert.deepEqual(cascadePaths(schema, "authors"), []);
  });
});

describe("describeDeselect", () => {
  it("explains the O2M deselect action", () => {
    assert.match(describeDeselect({ ...incoming("articles", "articles_tags.articles_id"), target: "articles" }), /deleted/);
    assert.match(describeDeselect({ ...incoming("authors", "articles.author"), target: "authors" }), /unlinked/);
    assert.equal(describeDeselect(incoming("articles", "articles.parent")), null);
  });
});
