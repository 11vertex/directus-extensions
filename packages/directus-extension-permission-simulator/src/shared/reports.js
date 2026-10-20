const REPORT_VERSION = "1.0.0";
function buildReportMetadata(reportType, format, generatedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  return {
    generatedAt,
    reportType,
    format,
    version: REPORT_VERSION
  };
}
function formatSimulateJson(result) {
  return JSON.stringify(
    {
      meta: buildReportMetadata("simulate", "json"),
      result
    },
    null,
    2
  );
}
function formatCompareJson(result) {
  return JSON.stringify(
    {
      meta: buildReportMetadata("compare", "json"),
      result
    },
    null,
    2
  );
}
function formatSimulateCsv(result) {
  const rows = [
    ["section", "key", "value"],
    ["meta", "reportType", "simulate"],
    ["meta", "generatedAt", buildReportMetadata("simulate", "csv").generatedAt],
    ["principal", "id", result.principal.id],
    ["principal", "label", result.principal.label],
    ["principal", "mode", result.mode],
    ["principal", "admin", String(result.principal.admin)],
    ["principal", "app", String(result.principal.app)]
  ];
  for (const [collection, access] of Object.entries(result.collectionAccess)) {
    for (const action of ["create", "read", "update", "delete"]) {
      rows.push([
        "collectionAccess",
        `${collection}.${action}`,
        access[action]?.access ?? "none"
      ]);
    }
  }
  for (const action of result.actions) {
    rows.push([
      "action",
      action.action,
      [
        `access=${action.access}`,
        `allowed=${action.allowed}`,
        `itemAllowed=${action.itemAllowed}`,
        `reason=${action.reason ?? ""}`
      ].join(";")
    ]);
  }
  for (const field of result.fields) {
    rows.push([
      "field",
      field.field,
      `create=${Boolean(field.actions.create)};read=${Boolean(field.actions.read)};update=${Boolean(field.actions.update)};delete=${Boolean(field.actions.delete)}`
    ]);
  }
  for (const conflict of result.conflicts) {
    rows.push([
      "conflict",
      `${conflict.kind}:${conflict.collection}.${conflict.action}`,
      `${conflict.severity}: ${conflict.message}`
    ]);
  }
  return toCsv(rows);
}
function formatCompareCsv(result) {
  const rows = [
    ["section", "key", "value"],
    ["meta", "reportType", "compare"],
    ["meta", "generatedAt", buildReportMetadata("compare", "csv").generatedAt],
    ["left", "id", result.left.principal.id],
    ["left", "label", result.left.principal.label],
    ["right", "id", result.right.principal.id],
    ["right", "label", result.right.principal.label],
    ["summary", "gained", String(result.summary.gained)],
    ["summary", "lost", String(result.summary.lost)],
    ["summary", "changed", String(result.summary.changed)],
    ["summary", "same", String(result.summary.same)],
    ["summary", "fieldGained", String(result.summary.fieldGained)],
    ["summary", "fieldLost", String(result.summary.fieldLost)],
    ["summary", "conflictCount", String(result.summary.conflictCount)]
  ];
  for (const diff of result.accessDiffs) {
    if (diff.change === "same") continue;
    rows.push([
      "accessDiff",
      `${diff.collection}.${diff.action}`,
      `${diff.left}->${diff.right} (${diff.change})`
    ]);
  }
  for (const diff of result.fieldDiffs) {
    if (diff.change === "same") continue;
    rows.push([
      "fieldDiff",
      `${diff.field}.${diff.action}`,
      `${diff.left}->${diff.right} (${diff.change})`
    ]);
  }
  for (const conflict of result.conflicts) {
    rows.push([
      "conflict",
      `${conflict.kind}:${conflict.collection}.${conflict.action}`,
      `${conflict.severity}: ${conflict.message}`
    ]);
  }
  return toCsv(rows);
}
function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n";
}
function escapeCsv(value) {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
export {
  buildReportMetadata,
  formatCompareCsv,
  formatCompareJson,
  formatSimulateCsv,
  formatSimulateJson
};
