import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunk, createStore, getRetention, getTableSizes, purge, runPurge } from "./cleanup-engine.js";

/** In-memory store with the same contract as createStore(), enforcing the revisions.parent foreign key. */
function memoryStore({ activity, revisions }) {
  const log = [];
  const matches = (row, filters) =>
    row.collection === filters.collection &&
    (!filters.action || row.action === filters.action) &&
    (!filters.olderThan || row.timestamp < filters.olderThan.getTime());
  const isProtected = (activityId) => revisions.some((revision) => revision.activity === activityId && revision.version);

  const store = {
    log,
    activity,
    revisions,
    async nextActivityBatch(filters, size) {
      return activity.filter((row) => matches(row, filters) && !isProtected(row.id)).slice(0, size).map((row) => row.id);
    },
    async revisionIdsForActivity(ids) {
      return revisions.filter((row) => ids.includes(row.activity) && !row.version).map((row) => row.id);
    },
    async childRevisionIds(ids) {
      return revisions.filter((row) => ids.includes(row.parent)).map((row) => row.id);
    },
    async detachRevisions(ids) {
      log.push(["detach", ids]);
      for (const row of revisions) if (ids.includes(row.id)) row.parent = null;
      return ids.length;
    },
    async deleteRevisions(ids) {
      log.push(["revisions", ids]);
      const remaining = revisions.filter((row) => !ids.includes(row.id));
      if (remaining.some((row) => ids.includes(row.parent))) throw new Error("FK violation on directus_revisions.parent");
      const deleted = revisions.length - remaining.length;
      revisions.splice(0, revisions.length, ...remaining);
      return deleted;
    },
    async deleteActivity(ids) {
      log.push(["activity", ids]);
      const before = activity.length;
      const remaining = activity.filter((row) => !ids.includes(row.id) || isProtected(row.id));
      activity.splice(0, activity.length, ...remaining);
      return before - remaining.length;
    },
    transaction: (callback) => callback(store)
  };
  return store;
}

describe("runPurge", () => {
  it("deletes revisions before activity in batches and keeps versioned rows", async () => {
    const store = memoryStore({
      activity: [
        { id: 1, collection: "articles", action: "update", timestamp: 1 },
        { id: 2, collection: "articles", action: "update", timestamp: 2 },
        { id: 3, collection: "articles", action: "version_save", timestamp: 3 },
        { id: 4, collection: "articles", action: "create", timestamp: 4 },
        { id: 5, collection: "authors", action: "update", timestamp: 5 }
      ],
      revisions: [
        { id: 10, activity: 1, parent: null, version: null },
        { id: 11, activity: 2, parent: null, version: null },
        { id: 12, activity: 3, parent: null, version: "v1" },
        { id: 13, activity: 4, parent: null, version: null },
        { id: 14, activity: 5, parent: 10, version: null }
      ]
    });

    const totals = await runPurge(store, { collection: "articles" }, 2);

    assert.deepEqual(totals, { activity: 3, revisions: 3, detachedChildren: 1, batches: 2 });
    assert.deepEqual(store.activity.map((row) => row.id), [3, 5]);
    assert.deepEqual(store.revisions.map((row) => row.id), [12, 14]);
    assert.equal(store.revisions.find((row) => row.id === 14).parent, null);
    assert.deepEqual(store.log.slice(0, 3).map(([step]) => step), ["detach", "revisions", "activity"]);
  });

  it("respects action and older-than filters", async () => {
    const store = memoryStore({
      activity: [
        { id: 1, collection: "directus_users", action: "login", timestamp: 100 },
        { id: 2, collection: "directus_users", action: "login", timestamp: 300 },
        { id: 3, collection: "directus_users", action: "update", timestamp: 100 }
      ],
      revisions: [{ id: 30, activity: 3, parent: null, version: null }]
    });

    const totals = await runPurge(store, { collection: "directus_users", action: "login", olderThan: new Date(200) }, 500);
    assert.equal(totals.activity, 1);
    assert.deepEqual(store.activity.map((row) => row.id), [2, 3]);
  });

  it("stops when a batch deletes nothing", async () => {
    let calls = 0;
    const store = {
      nextActivityBatch: async () => (++calls > 5 ? [] : [1, 2]),
      revisionIdsForActivity: async () => [],
      childRevisionIds: async () => [],
      detachRevisions: async () => 0,
      deleteRevisions: async () => 0,
      deleteActivity: async () => 0,
      transaction: (callback) => callback(store)
    };
    const totals = await runPurge(store, { collection: "a" }, 2);
    assert.equal(totals.batches, 1);
    assert.equal(calls, 1);
  });
});

/** Chainable knex stand-in that records every builder call and resolves via `resolve(table, calls)`. */
function fakeKnex({ client = "pg", resolve = () => [], hasVersion = true } = {}) {
  const queries = [];
  const make = (table) => {
    const calls = [];
    const builder = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") {
            return (ok, fail) => Promise.resolve().then(() => resolve(table, calls)).then(ok, fail);
          }
          if (prop === "calls") return calls;
          if (prop === "table") return table;
          return (...args) => {
            calls.push([prop, args]);
            return builder;
          };
        }
      }
    );
    queries.push(builder);
    return builder;
  };
  const db = (table) => make(table);
  db.client = { config: { client } };
  db.schema = { hasColumn: async () => hasVersion };
  db.raw = async (sql, bindings) => {
    queries.push({ table: "raw", calls: [["raw", [sql, bindings]]] });
    return { rows: [{ bytes: "2048" }] };
  };
  db.transaction = async (callback) => callback(db);
  db.queries = queries;
  return db;
}

const methods = (builder) => builder.calls.map(([name]) => name);

describe("createStore", () => {
  it("excludes activity owning version revisions and formats dates", async () => {
    const db = fakeKnex({ client: "sqlite3", resolve: () => [{ id: 7 }] });
    const store = createStore(db, { dialect: "sqlite", versioned: true });
    const ids = await store.nextActivityBatch({ collection: "a", action: "update", olderThan: new Date(1000) }, 50);

    assert.deepEqual(ids, [7]);
    const main = db.queries.find((query) => query.table === "directus_activity");
    assert.ok(methods(main).includes("whereNotExists"));
    assert.deepEqual(main.calls.find(([name, args]) => name === "where" && args[1] === "<")[1], ["directus_activity.timestamp", "<", "1000"]);
    assert.deepEqual(main.calls.find(([name]) => name === "limit")[1], [50]);
  });

  it("guards deletes against versioned revisions and chunks large id lists", async () => {
    const db = fakeKnex({ resolve: () => 1 });
    const store = createStore(db, { dialect: "postgres", versioned: true });
    const ids = Array.from({ length: 2500 }, (_, index) => index);

    assert.equal(await store.deleteRevisions(ids), 3);
    const deletes = db.queries.filter((query) => methods(query).includes("delete"));
    assert.equal(deletes.length, 3);
    assert.ok(deletes.every((query) => methods(query).includes("whereNull")));

    await store.deleteActivity([1]);
    assert.ok(methods(db.queries.at(-2)).includes("whereNotExists"));
  });

  it("detaches children with a parent = null update", async () => {
    const db = fakeKnex({ resolve: () => 2 });
    const store = createStore(db, { dialect: "postgres", versioned: false });
    await store.detachRevisions([4, 5]);
    assert.deepEqual(db.queries[0].calls.find(([name]) => name === "update")[1], [{ parent: null }]);
  });

  it("splits arrays into chunks", () => {
    assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
    assert.deepEqual(chunk([]), []);
  });
});

describe("getTableSizes", () => {
  it("only queries Postgres", async () => {
    assert.equal(await getTableSizes(fakeKnex({ client: "mysql2" }), "mysql"), null);
    assert.deepEqual(await getTableSizes(fakeKnex(), "postgres"), { activity: 2048, revisions: 2048 });
  });

  it("returns null when the size query fails", async () => {
    const db = fakeKnex();
    db.raw = async () => {
      throw new Error("permission denied");
    };
    assert.equal(await getTableSizes(db, "postgres"), null);
  });
});

describe("purge", () => {
  const schema = { collections: { articles: { accountability: "all" } } };

  it("returns counts only for a dry run and never deletes", async () => {
    const db = fakeKnex({
      resolve: (table, calls) => {
        if (calls.some(([name]) => name === "groupBy")) return [{ action: "update", count: "4" }];
        if (calls.some(([name]) => name === "first")) return { count: "4", oldest: "2025-01-01T00:00:00Z", newest: null };
        return [];
      }
    });
    const result = await purge(
      { database: db, getSchema: async () => schema },
      { collection: "articles", action: null, olderThan: null, dryRun: true, batchSize: 100 }
    );

    assert.equal(result.dryRun, true);
    assert.equal(result.deleted, null);
    assert.equal(result.preview.activity, 4);
    assert.equal(result.preview.oldest, "2025-01-01T00:00:00.000Z");
    assert.ok(db.queries.every((query) => !methods(query).some((name) => name === "delete" || name === "update")));
  });

  it("rejects unknown collections with 400", async () => {
    const db = fakeKnex({ resolve: () => undefined });
    await assert.rejects(
      purge({ database: db, getSchema: async () => schema }, { collection: "nope", dryRun: true, batchSize: 10 }),
      (error) => error.status === 400
    );
  });

  it("accepts orphaned collections that still have activity", async () => {
    const db = fakeKnex({
      resolve: (table, calls) => (calls.some(([name]) => name === "first") ? { id: 1, count: 0 } : [])
    });
    const result = await purge({ database: db, getSchema: async () => schema }, { collection: "deleted_one", dryRun: true, batchSize: 10 });
    assert.equal(result.collection, "deleted_one");
  });
});

describe("getRetention", () => {
  it("prefers the endpoint context env over process.env", () => {
    assert.equal(getRetention({ env: { RETENTION_ENABLED: true } }).source, "useEnv");
    assert.equal(getRetention({ env: { RETENTION_ENABLED: true } }).enabled, true);
    assert.equal(getRetention({}).source, "process.env");
  });
});
