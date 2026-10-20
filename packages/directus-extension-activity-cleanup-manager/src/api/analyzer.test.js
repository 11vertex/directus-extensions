import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  averageMonthly,
  buildInsights,
  buildMonthRanges,
  describeRetention,
  formatTimestamp,
  looksLikeCron,
  parseDuration,
  recommend,
  resolveDialect,
  suggestRetentionDays,
  toIso
} from "./analyzer.js";

const DAY = 86_400_000;

describe("parseDuration", () => {
  it("matches the ms package formats used by Directus", () => {
    assert.equal(parseDuration("90d"), 90 * DAY);
    assert.equal(parseDuration("2 weeks"), 14 * DAY);
    assert.equal(parseDuration("12h"), 12 * 3_600_000);
    assert.equal(parseDuration("1000"), 1000);
    assert.equal(parseDuration(500), 500);
    assert.equal(parseDuration("1y"), 365.25 * DAY);
  });

  it("returns null for unset or invalid values", () => {
    assert.equal(parseDuration(""), null);
    assert.equal(parseDuration(false), null);
    assert.equal(parseDuration(undefined), null);
    assert.equal(parseDuration("false"), null);
    assert.equal(parseDuration("10 parsecs"), null);
  });
});

describe("resolveDialect", () => {
  it("normalises knex client names", () => {
    assert.equal(resolveDialect({ client: { config: { client: "pg" } } }), "postgres");
    assert.equal(resolveDialect({ client: { config: { client: "mysql2" } } }), "mysql");
    assert.equal(resolveDialect({ client: { config: { client: "sqlite3" } } }), "sqlite");
    assert.equal(resolveDialect({}), "unknown");
  });

  it("formats timestamps per dialect", () => {
    const date = new Date("2025-01-01T00:00:00Z");
    assert.equal(formatTimestamp("postgres", date), "2025-01-01T00:00:00.000Z");
    assert.equal(formatTimestamp("sqlite", date), String(date.getTime()));
  });
});

describe("describeRetention", () => {
  it("applies Directus defaults when nothing is set", () => {
    const retention = describeRetention({}, { source: "process.env" });
    assert.equal(retention.enabled, false);
    assert.equal(retention.active, false);
    assert.equal(retention.batch, 500);
    assert.equal(retention.timeframes.activity, 90 * DAY);
    assert.equal(retention.defaults.ACTIVITY_RETENTION, true);
    // Equal activity and revisions timeframes: the native standalone revisions task is not scheduled.
    assert.equal(retention.tasks.revisions, false);
    assert.equal(retention.effective.revisions, "90d");
  });

  it("detects active retention and ineffective revisions retention", () => {
    const retention = describeRetention({
      RETENTION_ENABLED: "true",
      RETENTION_SCHEDULE: "0 3 * * *",
      ACTIVITY_RETENTION: "30d",
      REVISIONS_RETENTION: "180d",
      FLOW_LOGS_RETENTION: "7d"
    });
    assert.equal(retention.active, true);
    assert.equal(retention.tasks.revisions, false);
    assert.equal(retention.effective.revisions, "30d");
    assert.ok(retention.notes.some((note) => note.includes("REVISIONS_RETENTION")));
  });

  it("schedules the revisions task when activity is kept longer", () => {
    const retention = describeRetention({ RETENTION_ENABLED: true, ACTIVITY_RETENTION: "180d", REVISIONS_RETENTION: "30d" });
    assert.equal(retention.tasks.revisions, true);
    assert.equal(retention.effective.revisions, "30d");
  });

  it("treats disabled timeframes as never expiring", () => {
    const retention = describeRetention({ RETENTION_ENABLED: true, ACTIVITY_RETENTION: false, REVISIONS_RETENTION: false });
    assert.equal(retention.effective.activity, null);
    assert.equal(retention.effective.revisions, null);
    assert.equal(retention.tasks.activity, false);
  });

  it("flags an invalid schedule", () => {
    assert.equal(describeRetention({ RETENTION_ENABLED: "true", RETENTION_SCHEDULE: "nightly" }).active, false);
    assert.equal(looksLikeCron("*/15 * * * *"), true);
    assert.equal(looksLikeCron("@daily"), true);
  });
});

describe("buildMonthRanges", () => {
  it("returns twelve UTC months ending with the current one", () => {
    const ranges = buildMonthRanges(new Date("2026-03-15T12:00:00Z"));
    assert.equal(ranges.length, 12);
    assert.equal(ranges[0].month, "2025-04");
    assert.equal(ranges.at(-1).month, "2026-03");
    assert.equal(ranges.at(-1).end.toISOString(), "2026-04-01T00:00:00.000Z");
  });
});

describe("buildInsights", () => {
  const insights = buildInsights({
    activityGroups: [
      { collection: "articles", action: "create", count: "10", oldest: new Date("2024-01-01"), newest: new Date("2025-01-01") },
      { collection: "articles", action: "update", count: 30, oldest: "2023-06-01T00:00:00Z", newest: "2025-06-01T00:00:00Z" },
      { collection: "directus_flows", action: "run", count: 5, oldest: "1700000000000", newest: null },
      { collection: "old_stuff", action: "delete", count: 2, oldest: null, newest: null }
    ],
    revisionGroups: [
      { collection: "articles", count: "38", versioned: "3" },
      { collection: "directus_flows", count: 5, versioned: 0 }
    ],
    monthly: [{ month: "2025-01", activity: "4", revisions: 2 }],
    schemaCollections: { articles: { accountability: "all" } },
    dialect: "postgres"
  });

  it("aggregates totals per collection and action", () => {
    assert.equal(insights.totals.activity, 47);
    assert.equal(insights.totals.revisions, 43);
    assert.equal(insights.totals.versionedRevisions, 3);
    assert.equal(insights.totals.flowRunLogs, 5);
    assert.equal(insights.byCollection[0].collection, "articles");
    assert.deepEqual(insights.byCollection[0].actions, { create: 10, update: 30 });
    assert.equal(insights.byAction[0].action, "update");
    assert.equal(insights.monthly[0].activity, 4);
  });

  it("tracks oldest/newest and orphaned collections", () => {
    assert.equal(insights.totals.oldest, "2023-06-01T00:00:00.000Z");
    assert.equal(insights.byCollection.find((item) => item.collection === "directus_flows").oldest, new Date(1_700_000_000_000).toISOString());
    assert.equal(insights.totals.newest, "2025-06-01T00:00:00.000Z");
    assert.equal(insights.byCollection.find((item) => item.collection === "old_stuff").exists, false);
    assert.equal(insights.byCollection.find((item) => item.collection === "directus_flows").exists, true);
  });

  it("normalises timestamps", () => {
    assert.equal(toIso(null), null);
    assert.equal(toIso("not a date"), null);
    assert.equal(toIso(0), "1970-01-01T00:00:00.000Z");
  });
});

describe("recommend", () => {
  const monthly = Array.from({ length: 12 }, (_, index) => ({ month: `m${index}`, activity: 50_000, revisions: 40_000 }));
  const base = {
    totals: { activity: 600_000, revisions: 480_000, versionedRevisions: 0, flowRunLogs: 300_000, oldest: "2020-01-01T00:00:00Z" },
    byCollection: [
      { collection: "articles", activity: 290_000, revisions: 280_000, exists: true, accountability: "all" },
      { collection: "gone", activity: 10, revisions: 0, exists: false }
    ],
    byAction: [{ action: "run", count: 300_000 }],
    monthly,
    tableSizes: { activity: 2 * 1024 ** 3, revisions: 0 }
  };

  it("suggests enabling retention, shorter flow logs and targeted purges", () => {
    const items = recommend({ insights: base, retention: describeRetention({}) });
    const titles = items.map((item) => item.title);
    assert.ok(titles.includes("Enable native retention"));
    assert.equal(items.find((item) => item.title === "Enable native retention").env.RETENTION_ENABLED, "true");
    assert.ok(titles.includes("Expire flow run logs sooner"));
    assert.ok(titles.some((title) => title.includes('"articles" dominates')));
    assert.ok(titles.some((title) => title.includes('orphaned history of "gone"')));
    assert.ok(titles.includes("History tables are large"));
  });

  it("warns when revisions retention cannot take effect", () => {
    const retention = describeRetention({ RETENTION_ENABLED: "true", ACTIVITY_RETENTION: "30d", REVISIONS_RETENTION: "1y" });
    const items = recommend({ insights: base, retention, now: new Date("2026-01-01") });
    assert.ok(items.some((item) => item.title === "REVISIONS_RETENTION has no effect"));
    assert.ok(items.some((item) => item.title === "Rows older than ACTIVITY_RETENTION remain"));
  });

  it("reports success for a small healthy project", () => {
    const items = recommend({
      insights: {
        totals: { activity: 100, revisions: 80, versionedRevisions: 0, flowRunLogs: 0, oldest: null },
        byCollection: [],
        byAction: [],
        monthly: Array.from({ length: 12 }, () => ({ activity: 0, revisions: 0 })),
        tableSizes: null
      },
      retention: describeRetention({ RETENTION_ENABLED: "true" })
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].level, "success");
  });

  it("averages complete months and picks a retention window", () => {
    assert.equal(averageMonthly([{ activity: 0 }, { activity: 10 }, { activity: 20 }, { activity: 999 }]), 15);
    assert.equal(suggestRetentionDays(50_000), 365);
    assert.equal(suggestRetentionDays(400_000), 60);
    assert.equal(suggestRetentionDays(10_000_000), 30);
  });
});
