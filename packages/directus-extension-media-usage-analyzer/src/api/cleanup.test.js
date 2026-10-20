import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { processDeletion, validateDeleteRequest } from "./cleanup.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function deps({ existing = [], references = {}, unverified = null, fail = false } = {}) {
  const deleted = [];
  return {
    deleted,
    findExisting: async (ids) => new Set(ids.filter((value) => existing.includes(value))),
    findReferences: async () => ({ references: new Map(Object.entries(references)), unverified }),
    deleteFiles: async (ids) => {
      if (fail) throw new Error("storage down");
      deleted.push(...ids);
    }
  };
}

const status = (result) => Object.fromEntries(result.results.map((entry) => [entry.id, entry.status]));

describe("validateDeleteRequest", () => {
  it("defaults to a dry run", () => {
    assert.equal(validateDeleteRequest({ ids: [id(1)] }).dryRun, true);
    assert.equal(validateDeleteRequest({ ids: [id(1)], dryRun: false }).dryRun, false);
  });

  it("rejects bad payloads", () => {
    assert.throws(() => validateDeleteRequest({}), { status: 400 });
    assert.throws(() => validateDeleteRequest({ ids: [] }), { status: 400 });
    assert.throws(() => validateDeleteRequest({ ids: [id(1)], dryRun: "no" }), { status: 400 });
    assert.throws(() => validateDeleteRequest({ ids: Array.from({ length: 1001 }, (_, n) => id(n)) }), { status: 400 });
  });
});

describe("processDeletion", () => {
  it("previews without deleting", async () => {
    const d = deps({ existing: [id(1), id(2)], references: { [id(2)]: ["articles.cover"] } });
    const result = await processDeletion({ ids: [id(1), id(2), id(3), "bad", id(1)], dryRun: true }, d);
    assert.deepEqual(status(result), { bad: "invalid", [id(1)]: "would_delete", [id(2)]: "in_use", [id(3)]: "not_found" });
    assert.deepEqual(d.deleted, []);
  });

  it("deletes only files that are still unused, in batches", async () => {
    const d = deps({ existing: [id(1), id(2), id(3)], references: { [id(2)]: ["articles.cover"] } });
    const result = await processDeletion({ ids: [id(1), id(2), id(3)], dryRun: false }, d, 2);
    assert.deepEqual(d.deleted, [id(1), id(3)]);
    assert.equal(result.summary.deleted, 2);
    assert.equal(result.summary.in_use, 1);
  });

  it("does not delete when references cannot be verified", async () => {
    const d = deps({ existing: [id(1)], unverified: "too large" });
    const result = await processDeletion({ ids: [id(1)], dryRun: false }, d);
    assert.equal(result.results[0].status, "unverified");
    assert.deepEqual(d.deleted, []);
  });

  it("reports per-id errors when deletion fails", async () => {
    const result = await processDeletion({ ids: [id(1)], dryRun: false }, deps({ existing: [id(1)], fail: true }));
    assert.deepEqual(result.results, [{ id: id(1), status: "error", message: "storage down" }]);
  });
});
