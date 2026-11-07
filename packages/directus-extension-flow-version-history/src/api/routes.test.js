import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerRoutes } from "./routes.js";

const FLOW_ID = "550e8400-e29b-41d4-a716-446655440000";

function createRouter() {
  const handlers = new Map();
  return {
    handlers,
    router: {
      get(path, handler) {
        handlers.set(`GET ${path}`, handler);
      },
      post(path, handler) {
        handlers.set(`POST ${path}`, handler);
      }
    }
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function engine(overrides = {}) {
  return {
    listFlows: async () => [],
    listHistory: async () => ({ items: [] }),
    getHistoryDetail: async () => ({}),
    ...overrides
  };
}

describe("history routes", () => {
  it("rejects non-admin callers before invoking the engine", async () => {
    const { router, handlers } = createRouter();
    let called = false;
    registerRoutes(
      router,
      {},
      engine({
        listHistory: async () => {
          called = true;
          return {};
        }
      })
    );
    const res = response();
    await handlers.get("GET /history")(
      { accountability: { admin: false }, query: { flowId: FLOW_ID } },
      res
    );
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
  });

  it("validates the required flow id", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(router, {}, engine());
    const res = response();
    await handlers.get("GET /history")(
      { accountability: { admin: true }, query: {} },
      res
    );
    assert.equal(res.statusCode, 400);
  });

  it("returns normalized history", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(
      router,
      {},
      engine({
        listHistory: async (query) => ({
          items: [{ id: 1, flowId: query.flowId }],
          page: query.page
        })
      })
    );
    const res = response();
    await handlers.get("GET /history")(
      { accountability: { admin: true }, query: { flowId: FLOW_ID } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.items[0].flowId, FLOW_ID);
  });

  it("restores only for administrators and passes who asked", async () => {
    const { router, handlers } = createRouter();
    const calls = [];
    registerRoutes(router, {}, engine({ restoreFlow: async (input) => { calls.push(input); return { restored: true }; } }));
    const handler = handlers.get("POST /restore/:id");

    const denied = response();
    await handler({ accountability: { admin: false }, params: { id: "5" }, body: { flowId: FLOW_ID } }, denied);
    assert.equal(denied.statusCode, 403);
    assert.equal(calls.length, 0);

    const bad = response();
    await handler({ accountability: { admin: true }, params: { id: "5" }, body: {} }, bad);
    assert.equal(bad.statusCode, 400);

    const accountability = { admin: true, user: "u1" };
    const ok = response();
    await handler({ accountability, params: { id: "5" }, body: { flowId: FLOW_ID } }, ok);
    assert.deepEqual(ok.body, { restored: true });
    assert.deepEqual(calls, [{ flowId: FLOW_ID, activityId: 5, accountability }]);
  });
});
