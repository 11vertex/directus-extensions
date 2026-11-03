import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatHistoryCsv, formatHistoryJson } from "./reports.js";

const list = {
  items: [
    {
      id: 1,
      timestamp: "2026-07-31T00:00:00.000Z",
      action: "update",
      entity: "operation",
      entityLabel: "Send webhook",
      itemId: "op-1",
      actor: { label: "Ada Lovelace" },
      changedFields: ["options"],
      hasRevision: true
    }
  ]
};

describe("history reports", () => {
  it("formats JSON with detail and comparison", () => {
    const parsed = JSON.parse(
      formatHistoryJson(list, { id: 1 }, { differences: [] })
    );
    assert.equal(parsed.meta.type, "flow-version-history");
    assert.equal(parsed.detail.id, 1);
    assert.deepEqual(parsed.comparison.differences, []);
  });

  it("formats CSV rows", () => {
    const csv = formatHistoryCsv(list);
    assert.ok(csv.includes("Send webhook"));
    assert.ok(csv.includes("Ada Lovelace"));
    assert.ok(csv.includes("options"));
  });
});
