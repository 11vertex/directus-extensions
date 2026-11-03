import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerRoutes } from "./routes.js";

function setup(engine) {
  const handlers = {};
  registerRoutes({ get: (path, handler) => (handlers[path] = handler) }, {}, engine);
  return handlers;
}

function call(handler, accountability) {
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
    handler({ accountability }, res);
  });
}

describe("routes", () => {
  it("rejects non-admins", async () => {
    const handlers = setup({ runAudit: async () => ({}) });
    const result = await call(handlers["/audit"], { admin: false });
    assert.equal(result.status, 403);
  });

  it("returns the audit for admins", async () => {
    const handlers = setup({ runAudit: async () => ({ findings: [] }) });
    const result = await call(handlers["/audit"], { admin: true });
    assert.deepEqual(result.body, { findings: [] });
  });

  it("maps engine failures to 500", async () => {
    const handlers = setup({ runAudit: async () => { throw new Error("boom"); } });
    const result = await call(handlers["/audit"], { admin: true });
    assert.equal(result.status, 500);
  });
});
