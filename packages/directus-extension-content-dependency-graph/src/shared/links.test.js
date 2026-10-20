import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectionRoute, dataModelRoute, itemRoute } from "./links.js";

describe("links", () => {
  it("links user collection items to the content module", () => {
    assert.equal(itemRoute("articles", 5), "/content/articles/5");
    assert.equal(itemRoute("my items", "a/b"), "/content/my%20items/a%2Fb");
    assert.equal(itemRoute("settings", 1, { singleton: true }), "/content/settings");
    assert.equal(itemRoute("articles", null), null);
  });

  it("links system items to their own modules", () => {
    assert.equal(itemRoute("directus_users", "u1"), "/users/u1");
    assert.equal(itemRoute("directus_files", "f1"), "/files/f1");
    assert.equal(itemRoute("directus_activity", 1), null);
  });

  it("links collections and data model settings", () => {
    assert.equal(collectionRoute("articles"), "/content/articles");
    assert.equal(collectionRoute("directus_users"), "/users");
    assert.equal(collectionRoute("directus_revisions"), null);
    assert.equal(dataModelRoute("articles"), "/settings/data-model/articles");
    assert.equal(dataModelRoute("directus_users"), null);
  });
});
