import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clients } from "./support/client.mjs";

const { state, admin } = clients();
const scan = (query = "") => admin.ok("GET", `/media-usage-analyzer/scan${query}`);

describe("Media Usage Analyzer", () => {
  it("counts files and storage", async () => {
    const result = await scan();
    assert.equal(result.summary.files, 4);
    assert.ok(result.summary.totalBytes > 0);
    assert.equal(result.summary.usedFiles, 1);
    assert.equal(result.summary.images, 2);
    assert.equal(result.summary.incomplete, false);
  });

  it("finds unused files but not the cover that an article uses", async () => {
    const result = await scan();
    const unusedIds = result.unusedFiles.map((file) => file.id);
    assert.ok(unusedIds.includes(state.files.unused));
    assert.ok(unusedIds.includes(state.files.duplicateA));
    assert.ok(!unusedIds.includes(state.files.cover), "the article cover is in use");
  });

  it("groups identical uploads as duplicates", async () => {
    const result = await scan();
    assert.equal(result.duplicates.groups.length, 1);
    const ids = result.duplicates.groups[0].files.map((file) => file.id).sort();
    assert.deepEqual(ids, [state.files.duplicateA, state.files.duplicateB].sort());
  });

  it("reports usage per collection and no broken links", async () => {
    const result = await scan();
    const articles = result.usageByCollection.find((entry) => entry.collection === "articles");
    assert.equal(articles.references, 1);
    assert.equal(result.summary.brokenReferences, 0);
  });

  it("can also scan links inside text content", async () => {
    const result = await scan("?content=true");
    assert.equal(result.options.content, true);
    assert.equal(result.summary.contentScanned, true);
  });

  it("dry run protects files that are still in use", async () => {
    const result = await admin.ok("POST", "/media-usage-analyzer/delete", {
      ids: [state.files.cover, state.files.unused],
      dryRun: true
    });
    const byId = Object.fromEntries(result.results.map((entry) => [entry.id, entry]));
    assert.equal(byId[state.files.cover].status, "in_use");
    assert.deepEqual(byId[state.files.cover].references, ["articles.cover"]);
    assert.equal(byId[state.files.unused].status, "would_delete");

    const stillThere = await admin.get(`/files/${state.files.unused}`);
    assert.equal(stillThere.status, 200, "a dry run deletes nothing");
  });

  it("deletes an unused file for real and leaves used ones alone", async () => {
    const result = await admin.ok("POST", "/media-usage-analyzer/delete", {
      ids: [state.files.unused, state.files.cover],
      dryRun: false
    });
    const byId = Object.fromEntries(result.results.map((entry) => [entry.id, entry]));
    assert.equal(byId[state.files.unused].status, "deleted");
    assert.equal(byId[state.files.cover].status, "in_use");

    assert.notEqual((await admin.get(`/files/${state.files.unused}`)).status, 200, "unused file is gone");
    assert.equal((await admin.get(`/files/${state.files.cover}`)).status, 200, "cover is kept");
    const after = await scan();
    assert.equal(after.summary.files, 3);
  });

  it("rejects an empty delete request", async () => {
    const response = await admin.post("/media-usage-analyzer/delete", { ids: [] });
    assert.equal(response.status, 400);
  });
});
