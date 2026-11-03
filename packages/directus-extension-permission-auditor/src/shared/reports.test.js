import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAuditCsv, formatAuditJson } from "./reports.js";

const audit = {
  findings: [
    { severity: "high", rule: "R", policyName: "P", collection: "a", action: "read", title: "T, with comma", detail: '=cmd "x"', hint: "h" }
  ]
};

describe("reports", () => {
  it("formats JSON with metadata", () => {
    assert.equal(JSON.parse(formatAuditJson(audit)).meta.reportType, "permission-audit");
  });

  it("escapes CSV and neutralises formulas", () => {
    const csv = formatAuditCsv(audit).split("\n");
    assert.equal(csv.length, 2);
    assert.ok(csv[1].includes('"T, with comma"'));
    assert.ok(csv[1].includes(`"'=cmd ""x"""`));
  });
});
