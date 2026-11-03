import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzePermissions } from "./analyzer.js";

const rules = (result) => result.findings.map((finding) => finding.rule);

describe("analyzePermissions", () => {
  it("flags a public policy that can read everything unfiltered", () => {
    const result = analyzePermissions({
      policies: [{ id: "p1", name: "Public", admin_access: false }],
      access: [{ id: 1, policy: "p1", role: null, user: null }],
      permissions: [{ id: 1, policy: "p1", collection: "articles", action: "read", fields: ["*"], permissions: {} }]
    });
    const finding = result.findings.find((entry) => entry.rule === "PUBLIC_READ");
    assert.equal(finding.severity, "high");
  });

  it("marks public read of system collections as critical", () => {
    const result = analyzePermissions({
      policies: [{ id: "p1", name: "Public" }],
      access: [{ policy: "p1", role: null, user: null }],
      permissions: [{ policy: "p1", collection: "directus_users", action: "read", fields: ["id"], permissions: { id: { _eq: 1 } } }]
    });
    assert.equal(result.findings.find((entry) => entry.rule === "PUBLIC_READ").severity, "critical");
  });

  it("flags public write and public admin as critical", () => {
    const result = analyzePermissions({
      policies: [
        { id: "a", name: "Public admin", admin_access: true, enforce_tfa: true },
        { id: "b", name: "Public write" }
      ],
      access: [
        { policy: "a", role: null, user: null },
        { policy: "b", role: null, user: null }
      ],
      permissions: [{ policy: "b", collection: "posts", action: "create", fields: ["title"], permissions: null }]
    });
    assert.ok(rules(result).includes("PUBLIC_ADMIN"));
    assert.ok(rules(result).includes("PUBLIC_WRITE"));
    assert.equal(result.summary.bySeverity.critical, 2);
  });

  it("does not treat role-assigned policies as public", () => {
    const result = analyzePermissions({
      policies: [{ id: "p1", name: "Editors" }],
      roles: [{ id: "r1", name: "Editor" }],
      access: [{ policy: "p1", role: "r1", user: null }],
      permissions: [{ policy: "p1", collection: "posts", action: "read", fields: ["*"], permissions: {} }]
    });
    assert.ok(!rules(result).includes("PUBLIC_READ"));
  });

  it("flags unrestricted delete, wildcard writes, privileged writes and secret fields", () => {
    const result = analyzePermissions({
      policies: [{ id: "p1", name: "Editors" }],
      access: [{ policy: "p1", role: "r1", user: null }],
      permissions: [
        { policy: "p1", collection: "posts", action: "delete", fields: null, permissions: {} },
        { policy: "p1", collection: "posts", action: "update", fields: ["*"], permissions: { a: 1 } },
        { policy: "p1", collection: "directus_roles", action: "update", fields: ["name"], permissions: null },
        { policy: "p1", collection: "accounts", action: "read", fields: ["id", "api_key"], permissions: null }
      ]
    });
    for (const rule of ["UNRESTRICTED_DELETE", "WILDCARD_WRITE", "PRIVILEGED_WRITE", "SENSITIVE_FIELD_EXPOSED"]) {
      assert.ok(rules(result).includes(rule), rule);
    }
  });

  it("flags admin policies without 2FA, unassigned and empty policies, duplicates", () => {
    const result = analyzePermissions({
      policies: [
        { id: "a", name: "Admin", admin_access: true, enforce_tfa: false },
        { id: "b", name: "Orphan", app_access: false },
        { id: "c", name: "Dup", app_access: true }
      ],
      access: [
        { policy: "a", role: "r", user: null },
        { policy: "c", role: "r", user: null }
      ],
      permissions: [
        { policy: "c", collection: "posts", action: "read", fields: ["id"], permissions: { a: 1 } },
        { policy: "c", collection: "posts", action: "read", fields: ["id"], permissions: { b: 1 } }
      ]
    });
    for (const rule of ["ADMIN_NO_TFA", "ADMIN_POLICY", "UNASSIGNED_POLICY", "EMPTY_POLICY", "DUPLICATE_PERMISSION"]) {
      assert.ok(rules(result).includes(rule), rule);
    }
  });

  it("sorts findings by severity and returns a summary", () => {
    const result = analyzePermissions({
      policies: [{ id: "p1", name: "P" }],
      access: [{ policy: "p1", role: null, user: null }],
      permissions: [
        { policy: "p1", collection: "a", action: "read", fields: ["id"], permissions: { x: 1 } },
        { policy: "p1", collection: "a", action: "delete", fields: null, permissions: null }
      ]
    });
    assert.equal(result.findings[0].severity, "critical");
    assert.equal(result.summary.findings, result.findings.length);
    assert.equal(result.summary.policies, 1);
  });

  it("writes plain-language texts without ids or raw system names", () => {
    const userId = "9b2c7f1e-1111-4222-8333-444455556666";
    const result = analyzePermissions({
      policies: [
        { id: "a", name: "Admin", admin_access: true, enforce_tfa: true },
        { id: "b", name: "Editors" }
      ],
      roles: [{ id: "r1", name: "Administrator" }],
      access: [
        { policy: "a", role: "r1", user: null },
        { policy: "a", role: null, user: userId },
        { policy: "b", role: "r1", user: null }
      ],
      permissions: [{ policy: "b", collection: "directus_roles", action: "update", fields: ["name"], permissions: null }]
    });
    const admin = result.findings.find((entry) => entry.rule === "ADMIN_POLICY");
    assert.ok(admin.detail.includes("Administrator role, 1 user"));
    assert.ok(!admin.detail.includes(userId));
    const privileged = result.findings.find((entry) => entry.rule === "PRIVILEGED_WRITE");
    assert.equal(privileged.title, "Non-admins can edit Roles (system)");
  });

  it("handles empty input", () => {
    const result = analyzePermissions({});
    assert.deepEqual(result.findings, []);
    assert.equal(result.summary.findings, 0);
  });
});
