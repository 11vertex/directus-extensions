import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeMedia } from "../api/analyzer.js";
import { formatBytes } from "./format.js";
import { formatReportCsv, formatReportJson } from "./reports.js";

const report = analyzeMedia({
  files: [
    { id: "00000000-0000-4000-8000-000000000001", filename_download: '=HYPERLINK("x"), a.jpg', type: "image/jpeg", filesize: 10 },
    { id: "00000000-0000-4000-8000-000000000002", filename_download: "b.jpg", type: "image/jpeg", filesize: 10 }
  ]
});

describe("reports", () => {
  it("formats JSON with metadata", () => {
    const parsed = JSON.parse(formatReportJson(report));
    assert.equal(parsed.meta.reportType, "media-usage");
    assert.equal(parsed.report.summary.files, 2);
  });

  it("escapes CSV and neutralises formulas", () => {
    const lines = formatReportCsv(report).split("\n");
    assert.equal(lines[0], "section,file_id,filename,type,filesize_bytes,collection,field,count,detail");
    const unused = lines.find((line) => line.startsWith("unused,00000000-0000-4000-8000-000000000001"));
    assert.ok(unused.includes(`"'=HYPERLINK(""x""), a.jpg"`));
    assert.ok(lines.some((line) => line.startsWith("file_type,,,image/jpeg,20")));
  });
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(50 * 1024 * 1024), "50.0 MB");
  });
});
