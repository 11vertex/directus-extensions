import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeMedia, categoryOf, findDuplicates, normalizeFile } from "./analyzer.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const file = (n, extra = {}) => ({ id: id(n), filename_download: `file-${n}.jpg`, type: "image/jpeg", filesize: 1000, width: 100, height: 100, folder: null, storage: "local", uploaded_on: `2024-01-0${n % 9 + 1}`, ...extra });

const files = [
  file(1),
  file(2, { filesize: "52428800", width: 6000, height: 4000 }),
  file(3, { filename_download: "dup.png", type: "image/png", filesize: 500 }),
  file(4, { filename_download: "dup.png", type: "image/png", filesize: 500, width: null, height: null }),
  file(5, { filename_download: "doc.pdf", type: "application/pdf", filesize: 2000, width: null, height: null, folder: "F1" })
];

const sources = [
  { id: "articles.cover", label: "articles.cover", collection: "articles", field: "cover", kind: "m2o", references: new Map([[id(1), 3], [id(99), 2]]) },
  { id: "directus_users.avatar", label: "directus_users.avatar", collection: "directus_users", field: "avatar", kind: "m2o", system: true, references: new Map([[id(3).toUpperCase(), "1"]]) }
];

describe("analyzeMedia", () => {
  const report = analyzeMedia({ files, folders: [{ id: "f1", name: "Docs" }], sources });

  it("separates used and unused files", () => {
    assert.equal(report.summary.files, 5);
    assert.equal(report.summary.usedFiles, 2);
    assert.deepEqual(report.unusedFiles.map((entry) => entry.id), [id(2), id(5), id(4)]);
    assert.equal(report.summary.unusedBytes, 52428800 + 2000 + 500);
  });

  it("reports broken references to missing files", () => {
    assert.equal(report.summary.brokenReferences, 2);
    assert.deepEqual(report.broken[0], {
      fileId: id(99),
      count: 2,
      source: "articles.cover",
      label: "articles.cover",
      collection: "articles",
      field: "cover",
      kind: "m2o",
      usageCollection: "articles",
      usageField: "cover"
    });
    const cover = report.usage.find((entry) => entry.source === "articles.cover");
    assert.equal(cover.references, 5);
    assert.equal(cover.distinctFiles, 1);
    assert.equal(cover.broken, 2);
  });

  it("aggregates storage by type, category and folder", () => {
    assert.equal(report.summary.totalBytes, 1000 + 52428800 + 500 + 500 + 2000);
    assert.equal(report.storage.byType[0].key, "image/jpeg");
    assert.equal(report.storage.byCategory.find((entry) => entry.key === "document").files, 1);
    assert.equal(report.storage.byFolder.find((entry) => entry.key === "f1").name, "Docs");
    assert.equal(report.largestFiles[0].id, id(2));
  });

  it("analyses image dimensions", () => {
    assert.equal(report.images.total, 4);
    assert.equal(report.images.missingCount, 1);
    assert.equal(report.images.oversizedCount, 1);
    assert.equal(report.images.largest[0].megapixels, 24);
  });

  it("lists large images by pixel size or file size", () => {
    const withHeavy = analyzeMedia({ files: [...files, file(6, { filesize: 20 * 1024 * 1024 })] });
    assert.deepEqual(withHeavy.images.large.map((entry) => entry.id), [id(2), id(6)]);
    assert.equal(withHeavy.summary.largeImages, 2);
    assert.equal(withHeavy.summary.largeImagesBytes, 52428800 + 20 * 1024 * 1024);
  });

  it("derives recommendations", () => {
    const text = report.recommendations.map((entry) => entry.text).join("\n");
    assert.match(text, /Content links were not scanned/);
    assert.match(text, /duplicate/);
    assert.match(text, /no longer exist/);
    assert.match(text, /larger than/);
  });

  it("flags incomplete scans", () => {
    const incomplete = analyzeMedia({ files, warnings: ["boom"] });
    assert.equal(incomplete.summary.incomplete, true);
    assert.equal(incomplete.recommendations[0].level, "warning");
  });

  it("recommends nothing when everything is used", () => {
    const clean = analyzeMedia({ files: [file(1)], sources: [{ id: "a.b", label: "a.b", references: new Map([[id(1), 1]]) }], contentScanned: true });
    assert.equal(clean.recommendations[0].level, "success");
  });
});

describe("findDuplicates", () => {
  it("groups by size, name and type without a checksum", () => {
    const result = findDuplicates(files.map((entry) => normalizeFile(entry)));
    assert.equal(result.heuristic, "size-name-type");
    assert.equal(result.groupCount, 1);
    assert.equal(result.groups[0].count, 2);
    assert.equal(result.wastedBytes, 500);
  });

  it("prefers a checksum column when available", () => {
    const rows = [file(1, { md5: "x" }), file(2, { md5: "x", filesize: 9 }), file(3, { md5: "y" })].map((entry) => normalizeFile(entry, "md5"));
    const result = findDuplicates(rows, "md5");
    assert.equal(result.heuristic, "checksum");
    assert.equal(result.groupCount, 1);
  });
});

describe("categoryOf", () => {
  it("categorises MIME types", () => {
    assert.equal(categoryOf("video/mp4"), "video");
    assert.equal(categoryOf("application/zip"), "archive");
    assert.equal(categoryOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "document");
    assert.equal(categoryOf(null), "unknown");
  });
});
