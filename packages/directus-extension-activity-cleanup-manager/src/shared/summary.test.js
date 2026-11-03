import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeRetention } from "../api/analyzer.js";
import { cutoffFor, enableEnv, humanDuration, statusLine, timeAgo, topTip } from "./summary.js";

const insights = (overrides = {}) => ({
  totals: { activity: 800_000, revisions: 50_000 },
  tableSizes: null,
  byCollection: [],
  ...overrides
});

describe("statusLine", () => {
  it("describes size and an inactive cleanup", () => {
    const line = statusLine({ insights: insights(), retention: describeRetention({}) });
    assert.deepEqual(line, { usage: "History has 850,000 records.", on: false, cleanup: "Off" });
  });

  it("uses Postgres table sizes and the active retention period", () => {
    const line = statusLine({
      insights: insights({ tableSizes: { activity: 1024 ** 3, revisions: 0.2 * 1024 ** 3 } }),
      retention: describeRetention({ RETENTION_ENABLED: "true" })
    });
    assert.equal(line.usage, "History uses 1.2 GB (850,000 records).");
    assert.equal(line.cleanup, "On — keeps 90 days");
  });

  it("explains an invalid schedule", () => {
    const line = statusLine({ insights: insights(), retention: describeRetention({ RETENTION_ENABLED: "true", RETENTION_SCHEDULE: "nope" }) });
    assert.equal(line.cleanup, "Off (the schedule setting is invalid)");
  });
});

describe("enableEnv", () => {
  it("uses the server suggestion when present and fixes an invalid schedule", () => {
    const retention = describeRetention({});
    assert.deepEqual(enableEnv({ retention }), { RETENTION_ENABLED: "true", ACTIVITY_RETENTION: "90d", REVISIONS_RETENTION: "90d" });
    const suggested = { RETENTION_ENABLED: "true", ACTIVITY_RETENTION: "30d", REVISIONS_RETENTION: "30d" };
    assert.deepEqual(enableEnv({ retention, recommendations: [{ env: { FLOW_LOGS_RETENTION: "14d" } }, { env: suggested }] }), suggested);
    const invalid = describeRetention({ RETENTION_SCHEDULE: "nope" });
    assert.equal(enableEnv({ retention: invalid }).RETENTION_SCHEDULE, "0 0 * * *");
  });
});

describe("topTip", () => {
  it("prefers history of deleted collections", () => {
    const tip = topTip(insights({ byCollection: [
      { collection: "articles", exists: true, activity: 700_000, revisions: 0 },
      { collection: "old", exists: false, activity: 1_000, revisions: 500 }
    ] }));
    assert.equal(tip, "1,500 records belong to deleted collections. You can clean them up below.");
  });

  it("names a dominant collection with its display name", () => {
    const tip = topTip(insights({ byCollection: [{ collection: "articles", exists: true, activity: 600_000, revisions: 0 }] }), () => "Articles");
    assert.equal(tip, "Articles makes up 71% of all history. Cleaning it up frees the most space.");
  });

  it("returns null when nothing stands out", () => {
    assert.equal(topTip(insights({ byCollection: [{ collection: "a", exists: true, activity: 100, revisions: 0 }] })), null);
  });
});

describe("helpers", () => {
  it("computes cut-off dates", () => {
    const now = new Date("2026-01-31T00:00:00.000Z");
    assert.equal(cutoffFor("30d", now), "2026-01-01T00:00:00.000Z");
    assert.equal(cutoffFor("all", now), null);
  });

  it("humanises durations", () => {
    assert.equal(humanDuration("90d"), "90 days");
    assert.equal(humanDuration("1d"), "1 day");
    assert.equal(humanDuration("12h"), "12 hours");
    assert.equal(humanDuration(null), null);
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-01-10T12:00:00Z");
    assert.equal(timeAgo(null, now), "—");
    assert.equal(timeAgo("2026-01-10T11:55:00Z", now), "5 minutes ago");
    assert.equal(timeAgo("2024-01-10T12:00:00Z", now), "2 years ago");
  });
});
