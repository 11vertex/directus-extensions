import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerRoutes } from "./routes.js";

function createRouter() {
  const handlers = /* @__PURE__ */ new Map();
  const router = {
    get(path, handler) {
      handlers.set(`GET ${path}`, handler);
    }
  };
  return { router, handlers };
}

function createResponse() {
  const res = {
    statusCode: 200,
    body: void 0,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
  return res;
}

function baseEngine(overrides = {}) {
  return {
    listFlows: async () => [{ id: "flow-1", name: "Demo", detailLogging: true }],
    listExecutions: async () => ({ items: [], page: 1, limit: 25, total: 0 }),
    getExecution: async () => ({ id: 1, steps: [] }),
    compareExecutions: async () => ({ steps: [], variables: [] }),
    ...overrides
  };
}

describe("registerRoutes admin rejection", () => {
  it("rejects non-admin on GET /meta with 403", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(router, {}, baseEngine());
    const res = createResponse();
    await handlers.get("GET /meta")({ accountability: { admin: false } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.errors[0].extensions.code, "FORBIDDEN");
  });

  it("rejects missing accountability on GET /executions with 403", async () => {
    const { router, handlers } = createRouter();
    let called = false;
    registerRoutes(
      router,
      {},
      baseEngine({
        listExecutions: async () => {
          called = true;
          return { items: [] };
        }
      })
    );
    const res = createResponse();
    await handlers.get("GET /executions")({ query: {} }, res);
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
  });

  it("rejects non-admin on GET /executions/:id with 403", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(router, {}, baseEngine());
    const res = createResponse();
    await handlers.get("GET /executions/:id")(
      { accountability: { admin: false }, params: { id: "12" } },
      res
    );
    assert.equal(res.statusCode, 403);
  });
});

describe("registerRoutes payload validation", () => {
  it("returns 400 for an invalid executions query", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(router, {}, baseEngine());
    const res = createResponse();
    await handlers.get("GET /executions")(
      { accountability: { admin: true }, query: { status: "nope" } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.errors[0].extensions.code, "INVALID_PAYLOAD");
  });

  it("returns 400 for a non-numeric execution id", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(router, {}, baseEngine());
    const res = createResponse();
    await handlers.get("GET /executions/:id")(
      { accountability: { admin: true }, params: { id: "abc" } },
      res
    );
    assert.equal(res.statusCode, 400);
  });
});

describe("registerRoutes representative results", () => {
  it("returns meta for an admin caller", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(router, {}, baseEngine());
    const res = createResponse();
    await handlers.get("GET /meta")({ accountability: { admin: true } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.flows[0].name, "Demo");
    assert.ok(Array.isArray(res.body.caveats));
  });

  it("returns executions for an admin caller", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(
      router,
      {},
      baseEngine({
        listExecutions: async (query) => ({
          items: [{ id: 7, finalStatus: query.status || "resolve" }],
          page: query.page,
          limit: query.limit,
          total: 1
        })
      })
    );
    const res = createResponse();
    await handlers.get("GET /executions")(
      {
        accountability: { admin: true },
        query: { status: "reject", page: "1", limit: "10" }
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.items[0].id, 7);
    assert.equal(res.body.items[0].finalStatus, "reject");
  });

  it("returns execution detail for an admin caller", async () => {
    const { router, handlers } = createRouter();
    let seenId = null;
    registerRoutes(
      router,
      {},
      baseEngine({
        getExecution: async (id) => {
          seenId = id;
          return { id, finalStatus: "resolve", steps: [] };
        }
      })
    );
    const res = createResponse();
    await handlers.get("GET /executions/:id")(
      { accountability: { admin: true }, params: { id: "42" } },
      res
    );
    assert.equal(seenId, 42);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.id, 42);
  });

  it("returns a run comparison for an admin caller", async () => {
    const { router, handlers } = createRouter();
    let request = null;
    registerRoutes(
      router,
      {},
      baseEngine({
        compareExecutions: async (input) => {
          request = input;
          return { summary: { firstDivergenceKey: "notify" } };
        }
      })
    );
    const res = createResponse();
    await handlers.get("GET /compare")(
      {
        accountability: { admin: true },
        query: { baselineId: "10", comparisonId: "11" }
      },
      res
    );
    assert.deepEqual(request, { baselineId: 10, comparisonId: 11 });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.summary.firstDivergenceKey, "notify");
  });
});
