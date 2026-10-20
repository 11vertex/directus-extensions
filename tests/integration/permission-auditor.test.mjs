import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clients } from "./support/client.mjs";

const { state, admin } = clients();

describe("Permission Auditor", () => {
  it("finds the risky access seeded into the project", async () => {
    const audit = await admin.ok("GET", "/permission-auditor/audit");
    const find = (rule, collection) =>
      audit.findings.find((finding) => finding.rule === rule && (collection ? finding.collection === collection : true));

    const publicRead = find("PUBLIC_READ", "authors");
    assert.ok(publicRead, "public read of authors is reported");
    assert.equal(publicRead.severity, "high");
    assert.equal(publicRead.policyId, state.policies.public);

    const unrestrictedDelete = find("UNRESTRICTED_DELETE", "articles");
    assert.ok(unrestrictedDelete, "unfiltered delete on articles is reported");
    assert.equal(unrestrictedDelete.policyId, state.policies.editors);

    assert.ok(find("WILDCARD_WRITE", "articles"), "writable * fields on articles are reported");
    assert.ok(find("ADMIN_NO_TFA"), "admin policy without 2FA is reported");
  });

  it("gives every finding a plain title, explanation and fix", async () => {
    const audit = await admin.ok("GET", "/permission-auditor/audit");
    assert.ok(audit.findings.length > 0);
    for (const finding of audit.findings) {
      assert.ok(finding.title && finding.detail, `${finding.rule} has text`);
      if (finding.severity !== "info") assert.ok(finding.hint, `${finding.rule} has a fix`);
    }
  });

  it("orders findings from most to least severe and counts them", async () => {
    const audit = await admin.ok("GET", "/permission-auditor/audit");
    const order = ["critical", "high", "medium", "low", "info"];
    const ranks = audit.findings.map((finding) => order.indexOf(finding.severity));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    const total = Object.values(audit.summary.bySeverity).reduce((sum, count) => sum + count, 0);
    assert.equal(total, audit.findings.length);
    assert.ok(audit.summary.policies >= 3);
  });

  it("does not flag the editor policy as public", async () => {
    const audit = await admin.ok("GET", "/permission-auditor/audit");
    const editorPublic = audit.findings.filter(
      (finding) => finding.policyId === state.policies.editors && finding.rule.startsWith("PUBLIC_")
    );
    assert.deepEqual(editorPublic, []);
  });
});
