import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerRoutes } from "./routes.js";

const engine = (overrides = {}) => ({
  getOverview: async () => ({ insights: {} }),
  getRetention: () => ({ batch: 250 }),
  purge: async (_, request) => ({ request }),
  ...overrides
});

function setup(implementation) {
  const handlers = {};
  const register = (method) => (path, handler) => (handlers[`${method} ${path}`] = handler);
  registerRoutes({ get: register("GET"), post: register("POST") }, {}, implementation);
  return handlers;
}

function call(handler, accountability, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
      }
    };
    handler({ accountability, body }, res);
  });
}

describe("routes", () => {
  it("rejects non-admins on every route", async () => {
    const handlers = setup(engine());
    for (const handler of Object.values(handlers)) {
      const result = await call(handler, { admin: false }, { collection: "a" });
      assert.equal(result.status, 403);
      assert.equal(result.body.errors[0].extensions.code, "FORBIDDEN");
    }
  });

  it("returns the overview and retention for admins", async () => {
    const handlers = setup(engine());
    assert.deepEqual((await call(handlers["GET /overview"], { admin: true })).body, { insights: {} });
    assert.deepEqual((await call(handlers["GET /retention"], { admin: true })).body, { batch: 250 });
  });

  it("validates purge payloads with 400", async () => {
    const handlers = setup(engine());
    const invalid = await call(handlers["POST /purge"], { admin: true }, { collection: "a", action: "truncate" });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.errors[0].extensions.code, "INVALID_PAYLOAD");

    const unconfirmed = await call(handlers["POST /purge"], { admin: true }, { collection: "a", dryRun: false });
    assert.equal(unconfirmed.status, 400);
  });

  it("passes parsed requests to the engine using RETENTION_BATCH as default", async () => {
    const handlers = setup(engine());
    const result = await call(handlers["POST /purge"], { admin: true }, { collection: "articles" });
    assert.equal(result.status, 200);
    assert.equal(result.body.request.dryRun, true);
    assert.equal(result.body.request.batchSize, 250);
  });

  it("maps engine errors to their status", async () => {
    const conflict = Object.assign(new Error("busy"), { status: 409 });
    const handlers = setup(engine({ purge: async () => { throw conflict; }, getOverview: async () => { throw new Error("boom"); } }));
    assert.equal((await call(handlers["POST /purge"], { admin: true }, { collection: "a" })).status, 409);
    assert.equal((await call(handlers["GET /overview"], { admin: true })).status, 500);
  });
});
