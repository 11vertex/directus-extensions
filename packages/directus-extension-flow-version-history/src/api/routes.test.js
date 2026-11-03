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
    getFlowGraph: async () => ({ panels: [] }),
    compareHistory: async () => ({}),
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

  it("returns comparison results", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(
      router,
      {},
      engine({
        compareHistory: async (input) => ({ input, differences: [] })
      })
    );
    const res = response();
    await handlers.get("GET /compare")(
      {
        accountability: { admin: true },
        query: { leftId: "1", rightId: "2" }
      },
      res
    );
    assert.deepEqual(res.body.input, { leftId: 1, rightId: 2 });
  });

  it("returns a flow graph projection", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(
      router,
      {},
      engine({
        getFlowGraph: async (query) => ({ flowId: query.flowId, panels: [{ id: "$trigger" }] })
      })
    );
    const res = response();
    await handlers.get("GET /graph")(
      { accountability: { admin: true }, query: { flowId: FLOW_ID } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.flowId, FLOW_ID);
    assert.equal(res.body.panels[0].id, "$trigger");
  });
});
