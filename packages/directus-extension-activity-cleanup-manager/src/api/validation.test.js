import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIsoDate, parsePurgeRequest } from "./validation.js";

const status = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.status;
  }
  return null;
};

describe("parsePurgeRequest", () => {
  it("defaults to a dry run with the configured batch size", () => {
    const request = parsePurgeRequest({ collection: "articles" }, { defaultBatchSize: 200 });
    assert.deepEqual(request, { collection: "articles", action: null, olderThan: null, dryRun: true, batchSize: 200 });
  });

  it("caps the default batch size", () => {
    assert.equal(parsePurgeRequest({ collection: "a" }, { defaultBatchSize: 50_000 }).batchSize, 1000);
  });

  it("parses action and ISO date", () => {
    const request = parsePurgeRequest({ collection: "a", action: "login", olderThan: "2025-01-31" });
    assert.equal(request.action, "login");
    assert.equal(request.olderThan.toISOString(), "2025-01-31T00:00:00.000Z");
  });

  it("rejects invalid input with 400", () => {
    assert.equal(status(() => parsePurgeRequest(null)), 400);
    assert.equal(status(() => parsePurgeRequest([])), 400);
    assert.equal(status(() => parsePurgeRequest({ collection: "" })), 400);
    assert.equal(status(() => parsePurgeRequest({ collection: 5 })), 400);
    assert.equal(status(() => parsePurgeRequest({ collection: "a", action: "drop" })), 400);
    assert.equal(status(() => parsePurgeRequest({ collection: "a", olderThan: "yesterday" })), 400);
    assert.equal(status(() => parsePurgeRequest({ collection: "a", olderThan: "2025-13-45" })), 400);
    assert.equal(status(() => parsePurgeRequest({ collection: "a", dryRun: "false" })), 400);
    assert.equal(status(() => parsePurgeRequest({ collection: "a", batchSize: 0 })), 400);
    assert.equal(status(() => parsePurgeRequest({ collection: "a", batchSize: 1.5 })), 400);
  });

  it("requires confirm to equal the collection for real runs", () => {
    assert.equal(status(() => parsePurgeRequest({ collection: "articles", dryRun: false })), 400);
    assert.equal(status(() => parsePurgeRequest({ collection: "articles", dryRun: false, confirm: "Articles" })), 400);
    const request = parsePurgeRequest({ collection: "articles", dryRun: false, confirm: "articles" });
    assert.equal(request.dryRun, false);
  });
});

describe("parseIsoDate", () => {
  it("accepts dates and date-times only", () => {
    assert.ok(parseIsoDate("2025-02-01T10:00:00Z"));
    assert.ok(parseIsoDate("2025-02-01T10:00:00.123+05:30"));
    assert.equal(parseIsoDate("02/01/2025"), null);
    assert.equal(parseIsoDate(1735689600000), null);
  });
});
