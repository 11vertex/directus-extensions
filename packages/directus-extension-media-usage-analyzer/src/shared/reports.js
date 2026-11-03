const COLUMNS = ["section", "file_id", "filename", "type", "filesize_bytes", "collection", "field", "count", "detail"];

export function formatReportJson(report) {
  return JSON.stringify({ meta: { reportType: "media-usage", version: "1.0.0" }, report }, null, 2);
}

export function formatReportCsv(report) {
  const fileRow = (section, file, detail = "", count = "") =>
    [section, file.id, file.filename_download ?? "", file.type ?? "", file.filesize ?? 0, "", "", count, detail];

  const rows = [
    COLUMNS,
    ...report.unusedFiles.map((file) => fileRow("unused", file, file.title ?? "")),
    ...report.duplicates.groups.flatMap((group) =>
      group.files.map((file) => fileRow("duplicate", file, `group ${group.key} (${group.count} copies)`, group.count))
    ),
    ...report.broken.map((entry) =>
      ["broken_reference", entry.fileId, "", "", "", entry.collection, entry.field, entry.count, entry.label]
    ),
    ...report.largestFiles.map((file) => fileRow("largest", file, dimensions(file))),
    ...(report.images.large ?? []).map((file) => fileRow("large_image", file, dimensions(file))),
    ...report.images.missingDimensions.map((file) => fileRow("missing_dimensions", file)),
    ...report.usage.map((entry) =>
      ["usage", "", "", "", "", entry.collection, entry.field, entry.references, `${entry.label} · ${entry.kind} · ${entry.distinctFiles} files · ${entry.broken} broken`]
    ),
    ...report.storage.byType.map((entry) => ["file_type", "", "", entry.key, entry.bytes, "", "", entry.files, ""]),
    ...report.storage.byStorage.map((entry) => ["storage_location", "", "", "", entry.bytes, "", "", entry.files, entry.key]),
    ...report.storage.byFolder.map((entry) => ["folder", "", "", "", entry.bytes, "", "", entry.files, entry.name])
  ];

  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function dimensions(file) {
  return file.width && file.height ? `${file.width}x${file.height}` : "";
}

function escapeCsv(value) {
  const text = String(value ?? "");
  // Neutralise spreadsheet formula injection for values that start with a formula character.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
