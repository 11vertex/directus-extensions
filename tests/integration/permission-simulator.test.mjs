import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clients } from "./support/client.mjs";

const { state, admin } = clients();
const simulate = (body) => admin.ok("POST", "/permission-simulator/simulate", body);

describe("Permission Simulator", () => {
  it("lists roles, users and collections", async () => {
    const meta = await admin.ok("GET", "/permission-simulator/meta");
    assert.ok(meta.roles.some((role) => role.name === "Editor"));
    assert.ok(meta.users.some((user) => user.email === state.seed.editorEmail));
    for (const collection of state.collections) assert.ok(meta.collections.includes(collection));
  });

  it("shows a role's access to every collection in one call", async () => {
    const result = await simulate({ mode: "role", principalId: state.roles.editor });
    assert.equal(result.principal.label, "Editor");
    assert.equal(result.accountability.admin, false);
    assert.equal(result.accountability.app, true);
    assert.equal(result.collectionAccess.articles.read.access, "full");
    assert.equal(result.collectionAccess.articles.update.access, "full");
    assert.equal(result.collectionAccess.articles.delete.access, "full");
    assert.equal(result.collectionAccess.articles.create.access, "none");
    assert.equal(result.collectionAccess.comments.read.access, "full");
    assert.equal(result.collectionAccess.authors?.read?.access ?? "none", "none");
  });

  it("explains one collection, its fields and a specific item", async () => {
    const result = await simulate({
      mode: "role",
      principalId: state.roles.editor,
      collection: "articles",
      primaryKey: String(state.articles.published)
    });
    const byAction = Object.fromEntries(result.actions.map((entry) => [entry.action, entry]));
    assert.equal(byAction.read.allowed, true);
    assert.equal(byAction.read.itemAllowed, true);
    assert.equal(byAction.create.allowed, false);
    assert.deepEqual(result.fields.map((field) => field.field).sort(), ["author", "cover", "id", "status", "title"]);
    assert.ok(result.fields.every((field) => field.actions.read === true));
    assert.deepEqual(result.rules.map((rule) => rule.action).sort(), ["delete", "read", "update"]);
  });

  it("simulates a user through their role", async () => {
    const result = await simulate({ mode: "user", principalId: state.users.editor, collection: "articles" });
    assert.equal(result.principal.label, "Erin Editor");
    assert.equal(result.principal.roleId, state.roles.editor);
    assert.equal(result.accountability.user, state.users.editor);
    assert.equal(result.collectionAccess.articles.read.access, "full");
  });

  it("compares two roles", async () => {
    const meta = await admin.ok("GET", "/permission-simulator/meta");
    const adminRole = meta.roles.find((role) => role.name === "Administrator");
    const result = await admin.ok("POST", "/permission-simulator/compare", {
      leftRoleId: state.roles.editor,
      rightRoleId: adminRole.id,
      collection: "articles"
    });
    const createArticles = result.accessDiffs.find((diff) => diff.collection === "articles" && diff.action === "create");
    assert.deepEqual([createArticles.left, createArticles.right, createArticles.change], ["none", "full", "gained"]);
    assert.ok(result.summary.gained > 0);
    assert.equal(result.summary.lost, 0);
  });

  it("reflects permission changes immediately (no stale cache)", async () => {
    const before = await simulate({ mode: "role", principalId: state.roles.editor });
    assert.equal(before.collectionAccess.comments.create.access, "none");

    const permission = await admin.ok("POST", "/permissions", {
      policy: state.policies.editors,
      collection: "comments",
      action: "create",
      fields: ["*"]
    });
    try {
      const after = await simulate({ mode: "role", principalId: state.roles.editor });
      assert.equal(after.collectionAccess.comments.create.access, "full");
    } finally {
      await admin.ok("DELETE", `/permissions/${permission.id}`);
    }

    const restored = await simulate({ mode: "role", principalId: state.roles.editor });
    assert.equal(restored.collectionAccess.comments.create.access, "none");
  });

  it("rejects bad input with a clear error", async () => {
    const missing = await admin.post("/permission-simulator/simulate", { mode: "role" });
    assert.equal(missing.status, 400);
    const unknownRole = await admin.post("/permission-simulator/simulate", {
      mode: "role",
      principalId: "00000000-0000-4000-8000-000000000000"
    });
    assert.equal(unknownRole.status, 404);
    const unknownCollection = await admin.post("/permission-simulator/simulate", {
      mode: "role",
      principalId: state.roles.editor,
      collection: "does_not_exist"
    });
    assert.equal(unknownCollection.status, 404);
  });
});
