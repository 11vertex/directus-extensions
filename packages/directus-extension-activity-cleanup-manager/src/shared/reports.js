const COLUMNS = ["collection", "exists", "accountability", "activity", "revisions", "versioned_revisions", "oldest", "newest", "actions"];

export function formatOverviewJson(overview) {
  return JSON.stringify({ meta: { reportType: "activity-cleanup-overview", version: "1.0.0" }, overview }, null, 2);
}

export function formatOverviewCsv(overview) {
  const rows = [COLUMNS, ...overview.insights.byCollection.map((item) => [
    item.collection,
    item.exists ? "yes" : "no",
    item.accountability ?? "",
    item.activity,
    item.revisions,
    item.versionedRevisions,
    item.oldest ?? "",
    item.newest ?? "",
    Object.entries(item.actions).map(([action, count]) => `${action}:${count}`).join(" ")
  ])];
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function formatCount(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function escapeCsv(value) {
  const text = String(value ?? "");
  // Neutralise spreadsheet formula injection for values that start with a formula character.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
