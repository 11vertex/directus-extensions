import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBytes, formatOverviewCsv, formatOverviewJson } from "./reports.js";

const overview = {
  insights: {
    byCollection: [
      { collection: "=HYPERLINK(\"x\")", exists: false, accountability: null, activity: 3, revisions: 2, versionedRevisions: 0, oldest: null, newest: null, actions: { create: 1, update: 2 } },
      { collection: "notes, drafts", exists: true, accountability: "all", activity: 1, revisions: 1, versionedRevisions: 1, oldest: "2025-01-01T00:00:00.000Z", newest: null, actions: {} }
    ]
  }
};

describe("reports", () => {
  it("formats JSON with metadata", () => {
    assert.equal(JSON.parse(formatOverviewJson(overview)).meta.reportType, "activity-cleanup-overview");
  });

  it("escapes CSV and neutralises formulas", () => {
    const csv = formatOverviewCsv(overview).split("\n");
    assert.equal(csv.length, 3);
    assert.ok(csv[1].startsWith(`"'=HYPERLINK(""x"")"`));
    assert.ok(csv[1].endsWith("create:1 update:2"));
    assert.ok(csv[2].startsWith('"notes, drafts",yes,all'));
  });

  it("formats byte sizes", () => {
    assert.equal(formatBytes(null), "n/a");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(5 * 1024 ** 3), "5.0 GB");
  });
});
