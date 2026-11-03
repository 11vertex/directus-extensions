function reportMeta(type, format) {
  return {
    type,
    format,
    version: "1.0.0",
    generatedAt: new Date().toISOString()
  };
}

function formatHistoryJson(list, detail = null, comparison = null) {
  return JSON.stringify(
    {
      meta: reportMeta("flow-version-history", "json"),
      list,
      detail,
      comparison
    },
    null,
    2
  );
}

function formatHistoryCsv(list) {
  const rows = [
    [
      "activityId",
      "timestamp",
      "action",
      "entity",
      "entityLabel",
      "itemId",
      "actor",
      "changedFields",
      "hasRevision"
    ]
  ];
  for (const item of list.items ?? []) {
    rows.push([
      item.id,
      item.timestamp ?? "",
      item.action,
      item.entity,
      item.entityLabel,
      item.itemId,
      item.actor?.label ?? "",
      (item.changedFields ?? []).join("|"),
      String(Boolean(item.hasRevision))
    ]);
  }
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value) {
  const text = value === null || value === void 0 ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export { formatHistoryCsv, formatHistoryJson };
