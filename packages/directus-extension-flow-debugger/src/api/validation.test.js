import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAdmin,
  isUuid,
  parseCompareQuery,
  parseExecutionId,
  parseExecutionsQuery
} from "./validation.js";

describe("isUuid", () => {
  it("accepts valid UUIDs", () => {
    assert.equal(isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  });
  it("rejects invalid values", () => {
    assert.equal(isUuid("not-a-uuid"), false);
    assert.equal(isUuid(null), false);
  });
});

describe("assertAdmin", () => {
  it("allows administrators", () => {
    assert.doesNotThrow(() => assertAdmin({ admin: true }));
  });
  it("rejects non-administrators", () => {
    assert.throws(() => assertAdmin({ admin: false }), (error) => error.status === 403);
    assert.throws(() => assertAdmin(null), (error) => error.status === 403);
  });
});

describe("parseExecutionsQuery", () => {
  it("applies defaults", () => {
    assert.deepEqual(parseExecutionsQuery({}), {
      page: 1,
      limit: 25,
      flowId: null,
      status: null,
      search: null
    });
  });

  it("parses a valid filtered query", () => {
    const result = parseExecutionsQuery({
      page: "2",
      limit: "10",
      flowId: "550e8400-e29b-41d4-a716-446655440000",
      status: "reject",
      search: "discord"
    });
    assert.equal(result.page, 2);
    assert.equal(result.limit, 10);
    assert.equal(result.flowId, "550e8400-e29b-41d4-a716-446655440000");
    assert.equal(result.status, "reject");
    assert.equal(result.search, "discord");
  });

  it("rejects invalid status values", () => {
    assert.throws(
      () => parseExecutionsQuery({ status: "failed" }),
      (error) => error.status === 400
    );
  });

  it("rejects oversized search strings", () => {
    assert.throws(
      () => parseExecutionsQuery({ search: "x".repeat(201) }),
      (error) => error.status === 400
    );
  });
});

describe("parseExecutionId", () => {
  it("parses numeric activity ids", () => {
    assert.equal(parseExecutionId("42"), 42);
  });
  it("rejects non-numeric ids", () => {
    assert.throws(() => parseExecutionId("abc"), (error) => error.status === 400);
  });
});

describe("parseCompareQuery", () => {
  it("parses two different execution ids", () => {
    assert.deepEqual(
      parseCompareQuery({ baselineId: "12", comparisonId: "15" }),
      { baselineId: 12, comparisonId: 15 }
    );
  });

  it("rejects comparing an execution with itself", () => {
    assert.throws(
      () => parseCompareQuery({ baselineId: "12", comparisonId: "12" }),
      (error) => error.status === 400
    );
  });
});
