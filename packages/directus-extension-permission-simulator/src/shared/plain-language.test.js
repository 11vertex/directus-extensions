import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeFieldList,
  describeFilter,
  explainAction,
  explainConflicts,
  groupDiffsByCollection
} from "./plain-language.js";

describe("describeFilter", () => {
  it("returns null for empty filters", () => {
    assert.equal(describeFilter(null), null);
    assert.equal(describeFilter({}), null);
  });

  it("describes simple and dynamic comparisons", () => {
    assert.equal(describeFilter({ status: { _eq: "published" } }), "Status is published");
    assert.equal(describeFilter({ user_created: { _eq: "$CURRENT_USER" } }), "User created is the current user");
    assert.equal(describeFilter({ team: { _eq: "$CURRENT_USER.team" } }), "Team is the current user's team");
  });

  it("joins _and / _or groups and nested relations", () => {
    assert.equal(
      describeFilter({ _or: [{ status: { _eq: "published" } }, { author: { id: { _eq: "$CURRENT_USER" } } }] }),
      "Status is published or Author → Id is the current user"
    );
    assert.equal(
      describeFilter({ _and: [{ a: { _in: [1, 2] } }, { b: { _null: true } }] }),
      "A is one of 1, 2 and B is empty"
    );
  });

  it("uses the provided label function", () => {
    assert.equal(describeFilter({ status: { _neq: "draft" } }, () => "State"), "State is not draft");
  });
});

describe("describeFieldList", () => {
  it("handles wildcard, empty and long lists", () => {
    assert.equal(describeFieldList(["*"], 5), "all fields");
    assert.equal(describeFieldList([], 5), "no fields");
    assert.equal(describeFieldList(["title", "body"], 12), "2 of 12 fields: Title, Body");
    assert.match(describeFieldList(["a", "b", "c", "d", "e", "f", "g", "h"], 9), /and 2 more$/);
  });
});

describe("explainAction", () => {
  it("explains none, filtered and admin access", () => {
    assert.equal(explainAction({ action: "delete", access: { access: "none" } }).headline, "Cannot delete items.");

    const read = explainAction({
      action: "read",
      access: { access: "partial", fields: ["title"] },
      merged: { permissions: { status: { _eq: "published" } }, fields: ["title"] },
      totalFields: 4,
      policyNames: ["Editors"]
    });
    assert.equal(read.level, "partial");
    assert.equal(read.headline, "Can read only items where Status is published.");
    assert.deepEqual(read.lines, ["Can see 1 of 4 fields: Title.", "Granted by policy: Editors."]);

    assert.equal(explainAction({ action: "update", isAdmin: true }).headline, "Can edit all items (admin access).");
  });

  it("mentions unresolved user context", () => {
    const result = explainAction({
      action: "update",
      access: { access: "partial", fields: ["*"] },
      merged: { permissions: { owner: { _eq: "$CURRENT_USER" } }, fields: ["*"], hasUnresolvedUserContext: true }
    });
    assert.ok(result.lines.some((line) => line.startsWith("Depends on who is logged in")));
  });
});

describe("explainConflicts", () => {
  it("skips informational overlaps", () => {
    const lines = explainConflicts([
      { severity: "info", kind: "overlapping_rules", action: "read" },
      { severity: "warning", kind: "differing_filters", action: "read" }
    ]);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /different item rules for read/);
  });
});

describe("groupDiffsByCollection", () => {
  it("keeps only differing cells", () => {
    const rows = groupDiffsByCollection([
      { collection: "posts", action: "read", left: "full", right: "none", change: "lost" },
      { collection: "posts", action: "create", left: "full", right: "full", change: "same" },
      { collection: "tags", action: "read", left: "none", right: "none", change: "same" }
    ]);
    assert.deepEqual([...rows.keys()], ["posts"]);
    assert.deepEqual(rows.get("posts"), { read: { left: "full", right: "none" } });
  });
});
