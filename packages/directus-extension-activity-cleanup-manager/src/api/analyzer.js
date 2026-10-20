import { KNOWN_SYSTEM_COLLECTIONS } from "./validation.js";

// Defaults from @directus/env, used when values are read from process.env.
export const RETENTION_DEFAULTS = {
  RETENTION_ENABLED: false,
  RETENTION_SCHEDULE: "0 0 * * *",
  RETENTION_BATCH: 500,
  ACTIVITY_RETENTION: "90d",
  REVISIONS_RETENTION: "90d",
  FLOW_LOGS_RETENTION: "90d"
};

export const RETENTION_KEYS = Object.keys(RETENTION_DEFAULTS);

const DAY = 86_400_000;
const UNITS = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: DAY,
  w: 7 * DAY,
  y: 365.25 * DAY
};

const UNIT_ALIASES = [
  [/^(milliseconds?|msecs?|ms)$/, "ms"],
  [/^(seconds?|secs?|s)$/, "s"],
  [/^(minutes?|mins?|m)$/, "m"],
  [/^(hours?|hrs?|h)$/, "h"],
  [/^(days?|d)$/, "d"],
  [/^(weeks?|w)$/, "w"],
  [/^(years?|yrs?|y)$/, "y"]
];

const TARGET_RETAINED_ROWS = 1_000_000;
const LARGE_TABLE_ROWS = 100_000;
const LARGE_TABLE_BYTES = 1024 ** 3;
const DOMINANT_SHARE = 0.4;
const DOMINANT_MIN_ROWS = 10_000;

export function resolveDialect(database) {
  const raw = String(database?.client?.config?.client ?? database?.client?.dialect ?? "").toLowerCase();
  const constructorName = String(database?.client?.constructor?.name ?? "");
  if (["pg", "postgres", "postgresql"].includes(raw) || constructorName === "Client_PG") return "postgres";
  if (raw === "cockroachdb" || constructorName === "Client_CockroachDB") return "cockroachdb";
  if (raw === "redshift" || constructorName === "Client_Redshift") return "redshift";
  if (["mysql", "mysql2", "mariadb"].includes(raw) || constructorName === "Client_MySQL2") return "mysql";
  if (["sqlite3", "better-sqlite3", "sqlite"].includes(raw) || constructorName === "Client_SQLite3") return "sqlite";
  if (raw === "mssql" || constructorName === "Client_MSSQL") return "mssql";
  if (["oracledb", "oracle"].includes(raw) || constructorName.startsWith("Client_Oracle")) return "oracle";
  return raw || "unknown";
}

/** Same conversion Directus' date helpers apply before comparing against `timestamp` columns. */
export function formatTimestamp(dialect, date) {
  return dialect === "sqlite" ? String(date.getTime()) : date.toISOString();
}

/** Mirrors `getMilliseconds` from the Directus API (backed by the `ms` package). */
export function parseDuration(value) {
  if ((typeof value !== "string" && typeof value !== "number") || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = /^(-?(?:\d+)?\.?\d+) *([a-z]+)?$/i.exec(value.trim());
  if (!match || value.length > 100) return null;
  const unit = match[2] ? UNIT_ALIASES.find(([pattern]) => pattern.test(match[2].toLowerCase()))?.[1] : "ms";
  if (!unit) return null;
  return Number.parseFloat(match[1]) * UNITS[unit];
}

export function formatDuration(milliseconds) {
  if (milliseconds === null || milliseconds === undefined) return null;
  const days = milliseconds / DAY;
  if (days >= 1 && Number.isInteger(days)) return `${days}d`;
  const hours = milliseconds / UNITS.h;
  if (hours >= 1 && Number.isInteger(hours)) return `${hours}h`;
  return `${milliseconds}ms`;
}

export function toBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function looksLikeCron(value) {
  const text = String(value ?? "").trim();
  if (/^@(yearly|annually|monthly|weekly|daily|hourly)$/i.test(text)) return true;
  const parts = text.split(/\s+/);
  return (parts.length === 5 || parts.length === 6) && parts.every((part) => /^[\d*/,\-?LW#A-Za-z]+$/.test(part));
}

/**
 * Describe how the built-in retention schedule (api/dist/schedules/retention.js) will behave.
 */
export function describeRetention(env = {}, { source = "env" } = {}) {
  const values = {};
  const defaults = {};
  for (const key of RETENTION_KEYS) {
    const present = env[key] !== undefined && env[key] !== null;
    values[key] = present ? env[key] : RETENTION_DEFAULTS[key];
    defaults[key] = !present || String(values[key]) === String(RETENTION_DEFAULTS[key]);
  }

  const enabled = toBoolean(values.RETENTION_ENABLED);
  const scheduleValid = looksLikeCron(values.RETENTION_SCHEDULE);
  const batch = Number(values.RETENTION_BATCH);
  const timeframes = {
    activity: parseDuration(values.ACTIVITY_RETENTION),
    revisions: parseDuration(values.REVISIONS_RETENTION),
    flowLogs: parseDuration(values.FLOW_LOGS_RETENTION)
  };

  // Native scheduler only adds the standalone revisions task in this case.
  const revisionsTask =
    timeframes.revisions !== null &&
    (!timeframes.activity || timeframes.activity > timeframes.revisions);

  const active = enabled && scheduleValid;
  const notes = [];

  if (!enabled) notes.push("RETENTION_ENABLED is off, so nothing is deleted automatically.");
  if (enabled && !scheduleValid) notes.push("RETENTION_SCHEDULE does not look like a valid cron expression, so the native job will not be scheduled.");
  if (timeframes.activity && timeframes.revisions && timeframes.revisions > timeframes.activity) {
    notes.push(
      `REVISIONS_RETENTION (${values.REVISIONS_RETENTION}) is longer than ACTIVITY_RETENTION (${values.ACTIVITY_RETENTION}). ` +
        "Revisions are removed with their activity row (ON DELETE CASCADE), so they effectively live as long as the activity."
    );
  }
  if (active && timeframes.activity) {
    notes.push("Native retention also removes content-version revisions (directus_revisions.version) when their activity row expires.");
  }
  if (!Number.isFinite(batch) || batch < 1) notes.push("RETENTION_BATCH is not a positive number.");

  return {
    source,
    values,
    defaults,
    enabled,
    scheduleValid,
    active,
    batch: Number.isFinite(batch) && batch > 0 ? batch : null,
    timeframes,
    tasks: {
      activity: timeframes.activity !== null,
      flowLogs: timeframes.flowLogs !== null,
      revisions: revisionsTask
    },
    effective: {
      activity: formatDuration(timeframes.activity),
      flowLogs: formatDuration(timeframes.flowLogs),
      revisions: formatDuration(effectiveRevisions(timeframes, revisionsTask))
    },
    notes
  };
}

function effectiveRevisions(timeframes, revisionsTask) {
  const candidates = [timeframes.activity, revisionsTask ? timeframes.revisions : null].filter((value) => value !== null);
  return candidates.length ? Math.min(...candidates) : null;
}

export function toIso(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const numeric = typeof value === "number" ? value : /^\d+$/.test(String(value)) ? Number(value) : null;
  const date = numeric !== null ? new Date(numeric) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Twelve calendar months (UTC), oldest first, ending with the current month. */
export function buildMonthRanges(now = new Date(), count = 12) {
  const ranges = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    ranges.push({ month: start.toISOString().slice(0, 7), start, end });
  }
  return ranges;
}

export function buildInsights({
  activityGroups = [],
  revisionGroups = [],
  monthly = [],
  beforeWindow = { activity: 0, revisions: 0 },
  tableSizes = null,
  schemaCollections = {},
  dialect = "unknown"
}) {
  const collections = new Map();
  const byAction = new Map();
  const entry = (name) => {
    const key = name ?? "(none)";
    if (!collections.has(key)) {
      collections.set(key, { collection: key, activity: 0, revisions: 0, versionedRevisions: 0, actions: {}, oldest: null, newest: null });
    }
    return collections.get(key);
  };

  for (const row of activityGroups) {
    const count = Number(row.count) || 0;
    const target = entry(row.collection);
    target.activity += count;
    target.actions[row.action] = (target.actions[row.action] ?? 0) + count;
    target.oldest = minIso(target.oldest, toIso(row.oldest));
    target.newest = maxIso(target.newest, toIso(row.newest));
    byAction.set(row.action, (byAction.get(row.action) ?? 0) + count);
  }

  for (const row of revisionGroups) {
    const target = entry(row.collection);
    target.revisions += Number(row.count) || 0;
    target.versionedRevisions += Number(row.versioned) || 0;
  }

  const byCollection = [...collections.values()]
    .map((item) => {
      const meta = schemaCollections[item.collection];
      const system = item.collection.startsWith("directus_");
      return {
        ...item,
        system,
        exists: Boolean(meta) || KNOWN_SYSTEM_COLLECTIONS.has(item.collection),
        accountability: meta ? meta.accountability ?? null : undefined
      };
    })
    .sort((a, b) => b.activity + b.revisions - (a.activity + a.revisions) || a.collection.localeCompare(b.collection));

  const totals = byCollection.reduce(
    (sum, item) => ({
      activity: sum.activity + item.activity,
      revisions: sum.revisions + item.revisions,
      versionedRevisions: sum.versionedRevisions + item.versionedRevisions,
      oldest: minIso(sum.oldest, item.oldest),
      newest: maxIso(sum.newest, item.newest)
    }),
    { activity: 0, revisions: 0, versionedRevisions: 0, oldest: null, newest: null }
  );

  return {
    dialect,
    totals: { ...totals, flowRunLogs: byAction.get("run") ?? 0, collections: byCollection.length },
    byCollection,
    byAction: [...byAction.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
    monthly: monthly.map((row) => ({ month: row.month, activity: Number(row.activity) || 0, revisions: Number(row.revisions) || 0 })),
    beforeWindow: { activity: Number(beforeWindow.activity) || 0, revisions: Number(beforeWindow.revisions) || 0 },
    tableSizes
  };
}

function minIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function maxIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function averageMonthly(monthly, field = "activity") {
  // Ignore the current (partial) month and leading months without any data.
  const complete = monthly.slice(0, -1);
  const firstWithData = complete.findIndex((row) => row[field] > 0);
  if (firstWithData === -1) return monthly.at(-1)?.[field] ?? 0;
  const window = complete.slice(firstWithData);
  return Math.round(window.reduce((sum, row) => sum + row[field], 0) / window.length);
}

export function suggestRetentionDays(averagePerMonth, targetRows = TARGET_RETAINED_ROWS) {
  if (!averagePerMonth) return 90;
  const perDay = averagePerMonth / 30;
  return [365, 180, 90, 60, 30].find((days) => perDay * days <= targetRows) ?? 30;
}

export function recommend({ insights, retention, now = new Date() }) {
  const items = [];
  const add = (level, title, detail, env) => items.push({ id: `${level}:${items.length}`, level, title, detail, env: env ?? null });
  const { totals } = insights;
  const avgActivity = averageMonthly(insights.monthly, "activity");
  const days = suggestRetentionDays(avgActivity);

  if (!retention.active && totals.activity >= LARGE_TABLE_ROWS) {
    add(
      "warning",
      "Enable native retention",
      `directus_activity holds ${totals.activity.toLocaleString("en-US")} rows (~${avgActivity.toLocaleString("en-US")} new per month) and nothing expires them.`,
      { RETENTION_ENABLED: "true", ACTIVITY_RETENTION: `${days}d`, REVISIONS_RETENTION: `${days}d` }
    );
  } else if (!retention.active && avgActivity > 0) {
    add("info", "Native retention is off", `Activity grows by ~${avgActivity.toLocaleString("en-US")} rows per month. Consider enabling RETENTION_ENABLED before the tables get large.`);
  }

  if (retention.active && retention.timeframes.activity && avgActivity > 0) {
    const retained = Math.round((avgActivity / 30) * (retention.timeframes.activity / DAY));
    if (retained > TARGET_RETAINED_ROWS * 2) {
      add(
        "suggestion",
        "Shorten ACTIVITY_RETENTION",
        `With ${retention.effective.activity} retention about ${retained.toLocaleString("en-US")} activity rows stay in the table.`,
        { ACTIVITY_RETENTION: `${days}d` }
      );
    }
  }

  if (retention.active && retention.timeframes.activity && totals.oldest) {
    const cutoff = now.getTime() - retention.timeframes.activity - 2 * DAY;
    if (new Date(totals.oldest).getTime() < cutoff) {
      add("info", "Rows older than ACTIVITY_RETENTION remain", "The native job may not have run yet, may still be catching up in batches, or flow logs are kept longer via FLOW_LOGS_RETENTION.");
    }
  }

  const runShare = totals.activity ? totals.flowRunLogs / totals.activity : 0;
  if (totals.flowRunLogs >= DOMINANT_MIN_ROWS && runShare >= 0.3) {
    const current = retention.timeframes.flowLogs;
    if (current === null || current > 14 * DAY) {
      add(
        "suggestion",
        "Expire flow run logs sooner",
        `${Math.round(runShare * 100)}% of activity rows are flow run logs. Flow logs can be kept for a shorter time than other activity.`,
        { FLOW_LOGS_RETENTION: "14d" }
      );
    }
  }

  if (retention.timeframes.activity && retention.timeframes.revisions && retention.timeframes.revisions > retention.timeframes.activity) {
    add(
      "warning",
      "REVISIONS_RETENTION has no effect",
      "Revisions are deleted together with their activity row, so a longer REVISIONS_RETENTION than ACTIVITY_RETENTION is ignored in practice.",
      { REVISIONS_RETENTION: retention.values.ACTIVITY_RETENTION }
    );
  }

  const grandTotal = totals.activity + totals.revisions;
  for (const item of insights.byCollection) {
    const rows = item.activity + item.revisions;
    if (!item.exists && rows > 0) {
      add("suggestion", `Purge orphaned history of "${item.collection}"`, `${rows.toLocaleString("en-US")} rows belong to a collection that no longer exists in the schema.`);
      continue;
    }
    if (rows >= DOMINANT_MIN_ROWS && grandTotal && rows / grandTotal >= DOMINANT_SHARE && item.collection !== "directus_flows") {
      const tip = item.accountability === "all"
        ? ' Setting the collection\'s Activity Tracking to "activity" stops it storing revisions; "none" stops tracking completely.'
        : "";
      add("suggestion", `"${item.collection}" dominates the history`, `It accounts for ${Math.round((rows / grandTotal) * 100)}% of activity and revision rows. Use a targeted purge to trim it.${tip}`);
    }
  }

  const loginRows = insights.byAction.find((row) => row.action === "login")?.count ?? 0;
  if (loginRows >= DOMINANT_MIN_ROWS && totals.activity && loginRows / totals.activity >= DOMINANT_SHARE) {
    add("suggestion", "Login events dominate activity", "Run a targeted purge on directus_users with action \"login\" and an older-than date.");
  }

  const sizes = insights.tableSizes;
  const bytes = sizes ? (sizes.activity ?? 0) + (sizes.revisions ?? 0) : 0;
  if (bytes >= LARGE_TABLE_BYTES) {
    add("warning", "History tables are large", `directus_activity and directus_revisions use about ${(bytes / 1024 ** 3).toFixed(1)} GB. Deleting rows frees space for reuse; run VACUUM (FULL) during maintenance to return it to the OS.`);
  }

  if (retention.active && totals.activity > 5_000_000 && retention.batch !== null && retention.batch <= 500) {
    add("info", "Larger retention batches", "With millions of rows a bigger batch lets the nightly job catch up faster.", { RETENTION_BATCH: "2000" });
  }

  if (totals.versionedRevisions > 0 && retention.active) {
    add("info", "Content-version revisions", `${totals.versionedRevisions.toLocaleString("en-US")} revisions belong to content versions. Native retention deletes them when their activity expires; targeted purges here keep them.`);
  }

  if (!items.length) add("success", "Nothing to change", "History size and retention settings look reasonable.");
  return items;
}
