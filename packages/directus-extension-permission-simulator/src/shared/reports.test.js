import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCompareCsv,
  formatCompareJson,
  formatSimulateCsv,
  formatSimulateJson
} from "./reports.js";
const simulateResult = {
  mode: "role",
  principal: {
    id: "role-1",
    label: "Editor",
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
      read: { access: "full" },
      update: { access: "partial" },
      delete: { access: "none" }
    }
  },
  selectedCollection: "articles",
  actions: [
    {
      action: "read",
      access: "full",
      allowed: true,
      fields: ["*"],
      presets: null,
      itemAllowed: true,
      reason: null
    }
  ],
  fields: [
    {
      field: "title",
      actions: { create: false, read: true, update: true, delete: false }
    }
  ],
  rules: [],
  conflicts: [
    {
      severity: "warning",
      kind: "divergent_fields",
      collection: "articles",
      action: "update",
      message: "fields differ",
      policyIds: ["p1", "p2"]
    }
  ],
  warnings: {
    roleOnlyMissingUserContext: true,
    ipUsedForPolicyFilter: null,
    additivePoliciesNote: "additive"
  }
};
const compareResult = {
  left: simulateResult,
  right: {
    ...simulateResult,
    principal: { ...simulateResult.principal, id: "role-2", label: "Author" }
  },
  accessDiffs: [
    {
      collection: "articles",
      action: "create",
      left: "none",
      right: "full",
      change: "gained"
    }
  ],
  fieldDiffs: [
    {
      field: "title",
      action: "create",
      left: false,
      right: true,
      change: "gained"
    }
  ],
  summary: {
    gained: 1,
    lost: 0,
    changed: 0,
    same: 3,
    fieldGained: 1,
    fieldLost: 0,
    conflictCount: 1
  },
  conflicts: simulateResult.conflicts
};
describe("report formatters", () => {
  it("formats simulation JSON without secrets", () => {
    const json = formatSimulateJson(simulateResult);
    assert.match(json, /"reportType": "simulate"/);
    assert.match(json, /"Editor"/);
    assert.doesNotMatch(json, /token|password|secret/i);
  });
  it("formats simulation CSV rows", () => {
    const csv = formatSimulateCsv(simulateResult);
    assert.match(csv, /collectionAccess,articles\.read,full/);
    assert.match(csv, /conflict,divergent_fields:articles\.update/);
  });
  it("formats comparison JSON and CSV", () => {
    const json = formatCompareJson(compareResult);
    const csv = formatCompareCsv(compareResult);
    assert.match(json, /"reportType": "compare"/);
    assert.match(csv, /summary,gained,1/);
    assert.match(csv, /accessDiff,articles\.create,none->full \(gained\)/);
  });
});
