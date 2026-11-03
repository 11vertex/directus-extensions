import { buildInsights, buildMonthRanges, describeRetention, formatTimestamp, recommend, resolveDialect, toIso } from "./analyzer.js";
import { KNOWN_SYSTEM_COLLECTIONS, httpError } from "./validation.js";

const ACTIVITY = "directus_activity";
const REVISIONS = "directus_revisions";
const CHUNK = 1000;

let purgeRunning = false;

export function getRetention(context) {
  const fromContext = context.env && typeof context.env === "object";
  return describeRetention(fromContext ? context.env : process.env, { source: fromContext ? "useEnv" : "process.env" });
}

export async function getOverview(context, { now = new Date() } = {}) {
  const insights = await getInsights(context, { now });
  const retention = getRetention(context);
  return { generatedAt: now.toISOString(), insights, retention, recommendations: recommend({ insights, retention, now }) };
}

export async function getInsights(context, { now = new Date() } = {}) {
  const db = context.database;
  const dialect = resolveDialect(db);
  const [schema, versioned] = await Promise.all([context.getSchema(), hasVersionColumn(db)]);

  const activityGroups = await db(ACTIVITY)
    .select("collection", "action")
    .count({ count: "*" })
    .min({ oldest: "timestamp" })
    .max({ newest: "timestamp" })
    .groupBy("collection", "action");

  const revisionQuery = db(REVISIONS).select("collection").count({ count: "*" }).groupBy("collection");
  if (versioned) revisionQuery.count({ versioned: "version" });
  const revisionGroups = await revisionQuery;

  const ranges = buildMonthRanges(now, 12);
  const monthly = [];
  for (const range of ranges) {
    const [activity, revisions] = await Promise.all([
      countActivityBetween(db, dialect, range.start, range.end),
      countRevisionsBetween(db, dialect, range.start, range.end)
    ]);
    monthly.push({ month: range.month, activity, revisions });
  }
  const [beforeActivity, beforeRevisions] = await Promise.all([
    countActivityBetween(db, dialect, null, ranges[0].start),
    countRevisionsBetween(db, dialect, null, ranges[0].start)
  ]);

  const schemaCollections = Object.fromEntries(
    Object.entries(schema?.collections ?? {}).map(([name, meta]) => [name, { accountability: meta?.accountability ?? null }])
  );

  return buildInsights({
    activityGroups,
    revisionGroups,
    monthly,
    beforeWindow: { activity: beforeActivity, revisions: beforeRevisions },
    tableSizes: await getTableSizes(db, dialect),
    schemaCollections,
    dialect
  });
}

async function countActivityBetween(db, dialect, start, end) {
  const query = db(ACTIVITY);
  if (start) query.where("timestamp", ">=", formatTimestamp(dialect, start));
  if (end) query.where("timestamp", "<", formatTimestamp(dialect, end));
  return count(query);
}

async function countRevisionsBetween(db, dialect, start, end) {
  const query = db(REVISIONS).join(ACTIVITY, `${REVISIONS}.activity`, `${ACTIVITY}.id`);
  if (start) query.where(`${ACTIVITY}.timestamp`, ">=", formatTimestamp(dialect, start));
  if (end) query.where(`${ACTIVITY}.timestamp`, "<", formatTimestamp(dialect, end));
  return count(query, `${REVISIONS}.id`);
}

export async function getTableSizes(db, dialect) {
  if (dialect !== "postgres") return null;
  try {
    const size = async (table) => {
      const result = await db.raw("select pg_total_relation_size(?::regclass) as bytes", [table]);
      const bytes = result?.rows?.[0]?.bytes;
      return bytes === undefined || bytes === null ? null : Number(bytes);
    };
    return { activity: await size(ACTIVITY), revisions: await size(REVISIONS) };
  } catch {
    return null;
  }
}

async function hasVersionColumn(db) {
  try {
    return await db.schema.hasColumn(REVISIONS, "version");
  } catch {
    return false;
  }
}

async function count(query, column = "*") {
  const row = await query.count({ count: column }).first();
  return Number(row?.count ?? 0);
}

export async function purge(context, request) {
  const db = context.database;
  const dialect = resolveDialect(db);
  const versioned = await hasVersionColumn(db);
  await assertKnownCollection(context, db, request.collection);

  const filters = { collection: request.collection, action: request.action, olderThan: request.olderThan };
  const store = createStore(db, { dialect, versioned });
  const echo = {
    collection: request.collection,
    action: request.action,
    olderThan: request.olderThan ? request.olderThan.toISOString() : null,
    batchSize: request.batchSize
  };

  if (request.dryRun) return { dryRun: true, ...echo, preview: await store.preview(filters), deleted: null };

  if (purgeRunning) throw httpError(409, "Another purge is already running. Wait for it to finish.");
  purgeRunning = true;
  const startedAt = Date.now();

  try {
    const preview = await store.preview(filters);
    const deleted = await runPurge(store, filters, request.batchSize);
    context.logger?.info(
      `[activity-cleanup-manager] Purged ${deleted.activity} activity and ${deleted.revisions} revision rows for "${request.collection}"` +
        (request.action ? ` (action ${request.action})` : "") +
        (request.olderThan ? ` older than ${echo.olderThan}` : "")
    );
    return { dryRun: false, ...echo, preview, deleted, durationMs: Date.now() - startedAt };
  } finally {
    purgeRunning = false;
  }
}

async function assertKnownCollection(context, db, collection) {
  const schema = await context.getSchema();
  if (schema?.collections?.[collection] || KNOWN_SYSTEM_COLLECTIONS.has(collection)) return;

  // Allow history of collections that were deleted from the schema (orphaned rows).
  const orphan = await db(ACTIVITY).select("id").where("collection", collection).first();
  if (!orphan) throw httpError(400, `Unknown collection "${collection}".`);
}

/**
 * Batch loop. Each batch runs in its own transaction: detach child revisions, delete revisions, then activity.
 * Activity rows that own content-version revisions are never selected, so those revisions survive.
 */
export async function runPurge(store, filters, batchSize) {
  const totals = { activity: 0, revisions: 0, detachedChildren: 0, batches: 0 };

  for (;;) {
    const activityIds = await store.nextActivityBatch(filters, batchSize);
    if (!activityIds.length) break;

    const result = await store.transaction(async (trx) => {
      const revisionIds = await trx.revisionIdsForActivity(activityIds);
      const own = new Set(revisionIds.map(String));
      const children = (await trx.childRevisionIds(revisionIds)).filter((id) => !own.has(String(id)));
      await trx.detachRevisions(children);
      const revisions = await trx.deleteRevisions(revisionIds);
      const activity = await trx.deleteActivity(activityIds);
      return { activity, revisions, detachedChildren: children.length };
    });

    totals.activity += result.activity;
    totals.revisions += result.revisions;
    totals.detachedChildren += result.detachedChildren;
    totals.batches += 1;

    if (result.activity === 0 || activityIds.length < batchSize) break;
  }

  return totals;
}

export function chunk(values, size = CHUNK) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

export function createStore(db, { dialect, versioned }) {
  const matching = (filters) => {
    const query = db(ACTIVITY).where(`${ACTIVITY}.collection`, filters.collection);
    if (filters.action) query.where(`${ACTIVITY}.action`, filters.action);
    if (filters.olderThan) query.where(`${ACTIVITY}.timestamp`, "<", formatTimestamp(dialect, filters.olderThan));
    return query;
  };

  const protectedRevisions = () =>
    db(REVISIONS).select(`${REVISIONS}.id`).whereColumn(`${REVISIONS}.activity`, `${ACTIVITY}.id`).whereNotNull(`${REVISIONS}.version`);

  const deletable = (filters) => {
    const query = matching(filters);
    if (versioned) query.whereNotExists(protectedRevisions());
    return query;
  };

  const deletableIds = (filters) => deletable(filters).select(`${ACTIVITY}.id`);

  const sumChunks = async (values, run) => {
    let total = 0;
    for (const part of chunk(values)) total += Number(await run(part)) || 0;
    return total;
  };

  return {
    async preview(filters) {
      const [matched, deletableActivity, revisions, protectedRevisionCount, childrenToDetach, range, actions] = await Promise.all([
        count(matching(filters)),
        count(deletable(filters)),
        count(db(REVISIONS).whereIn("activity", deletableIds(filters))),
        versioned ? count(db(REVISIONS).whereNotNull("version").whereIn("activity", matching(filters).select(`${ACTIVITY}.id`))) : 0,
        count(
          db(REVISIONS)
            .whereIn("parent", db(REVISIONS).select("id").whereIn("activity", deletableIds(filters)))
            .where((query) => query.whereNull("activity").orWhereNotIn("activity", deletableIds(filters)))
        ),
        matching(filters).min({ oldest: "timestamp" }).max({ newest: "timestamp" }).first(),
        matching(filters).select("action").count({ count: "*" }).groupBy("action")
      ]);

      return {
        activity: deletableActivity,
        revisions,
        matchedActivity: matched,
        protectedActivity: matched - deletableActivity,
        protectedRevisions: protectedRevisionCount,
        childrenToDetach,
        oldest: toIso(range?.oldest),
        newest: toIso(range?.newest),
        byAction: actions.map((row) => ({ action: row.action, count: Number(row.count) || 0 }))
      };
    },

    async nextActivityBatch(filters, size) {
      const rows = await deletableIds(filters).orderBy(`${ACTIVITY}.id`).limit(size);
      return rows.map((row) => row.id);
    },

    async revisionIdsForActivity(activityIds) {
      const ids = [];
      for (const part of chunk(activityIds)) {
        const query = db(REVISIONS).select("id").whereIn("activity", part);
        if (versioned) query.whereNull("version");
        ids.push(...(await query).map((row) => row.id));
      }
      return ids;
    },

    async childRevisionIds(revisionIds) {
      const ids = [];
      for (const part of chunk(revisionIds)) ids.push(...(await db(REVISIONS).select("id").whereIn("parent", part)).map((row) => row.id));
      return ids;
    },

    detachRevisions: (ids) => sumChunks(ids, (part) => db(REVISIONS).whereIn("id", part).update({ parent: null })),

    deleteRevisions: (ids) =>
      sumChunks(ids, (part) => {
        const query = db(REVISIONS).whereIn("id", part);
        if (versioned) query.whereNull("version");
        return query.delete();
      }),

    deleteActivity: (ids) =>
      sumChunks(ids, (part) => {
        const query = db(ACTIVITY).whereIn("id", part);
        if (versioned) query.whereNotExists(protectedRevisions());
        return query.delete();
      }),

    transaction: (callback) => db.transaction((trx) => callback(createStore(trx, { dialect, versioned })))
  };
}
