import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAccessDiffs,
  buildCompareSummary,
  buildFieldDiffs,
  buildMergedRules,
  detectPolicyConflicts
} from "./conflicts.js";
function rule(partial) {
  return {
    id: partial.id ?? null,
    policy: partial.policy ?? "policy-a",
    action: partial.action ?? "read",
    collection: partial.collection ?? "articles",
    fields: partial.fields ?? ["title"],
    permissions: partial.permissions ?? null,
    validation: partial.validation ?? null,
    presets: partial.presets ?? null,
    authoredPermissions: partial.authoredPermissions ?? null,
    authoredValidation: partial.authoredValidation ?? null,
    authoredPresets: partial.authoredPresets ?? null
  };
}
function simulateStub(overrides = {}) {
  return {
    mode: "role",
    principal: {
      id: "role-1",
      label: "Role 1",
      roleId: "role-1",
      admin: false,
      app: true
    },
    accountability: {
      user: null,
      role: "role-1",
      roles: ["role-1"],
      admin: false,
      app: true,
      ip: null
    },
    globals: { app_access: true, admin_access: false, enforce_tfa: false },
    collectionAccess: {
      articles: {
        create: { access: "none" },
        read: { access: "full", fields: ["*"] },
        update: { access: "partial", fields: ["title"] },
        delete: { access: "none" }
      }
    },
    selectedCollection: "articles",
    actions: [],
    fields: [
      {
        field: "title",
        actions: { create: false, read: true, update: true, delete: false }
      },
      {
        field: "status",
        actions: { create: false, read: true, update: false, delete: false }
      }
    ],
    rules: [],
    conflicts: [],
    warnings: {
      roleOnlyMissingUserContext: true,
      ipUsedForPolicyFilter: null,
      additivePoliciesNote: "note"
    },
    ...overrides
  };
}
describe("detectPolicyConflicts", () => {
  it("detects overlapping rules and divergent fields", () => {
    const conflicts = detectPolicyConflicts("articles", [
      rule({
        policy: "p1",
        fields: ["title"],
        permissions: { status: { _eq: "published" } }
      }),
      rule({
        policy: "p2",
        fields: ["title", "status"],
        permissions: { user_created: { _eq: "$CURRENT_USER" } },
        presets: { status: "draft" }
      }),
      rule({
        policy: "p3",
        fields: ["status"],
        presets: { status: "published" },
        validation: { title: { _nnull: true } }
      })
    ]);
    const kinds = conflicts.map((conflict) => conflict.kind);
    assert.ok(kinds.includes("overlapping_rules"));
    assert.ok(kinds.includes("divergent_fields"));
    assert.ok(kinds.includes("preset_collision"));
    assert.ok(kinds.includes("differing_filters"));
    assert.ok(kinds.includes("differing_validation"));
  });
  it("returns no conflicts for a single rule", () => {
    assert.deepEqual(detectPolicyConflicts("articles", [rule({})]), []);
  });
  it("compares authored rules so role-resolved nulls do not hide differences", () => {
    // A role simulation resolves every $CURRENT_* filter to null, which would
    // make genuinely different policies look identical.
    const conflicts = detectPolicyConflicts("articles", [
      rule({
        policy: "p1",
        authoredPermissions: { user_created: { _eq: "$CURRENT_USER" } },
        permissions: { user_created: { _eq: null } },
        authoredPresets: { owner: "$CURRENT_USER" },
        presets: { owner: null }
      }),
      rule({
        policy: "p2",
        authoredPermissions: { user_updated: { _eq: "$CURRENT_USER" } },
        permissions: { user_updated: { _eq: null } },
        authoredPresets: { owner: "$CURRENT_ROLE" },
        presets: { owner: null }
      })
    ]);
    const kinds = conflicts.map((conflict) => conflict.kind);
    assert.ok(kinds.includes("differing_filters"));
    assert.ok(kinds.includes("preset_collision"));

    const filters = conflicts.find((conflict) => conflict.kind === "differing_filters");
    assert.equal(filters.saved.length, 2);
    assert.deepEqual(filters.merged.permissions, {
      _or: [
        { user_created: { _eq: "$CURRENT_USER" } },
        { user_updated: { _eq: "$CURRENT_USER" } }
      ]
    });
  });
});
describe("buildMergedRules", () => {
  it("unions fields and OR-merges filters across policies", () => {
    const merged = buildMergedRules("articles", [
      rule({
        policy: "p1",
        action: "read",
        fields: ["title"],
        authoredPermissions: { status: { _eq: "published" } }
      }),
      rule({
        policy: "p2",
        action: "read",
        fields: ["status", "title"],
        authoredPermissions: { user_created: { _eq: "$CURRENT_USER" } }
      }),
      rule({
        policy: "p3",
        action: "create",
        fields: ["*"],
        permissions: null
      })
    ]);

    const read = merged.find((entry) => entry.action === "read");
    const create = merged.find((entry) => entry.action === "create");

    assert.deepEqual(read.fields, ["status", "title"]);
    assert.deepEqual(read.permissions, {
      _or: [
        { status: { _eq: "published" } },
        { user_created: { _eq: "$CURRENT_USER" } }
      ]
    });
    assert.equal(read.sources.length, 2);
    assert.deepEqual(create.fields, ["*"]);
    assert.equal(create.permissions, null);
  });
});
describe("comparison diffs", () => {
  it("classifies access gains and losses", () => {
    const left = simulateStub();
    const right = simulateStub({
      collectionAccess: {
        articles: {
          create: { access: "full" },
          read: { access: "full", fields: ["*"] },
          update: { access: "none" },
          delete: { access: "none" }
        }
      },
      fields: [
        {
          field: "title",
          actions: { create: true, read: true, update: false, delete: false }
        },
        {
          field: "status",
          actions: { create: false, read: true, update: false, delete: false }
        }
      ]
    });
    const accessDiffs = buildAccessDiffs(left, right);
    const fieldDiffs = buildFieldDiffs(left, right);
    const summary = buildCompareSummary(accessDiffs, fieldDiffs, []);
    assert.equal(
      accessDiffs.find((diff) => diff.action === "create")?.change,
      "gained"
    );
    assert.equal(
      accessDiffs.find((diff) => diff.action === "update")?.change,
      "lost"
    );
    assert.ok(summary.gained >= 1);
    assert.ok(summary.lost >= 1);
    assert.ok(summary.fieldGained >= 1);
    assert.ok(summary.fieldLost >= 1);
  });
});
