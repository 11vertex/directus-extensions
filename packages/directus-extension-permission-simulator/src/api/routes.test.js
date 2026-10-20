import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  registerRoutes
} from "./routes.js";
function createRouter() {
  const handlers = /* @__PURE__ */ new Map();
  const router = {
    get(path, handler) {
      handlers.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      handlers.set(`POST ${path}`, handler);
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
const engineContext = {};
function baseEngine(overrides = {}) {
  return {
    listUsers: async () => [],
    listRoles: async () => [],
    listCollections: async () => [],
    simulatePermissions: async () => ({}),
    comparePermissions: async () => ({}),
    ...overrides
  };
}
const VALID_USER = "550e8400-e29b-41d4-a716-446655440000";
const ROLE_A = "11111111-1111-4111-8111-111111111111";
const ROLE_B = "22222222-2222-4222-8222-222222222222";
describe("registerRoutes admin rejection", () => {
  it("rejects non-admin on GET /meta with 403", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(router, engineContext, baseEngine());
    const res = createResponse();
    await handlers.get("GET /meta")({ accountability: { admin: false } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.errors[0].extensions.code, "FORBIDDEN");
  });
  it("rejects missing accountability on POST /simulate with 403", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(router, engineContext, baseEngine());
    const res = createResponse();
    await handlers.get("POST /simulate")({ body: {} }, res);
    assert.equal(res.statusCode, 403);
  });
  it("rejects non-admin on POST /compare with 403", async () => {
    const { router, handlers } = createRouter();
    let called = false;
    registerRoutes(
      router,
      engineContext,
      baseEngine({
        comparePermissions: async () => {
          called = true;
          return {};
        }
      })
    );
    const res = createResponse();
    await handlers.get("POST /compare")(
      {
        accountability: { admin: false },
        body: { leftRoleId: ROLE_A, rightRoleId: ROLE_B }
      },
      res
    );
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
  });
  it("does not call the engine when rejecting a non-admin", async () => {
    const { router, handlers } = createRouter();
    let called = false;
    registerRoutes(
      router,
      engineContext,
      baseEngine({
        simulatePermissions: async () => {
          called = true;
          return {};
        }
      })
    );
    const res = createResponse();
    await handlers.get("POST /simulate")(
      { accountability: { admin: false }, body: { mode: "user", principalId: VALID_USER } },
      res
    );
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
  });
});
describe("registerRoutes payload validation", () => {
  it("returns 400 for an invalid simulate payload", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(router, engineContext, baseEngine());
    const res = createResponse();
    await handlers.get("POST /simulate")(
      { accountability: { admin: true }, body: { mode: "nope", principalId: VALID_USER } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.errors[0].extensions.code, "INVALID_PAYLOAD");
  });
  it("returns 400 for invalid compare role ids", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(router, engineContext, baseEngine());
    const res = createResponse();
    await handlers.get("POST /compare")(
      {
        accountability: { admin: true },
        body: { leftRoleId: "not-a-uuid", rightRoleId: ROLE_B }
      },
      res
    );
    assert.equal(res.statusCode, 400);
  });
});
describe("registerRoutes representative results", () => {
  it("returns an allow/deny simulation for an admin caller", async () => {
    const simulated = {
      mode: "user",
      selectedCollection: "articles",
      actions: [
        { action: "read", access: "full", allowed: true, itemAllowed: true, reason: null, fields: ["*"], presets: null },
        { action: "delete", access: "none", allowed: false, itemAllowed: false, reason: "denied", fields: null, presets: null }
      ]
    };
    let received;
    const { router, handlers } = createRouter();
    registerRoutes(
      router,
      engineContext,
      baseEngine({
        simulatePermissions: async (request) => {
          received = request;
          return simulated;
        }
      })
    );
    const res = createResponse();
    await handlers.get("POST /simulate")(
      {
        accountability: { admin: true },
        body: { mode: "user", principalId: VALID_USER, collection: "articles", primaryKey: "7" }
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, simulated);
    assert.deepEqual(received, {
      mode: "user",
      principalId: VALID_USER,
      collection: "articles",
      primaryKey: "7"
    });
  });
  it("returns a comparison result for identical and differing roles", async () => {
    const compared = {
      summary: { gained: 1, lost: 0, changed: 0, same: 3, fieldGained: 0, fieldLost: 0, conflictCount: 1 },
      accessDiffs: [
        { collection: "articles", action: "create", left: "none", right: "full", change: "gained" }
      ],
      conflicts: [
        {
          severity: "info",
          kind: "overlapping_rules",
          collection: "articles",
          action: "read",
          message: "overlap",
          policyIds: ["p1", "p2"]
        }
      ]
    };
    let received;
    const { router, handlers } = createRouter();
    registerRoutes(
      router,
      engineContext,
      baseEngine({
        comparePermissions: async (request) => {
          received = request;
          return compared;
        }
      })
    );
    const sameRes = createResponse();
    await handlers.get("POST /compare")(
      {
        accountability: { admin: true },
        body: { leftRoleId: ROLE_A, rightRoleId: ROLE_A, collection: "articles" }
      },
      sameRes
    );
    assert.equal(sameRes.statusCode, 200);
    assert.deepEqual(received, {
      leftRoleId: ROLE_A,
      rightRoleId: ROLE_A,
      collection: "articles"
    });
    const diffRes = createResponse();
    await handlers.get("POST /compare")(
      {
        accountability: { admin: true },
        body: { leftRoleId: ROLE_A, rightRoleId: ROLE_B, collection: "articles" }
      },
      diffRes
    );
    assert.equal(diffRes.statusCode, 200);
    assert.deepEqual(diffRes.body, compared);
  });
  it("returns meta lists for an admin caller", async () => {
    const { router, handlers } = createRouter();
    registerRoutes(
      router,
      engineContext,
      baseEngine({
        listUsers: async () => [{ id: VALID_USER, name: "Ada" }],
        listRoles: async () => [{ id: "role-1", name: "Editor" }],
        listCollections: async () => ["articles", "authors"]
      })
    );
    const res = createResponse();
    await handlers.get("GET /meta")({ accountability: { admin: true } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      users: [{ id: VALID_USER, name: "Ada" }],
      roles: [{ id: "role-1", name: "Editor" }],
      collections: ["articles", "authors"]
    });
  });
});
