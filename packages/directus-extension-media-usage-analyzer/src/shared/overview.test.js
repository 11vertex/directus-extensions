import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { timeAgo, typeLabel } from "./format.js";
import { deletionResultText, filesLabel, focusCard, storageByKind } from "./overview.js";

describe("storageByKind", () => {
  it("folds categories into images, video, documents and other", () => {
    const rows = storageByKind([
      { key: "image", files: 2, bytes: 100 },
      { key: "audio", files: 1, bytes: 30 },
      { key: "archive", files: 1, bytes: 40 },
      { key: "document", files: 3, bytes: 10 }
    ]);
    assert.deepEqual(rows, [
      { label: "Images", files: 2, bytes: 100 },
      { label: "Other", files: 2, bytes: 70 },
      { label: "Documents", files: 3, bytes: 10 }
    ]);
  });
});

describe("focusCard", () => {
  const base = { unusedFiles: 0, unusedBytes: 0, duplicateGroups: 0, duplicateWastedBytes: 0, brokenReferences: 0, largeImages: 0 };
  it("picks the card that frees the most space, then broken links, then large images", () => {
    assert.equal(focusCard({ ...base, unusedFiles: 2, unusedBytes: 10 }), "unused");
    assert.equal(focusCard({ ...base, unusedFiles: 2, unusedBytes: 10, duplicateGroups: 1, duplicateWastedBytes: 50 }), "duplicates");
    assert.equal(focusCard({ ...base, brokenReferences: 1, largeImages: 3 }), "broken");
    assert.equal(focusCard({ ...base, largeImages: 3 }), "large");
    assert.equal(focusCard(base), null);
  });
});

describe("deletionResultText", () => {
  it("combines the preview and the real run into one sentence", () => {
    const preview = { summary: { would_delete: 12, in_use: 1 } };
    const deletion = { summary: { deleted: 12 } };
    assert.equal(deletionResultText(preview, deletion), "12 deleted, 1 skipped because it is now used");
    assert.equal(
      deletionResultText({ summary: { in_use: 2, not_found: 1 } }, null),
      "0 deleted, 2 skipped because they are now used, 1 skipped because it was already deleted"
    );
  });
});

describe("filesLabel", () => {
  it("pluralises", () => {
    assert.equal(filesLabel(1, 1536), "1 file (1.5 KB)");
    assert.equal(filesLabel(12, 0), "12 files (0 B)");
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  it("formats relative times", () => {
    assert.equal(timeAgo(null, now), "—");
    assert.equal(timeAgo("2026-01-10T11:59:30Z", now), "just now");
    assert.equal(timeAgo("2026-01-10T11:55:00Z", now), "5 minutes ago");
    assert.equal(timeAgo("2026-01-09T12:00:00Z", now), "yesterday");
    assert.equal(timeAgo("2025-10-10T12:00:00Z", now), "3 months ago");
  });
});

describe("typeLabel", () => {
  it("describes MIME types in plain words", () => {
    assert.equal(typeLabel("image/jpeg"), "Image · JPEG");
    assert.equal(typeLabel("image/svg+xml"), "Image · SVG");
    assert.equal(typeLabel("application/pdf"), "PDF document");
    assert.equal(typeLabel("application/zip"), "ZIP");
    assert.equal(typeLabel(null), "File");
  });
});
