import { formatBytes, formatCount } from "./reports.js";

const DAY = 86_400_000;

export const AGE_OPTIONS = [
  { text: "Older than 30 days", value: "30d" },
  { text: "Older than 90 days", value: "90d" },
  { text: "Older than 1 year", value: "1y" },
  { text: "Everything", value: "all" }
];

const AGE_DAYS = { "30d": 30, "90d": 90, "1y": 365 };

/** ISO cut-off date for an age option, or null for "Everything". */
export function cutoffFor(age, now = new Date()) {
  const days = AGE_DAYS[age];
  return days ? new Date(now.getTime() - days * DAY).toISOString() : null;
}

export function historyRecords(item) {
  return (Number(item?.activity) || 0) + (Number(item?.revisions) || 0);
}

/** "90d" → "90 days", "12h" → "12 hours", "1d" → "1 day". */
export function humanDuration(value) {
  const match = /^(\d+)(d|h)$/.exec(String(value ?? ""));
  if (!match) return value ? String(value) : null;
  const count = Number(match[1]);
  const unit = match[2] === "d" ? "day" : "hour";
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** The status sentence at the top: how big history is and whether automatic cleanup runs. */
export function statusLine({ insights, retention }) {
  const records = formatCount(historyRecords(insights.totals));
  const sizes = insights.tableSizes;
  const bytes = sizes ? (sizes.activity ?? 0) + (sizes.revisions ?? 0) : null;
  const usage = bytes ? `History uses ${formatBytes(bytes)} (${records} records).` : `History has ${records} records.`;

  if (retention.active) {
    const kept = humanDuration(retention.effective.activity);
    return { usage, on: true, cleanup: kept ? `On — keeps ${kept}` : "On" };
  }
  const reason = retention.enabled && !retention.scheduleValid ? " (the schedule setting is invalid)" : "";
  return { usage, on: false, cleanup: `Off${reason}` };
}

/** Environment variables that turn the built-in cleanup on, sized by the server's suggestion when it has one. */
export function enableEnv({ retention, recommendations = [] }) {
  const suggested = recommendations.find((item) => item.env?.RETENTION_ENABLED)?.env;
  const env = suggested ?? { RETENTION_ENABLED: "true", ACTIVITY_RETENTION: "90d", REVISIONS_RETENTION: "90d" };
  return retention.scheduleValid ? env : { ...env, RETENTION_SCHEDULE: "0 0 * * *" };
}

/** At most one plain-language tip: deleted-collection history first, then a collection that dominates. */
export function topTip(insights, nameOf = (collection) => collection) {
  const total = historyRecords(insights.totals);
  const orphans = insights.byCollection.filter((item) => !item.exists && item.activity > 0);
  if (orphans.length) {
    const rows = orphans.reduce((sum, item) => sum + historyRecords(item), 0);
    return `${formatCount(rows)} records belong to deleted collections. You can clean them up below.`;
  }

  const top = insights.byCollection.find((item) => item.collection !== "directus_flows" && item.activity > 0);
  const rows = historyRecords(top);
  if (top && total && rows >= 10_000 && rows / total >= 0.4) {
    return `${nameOf(top.collection)} makes up ${Math.round((rows / total) * 100)}% of all history. Cleaning it up frees the most space.`;
  }
  return null;
}

const TIME_STEPS = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60]
];

/** "5 minutes ago", "last month"… or "—" for empty/invalid values. */
export function timeAgo(value, now = Date.now()) {
  if (!value) return "—";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "—";
  const seconds = Math.round((now - time) / 1000);
  if (Math.abs(seconds) < 60) return "just now";
  const [unit, size] = TIME_STEPS.find(([, step]) => Math.abs(seconds) >= step);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-Math.round(seconds / size), unit);
}
