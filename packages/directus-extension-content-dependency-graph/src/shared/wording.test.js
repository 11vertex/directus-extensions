import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSchemaGraph } from "../api/schema-graph.js";
import { createSchema } from "../api/test-fixtures.js";
import { countOf, describeConnections, humanize, impactHeadline, impactSentences, singular } from "./wording.js";

const { edges } = buildSchemaGraph(createSchema());

const simplify = ({ uses, usedBy }) => ({
  uses: uses.map((entry) => `${entry.field}:${entry.amount}:${entry.targets.join("|")}`).sort(),
  usedBy: usedBy.map((entry) => `${entry.collection}.${entry.field}${entry.via ? ` via ${entry.via}` : ""}`).sort()
});

describe("wording", () => {
  it("humanizes names and counts", () => {
    assert.equal(humanize("directus_users"), "Users");
    assert.equal(humanize("articles_tags"), "Articles Tags");
    assert.equal(singular("categories"), "category");
    assert.equal(singular("boxes"), "box");
    assert.equal(singular("status"), "status");
    assert.equal(countOf(1, "Comments"), "1 comment");
    assert.equal(countOf(3, "Comments"), "3 comments");
  });

  it("describes what a collection uses and what uses it", () => {
    assert.deepEqual(simplify(describeConnections(edges, "articles")), {
      uses: ["author:one:authors", "editor:one:directus_users", "parent:one:articles", "tags:many:tags"],
      usedBy: ["articles.parent", "authors.favorite_article", "comments.article"]
    });
  });

  it("folds junctions into the parent and the far side", () => {
    assert.deepEqual(simplify(describeConnections(edges, "tags")), { uses: [], usedBy: ["articles.tags via articles_tags"] });
    assert.deepEqual(simplify(describeConnections(edges, "pages")).uses, ["blocks:many:image_blocks|text_blocks"]);
    assert.deepEqual(simplify(describeConnections(edges, "text_blocks")).usedBy, ["pages.blocks via pages_blocks"]);
    assert.deepEqual(simplify(describeConnections(edges, "articles_tags")).uses, ["articles_id:one:articles", "tags_id:one:tags"]);
  });

  it("writes impact sentences", () => {
    const entries = [
      { collection: "comments", outcome: "cascade", count: 3, junction: null },
      { collection: "orders", outcome: "nullify", count: 1, junction: null },
      { collection: "invoices", outcome: "block", count: 2, junction: null },
      { collection: "articles_tags", outcome: "cascade", count: 4, junction: { collection: "tags" } },
      { collection: "notes", outcome: "none", count: 0, junction: null }
    ];
    assert.deepEqual(impactSentences(entries).map((entry) => entry.text), [
      "Blocked: 2 invoices still point to it",
      "4 links to Tags will also be deleted",
      "3 comments will also be deleted",
      "1 order will lose its link"
    ]);
    assert.equal(impactHeadline({ blocked: true }, "Hello").tone, "danger");
    assert.equal(impactHeadline({ blocked: false, cascadeItems: 0, danglingItems: 0, referencingItems: 0 }, "Hello").tone, "success");
  });
});
