const COLUMNS = ["severity", "rule", "policy", "collection", "action", "title", "detail", "hint"];

export function formatAuditJson(audit) {
  return JSON.stringify({ meta: { reportType: "permission-audit", version: "1.0.0" }, audit }, null, 2);
}

export function formatAuditCsv(audit) {
  const rows = [COLUMNS, ...audit.findings.map((finding) => [
    finding.severity,
    finding.rule,
    finding.policyName ?? finding.policyId ?? "",
    finding.collection ?? "",
    finding.action ?? "",
    finding.title,
    finding.detail,
    finding.hint ?? ""
  ])];
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function escapeCsv(value) {
  const text = String(value ?? "");
  // Neutralise spreadsheet formula injection for values that start with a formula character.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
