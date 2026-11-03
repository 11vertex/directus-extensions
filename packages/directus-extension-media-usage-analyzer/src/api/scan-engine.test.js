import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deleteUnusedFiles, runScan } from "./scan-engine.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const field = (type, extra = {}) => ({ type, special: [], alias: false, ...extra });

const schema = {
  collections: {
    directus_files: { primary: "id", fields: { id: field("uuid"), filename_download: field("string"), type: field("string"), filesize: field("bigInteger"), width: field("integer"), height: field("integer"), folder: field("uuid") } },
    directus_folders: { primary: "id", fields: { id: field("uuid"), name: field("string") } },
    directus_users: { primary: "id", fields: { id: field("uuid"), avatar: field("uuid") } },
    articles: { primary: "id", fields: { id: field("integer"), cover: field("uuid"), body: field("text") } }
  },
  relations: [
    { collection: "directus_users", field: "avatar", related_collection: "directus_files", meta: null },
    { collection: "articles", field: "cover", related_collection: "directus_files", meta: null }
  ]
};

function matches(row, filter) {
  if (!filter) return true;
  if (filter._and) return filter._and.every((part) => matches(row, part));
  if (filter._or) return filter._or.some((part) => matches(row, part));
  return Object.entries(filter).every(([key, condition]) => {
    const value = row[key];
    const [[operator, expected]] = Object.entries(condition);
    if (operator === "_nnull") return value !== null && value !== undefined;
    if (operator === "_eq") return value === expected;
    if (operator === "_in") return expected.includes(value);
    if (operator === "_contains") return typeof value === "string" && value.includes(expected);
    if (operator === "_icontains") return typeof value === "string" && value.toLowerCase().includes(expected.toLowerCase());
    throw new Error(`unsupported ${operator}`);
  });
}

function createContext(data, { groupFails = false } = {}) {
  const queries = [];
  const deleted = [];

  class ItemsService {
    constructor(collection, options) {
      this.collection = collection;
      this.options = options;
    }
    async readByQuery(query) {
      queries.push({ collection: this.collection, query });
      if (query.group && groupFails) throw new Error("group unsupported");
      const rows = (data[this.collection] ?? []).filter((row) => matches(row, query.filter));
      let result = rows;
      if (query.group) {
        const counts = new Map();
        for (const row of rows) counts.set(row[query.group[0]], (counts.get(row[query.group[0]]) ?? 0) + 1);
        result = [...counts].map(([key, count]) => ({ [query.group[0]]: key, count: String(count) }));
      }
      const start = ((query.page ?? 1) - 1) * query.limit;
      return result.slice(start, start + query.limit);
    }
  }

  class FilesService extends ItemsService {
    constructor(options) {
      super("directus_files", options);
    }
    async deleteMany(keys) {
      deleted.push({ keys, accountability: this.options.accountability });
      data.directus_files = data.directus_files.filter((row) => !keys.includes(row.id));
      return keys;
    }
  }

  class FoldersService extends ItemsService {
    constructor(options) {
      super("directus_folders", options);
    }
  }

  return {
    queries,
    deleted,
    context: { services: { ItemsService, FilesService, FoldersService }, database: {}, getSchema: async () => schema }
  };
}

function seed() {
  return {
    directus_files: Array.from({ length: 1203 }, (_, n) => ({ id: id(n + 1), filename_download: `f${n}.jpg`, type: "image/jpeg", filesize: 100, width: 10, height: 10, folder: null })),
    directus_users: [{ id: "u1", avatar: id(1) }, { id: "u2", avatar: null }],
    articles: [
      { id: 1, cover: id(2), body: `<img src="/assets/${id(3)}">` },
      { id: 2, cover: id(2), body: `<img src="/assets/${id(5000)}">` },
      { id: 3, cover: id(9999), body: "plain" }
    ]
  };
}

describe("runScan", () => {
  it("reads files in pages and counts relational references", async () => {
    const { context, queries } = createContext(seed());
    const report = await runScan(context, { content: false });
    assert.equal(report.summary.files, 1203);
    assert.equal(queries.filter((entry) => entry.collection === "directus_files").length, 3);
    assert.ok(queries.every((entry) => entry.query.limit === 500));
    assert.equal(report.summary.usedFiles, 2);
    assert.equal(report.summary.brokenReferences, 1);
    assert.equal(report.usage.find((entry) => entry.source === "articles.cover").references, 3);
    assert.equal(report.summary.contentScanned, false);
  });

  it("optionally scans content for /assets links", async () => {
    const { context } = createContext(seed());
    const report = await runScan(context, { content: true });
    assert.equal(report.summary.usedFiles, 3);
    assert.equal(report.broken.find((entry) => entry.fileId === id(5000)).kind, "content");
  });

  it("falls back to paging when grouping fails", async () => {
    const { context } = createContext(seed(), { groupFails: true });
    const report = await runScan(context, { content: false });
    assert.equal(report.usage.find((entry) => entry.source === "articles.cover").references, 3);
    assert.deepEqual(report.warnings, []);
  });
});

describe("deleteUnusedFiles", () => {
  it("re-verifies references (including content) before deleting", async () => {
    const { context, deleted } = createContext(seed());
    const accountability = { admin: true, user: "admin" };
    const result = await deleteUnusedFiles(context, { ids: [id(1), id(3), id(4), id(4000)], dryRun: false, accountability });
    const status = Object.fromEntries(result.results.map((entry) => [entry.id, entry.status]));
    assert.deepEqual(status, { [id(1)]: "in_use", [id(3)]: "in_use", [id(4)]: "deleted", [id(4000)]: "not_found" });
    assert.deepEqual(deleted, [{ keys: [id(4)], accountability }]);
  });

  it("never deletes in dry-run mode", async () => {
    const { context, deleted } = createContext(seed());
    const result = await deleteUnusedFiles(context, { ids: [id(4)], dryRun: true, accountability: { admin: true } });
    assert.equal(result.results[0].status, "would_delete");
    assert.deepEqual(deleted, []);
  });
});
