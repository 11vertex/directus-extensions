import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAdmin,
  isUuid,
  normalizeAccessLevel,
  parseCompareRequest,
  parseSimulateRequest
} from "./validation.js";
describe("isUuid", () => {
  it("accepts valid UUIDs", () => {
    assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  });
  it("rejects invalid values", () => {
    assert.equal(isUuid("not-a-uuid"), false);
    assert.equal(isUuid(""), false);
  });
});
describe("assertAdmin", () => {
  it("allows administrators", () => {
    assert.doesNotThrow(() => assertAdmin({ admin: true }));
  });
  it("rejects non-administrators", () => {
    assert.throws(() => assertAdmin({ admin: false }), /Administrator access/);
    assert.throws(() => assertAdmin(null), /Administrator access/);
  });
});
describe("parseSimulateRequest", () => {
  it("parses a valid user simulation request", () => {
    const request = parseSimulateRequest({
      mode: "user",
      principalId: "550e8400-e29b-41d4-a716-446655440000",
      collection: "articles",
      primaryKey: "12",
      fields: ["title", "status"]
    });
    assert.deepEqual(request, {
      mode: "user",
      principalId: "550e8400-e29b-41d4-a716-446655440000",
      collection: "articles",
      primaryKey: "12",
      fields: ["title", "status"]
    });
  });
  it("requires a UUID principal", () => {
    assert.throws(
      () => parseSimulateRequest({
        mode: "role",
        principalId: "admin"
      }),
      /valid UUID/
    );
  });
  it("requires collection when primaryKey is set", () => {
    assert.throws(
      () => parseSimulateRequest({
        mode: "user",
        principalId: "550e8400-e29b-41d4-a716-446655440000",
        primaryKey: "1"
      }),
      /collection is required/
    );
  });
  it("rejects invalid collection names", () => {
    assert.throws(
      () => parseSimulateRequest({
        mode: "user",
        principalId: "550e8400-e29b-41d4-a716-446655440000",
        collection: "articles;drop"
      }),
      /invalid characters/
    );
  });
});
describe("parseCompareRequest", () => {
  it("parses a valid compare request", () => {
    const request = parseCompareRequest({
      leftRoleId: "11111111-1111-4111-8111-111111111111",
      rightRoleId: "22222222-2222-4222-8222-222222222222",
      collection: "articles"
    });
    assert.deepEqual(request, {
      leftRoleId: "11111111-1111-4111-8111-111111111111",
      rightRoleId: "22222222-2222-4222-8222-222222222222",
      collection: "articles"
    });
  });
  it("rejects invalid role ids", () => {
    assert.throws(
      () => parseCompareRequest({
        leftRoleId: "bad",
        rightRoleId: "22222222-2222-4222-8222-222222222222"
      }),
      /leftRoleId must be a valid UUID/
    );
  });
});
describe("normalizeAccessLevel", () => {
  it("normalizes known and unknown access values", () => {
    assert.equal(normalizeAccessLevel("full"), "full");
    assert.equal(normalizeAccessLevel("partial"), "partial");
    assert.equal(normalizeAccessLevel("none"), "none");
    assert.equal(normalizeAccessLevel(void 0), "none");
    assert.equal(normalizeAccessLevel("something-else"), "none");
  });
});
