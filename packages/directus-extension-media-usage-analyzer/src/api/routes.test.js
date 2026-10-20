import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerRoutes } from "./routes.js";

function setup(engine) {
  const handlers = {};
  registerRoutes(
    { get: (path, handler) => (handlers[`GET ${path}`] = handler), post: (path, handler) => (handlers[`POST ${path}`] = handler) },
    {},
    engine
  );
  return handlers;
}

function call(handler, req) {
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
    handler(req, res);
  });
}

const id = "00000000-0000-4000-8000-000000000001";

describe("routes", () => {
  it("rejects non-admins on every route", async () => {
    const handlers = setup({ runScan: async () => ({}), deleteUnusedFiles: async () => ({}) });
    assert.equal((await call(handlers["GET /scan"], { accountability: { admin: false }, query: {} })).status, 403);
    assert.equal((await call(handlers["POST /delete"], { accountability: null, body: { ids: [id] } })).status, 403);
  });

  it("passes the content option to the scan", async () => {
    let received;
    const handlers = setup({ runScan: async (_, options) => ((received = options), { ok: true }) });
    const result = await call(handlers["GET /scan"], { accountability: { admin: true }, query: { content: "true" } });
    assert.deepEqual(result.body, { ok: true });
    assert.deepEqual(received, { content: true });
  });

  it("validates delete payloads and defaults to dry run", async () => {
    let received;
    const handlers = setup({ deleteUnusedFiles: async (_, options) => ((received = options), { ok: true }) });
    const accountability = { admin: true, user: "u1" };
    assert.equal((await call(handlers["POST /delete"], { accountability, body: {} })).status, 400);
    await call(handlers["POST /delete"], { accountability, body: { ids: [id] } });
    assert.deepEqual(received, { ids: [id], dryRun: true, accountability });
  });

  it("maps engine failures to 500", async () => {
    const handlers = setup({ runScan: async () => { throw new Error("boom"); } });
    const result = await call(handlers["GET /scan"], { accountability: { admin: true }, query: {} });
    assert.equal(result.status, 500);
    assert.equal(result.body.errors[0].message, "boom");
  });
});
