import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clients } from "./support/client.mjs";

const { admin } = clients();
const purge = (body) => admin.post("/activity-cleanup-manager/purge", body);
const activityCount = async (collection) => {
  const rows = await admin.ok("GET", `/activity?filter[collection][_eq]=${collection}&aggregate[count]=*`);
  return Number(rows[0].count);
};

describe("Activity & Revisions Cleanup Manager", () => {
  it("summarises history per collection", async () => {
    const overview = await admin.ok("GET", "/activity-cleanup-manager/overview");
    const { totals, byCollection } = overview.insights;
    assert.ok(totals.activity > 0);
    assert.equal(totals.flowRunLogs, 4, "the four seeded flow runs are counted");
    const comments = byCollection.find((entry) => entry.collection === "comments");
    assert.equal(comments.activity, 2);
    assert.equal(comments.actions.create, 2);
  });

  it("reports that native automatic cleanup is off", async () => {
    const retention = await admin.ok("GET", "/activity-cleanup-manager/retention");
    assert.equal(retention.enabled, false);
    assert.equal(retention.active, false);
  });

  it("previews a purge without deleting anything", async () => {
    const before = await activityCount("comments");
    const result = await purge({ collection: "comments", dryRun: true });
    assert.equal(result.status, 200);
    assert.equal(result.data.preview.activity, 2);
    assert.equal(result.data.deleted, null);
    assert.equal(await activityCount("comments"), before);
  });

  it("refuses a real purge without the right confirmation", async () => {
    const result = await purge({ collection: "comments", dryRun: false, confirm: "articles" });
    assert.equal(result.status, 400);
    assert.equal(await activityCount("comments"), 2);
  });

  it("refuses unknown collections", async () => {
    const result = await purge({ collection: "does_not_exist", dryRun: true });
    assert.equal(result.status, 400);
  });

  it("purges one collection's history and nothing else", async () => {
    const articlesBefore = await activityCount("articles");
    const result = await purge({ collection: "comments", dryRun: false, confirm: "comments" });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.deleted.activity, 2);
    assert.equal(result.data.deleted.revisions, 2);
    assert.equal(await activityCount("comments"), 0);
    assert.equal(await activityCount("articles"), articlesBefore, "other collections keep their history");

    const items = await admin.ok("GET", "/items/comments?aggregate[count]=*");
    assert.equal(Number(items[0].count), 2, "the comments themselves are untouched");
  });
});
