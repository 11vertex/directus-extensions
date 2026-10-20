import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { httpError } from "./errors.js";
import { MAX_LIMIT, parseLimit, registerRoutes } from "./routes.js";

function setup(engine) {
  const handlers = {};
  registerRoutes({ get: (path, handler) => (handlers[path] = handler) }, { ctx: true }, engine);
  return handlers;
}

function call(handler, accountability, { params = {}, query = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      }
    };
    handler({ accountability, params, query }, res);
  });
}

describe("routes", () => {
  it("registers every endpoint", () => {
    assert.deepEqual(Object.keys(setup({})).sort(), [
      "/browse/:collection",
      "/graph",
      "/impact/:collection/:pk",
      "/orphans/:collection",
      "/records/:collection/:pk"
    ]);
  });

  it("rejects non-admins", async () => {
    const handlers = setup({ getGraph: async () => ({}) });
    const result = await call(handlers["/graph"], { admin: false });
    assert.equal(result.status, 403);
    assert.equal(result.body.errors[0].extensions.code, "FORBIDDEN");
  });

  it("returns the graph for admins", async () => {
    const handlers = setup({ getGraph: async (context) => ({ edges: [], context }) });
    const result = await call(handlers["/graph"], { admin: true });
    assert.deepEqual(result.body, { edges: [], context: { ctx: true } });
  });

  it("passes params and a clamped limit to the engine", async () => {
    let received;
    const handlers = setup({ exploreRecord: async (_context, args) => (received = args) });
    await call(handlers["/records/:collection/:pk"], { admin: true }, { params: { collection: "articles", pk: "5" }, query: { limit: "5000" } });
    assert.deepEqual(received, { collection: "articles", pk: "5", limit: MAX_LIMIT });
  });

  it("trims browse search", async () => {
    let received;
    const handlers = setup({ browseRecords: async (_context, args) => (received = args) });
    await call(handlers["/browse/:collection"], { admin: true }, { params: { collection: "tags" }, query: { search: "  news " } });
    assert.deepEqual(received, { collection: "tags", search: "news", limit: 25 });
  });

  it("maps engine errors to their status", async () => {
    const handlers = setup({ analyzeImpact: async () => { throw httpError(404, "missing"); } });
    const result = await call(handlers["/impact/:collection/:pk"], { admin: true }, { params: { collection: "a", pk: "1" } });
    assert.equal(result.status, 404);
    assert.equal(result.body.errors[0].extensions.code, "NOT_FOUND");
  });

  it("maps unexpected failures to 500", async () => {
    const handlers = setup({ findOrphans: async () => { throw new Error("boom"); } });
    const result = await call(handlers["/orphans/:collection"], { admin: true }, { params: { collection: "a" } });
    assert.equal(result.status, 500);
  });
});

describe("parseLimit", () => {
  it("falls back for invalid values and clamps large ones", () => {
    assert.equal(parseLimit(undefined), 25);
    assert.equal(parseLimit("0"), 25);
    assert.equal(parseLimit("abc"), 25);
    assert.equal(parseLimit("10"), 10);
    assert.equal(parseLimit("999"), MAX_LIMIT);
  });
});
