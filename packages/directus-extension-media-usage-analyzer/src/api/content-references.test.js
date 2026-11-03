import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractAssetIds, isUuid } from "./content-references.js";

const A = "1b2c3d4e-0000-4000-8000-00000000000a";
const B = "1B2C3D4E-0000-4000-8000-00000000000B";

describe("extractAssetIds", () => {
  it("finds relative and absolute asset links in HTML", () => {
    const html = `<img src="/assets/${A}?width=200"><a href="https://cms.example.com/assets/${B}/file.pdf">x</a><img src="/assets/${A}">`;
    assert.deepEqual(extractAssetIds(html), [A, B.toLowerCase()]);
  });

  it("finds links inside JSON values", () => {
    assert.deepEqual(extractAssetIds({ blocks: [{ data: { url: `/assets/${A}` } }] }), [A]);
  });

  it("ignores values without asset links", () => {
    assert.deepEqual(extractAssetIds(`plain ${A}`), []);
    assert.deepEqual(extractAssetIds(null), []);
    assert.deepEqual(extractAssetIds("/assets/not-a-uuid"), []);
  });
});

describe("isUuid", () => {
  it("validates uuids", () => {
    assert.equal(isUuid(A), true);
    assert.equal(isUuid("../etc/passwd"), false);
    assert.equal(isUuid(42), false);
  });
});
