const REPORT_VERSION = "1.0.0";

function buildReportMetadata(reportType, format, generatedAt = new Date().toISOString()) {
  return {
    generatedAt,
    reportType,
    format,
    version: REPORT_VERSION
  };
}

function formatExecutionsJson(listResult, detail = null) {
  return JSON.stringify(
    {
      meta: buildReportMetadata("flow-executions", "json"),
      list: listResult,
      detail
    },
    null,
    2
  );
}

function formatExecutionDetailJson(detail) {
  return JSON.stringify(
    {
      meta: buildReportMetadata("flow-execution-detail", "json"),
      detail
    },
    null,
    2
  );
}

function formatExecutionsCsv(listResult) {
  const rows = [
    [
      "id",
      "flowId",
      "flowName",
      "finalStatus",
      "completedAt",
      "userId",
      "hasDetails",
      "stepCount",
      "failedStepKey",
      "origin"
    ]
  ];

  for (const item of listResult.items ?? []) {
    rows.push([
      item.id,
      item.flowId ?? "",
      item.flowName ?? "",
      item.finalStatus ?? "",
      item.completedAt ?? "",
      item.userId ?? "",
      String(Boolean(item.hasDetails)),
      item.stepCount ?? 0,
      item.failedStepKey ?? "",
      item.origin ?? ""
    ]);
  }

  return toCsv(rows);
}

function formatExecutionDetailCsv(detail) {
  const rows = [
    ["section", "key", "value"],
    ["meta", "reportType", "flow-execution-detail"],
    ["meta", "generatedAt", buildReportMetadata("flow-execution-detail", "csv").generatedAt],
    ["execution", "id", detail.id],
    ["execution", "flowId", detail.flowId ?? ""],
    ["execution", "flowName", detail.flowName ?? ""],
    ["execution", "finalStatus", detail.finalStatus ?? ""],
    ["execution", "completedAt", detail.completedAt ?? ""],
    ["execution", "userId", detail.userId ?? ""],
    ["execution", "hasDetails", String(Boolean(detail.hasDetails))]
  ];

  for (const step of detail.steps ?? []) {
    rows.push([
      "step",
      `${step.index}:${step.key}`,
      [
        `status=${step.status}`,
        `type=${step.type ?? ""}`,
        `name=${step.name ?? ""}`,
        `isError=${Boolean(step.isError)}`
      ].join(";")
    ]);
  }

  for (const warning of detail.warnings ?? []) {
    rows.push(["warning", "message", warning]);
  }

  return toCsv(rows);
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value) {
  const text = value === null || value === void 0 ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export {
  buildReportMetadata,
  formatExecutionDetailCsv,
  formatExecutionDetailJson,
  formatExecutionsCsv,
  formatExecutionsJson
};
