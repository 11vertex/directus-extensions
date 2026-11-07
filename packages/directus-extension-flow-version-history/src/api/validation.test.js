import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAdmin,
  parseActivityId,
  parseHistoryQuery
} from "./validation.js";

const FLOW_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("assertAdmin", () => {
  it("allows administrators and rejects others", () => {
    assert.doesNotThrow(() => assertAdmin({ admin: true }));
    assert.throws(() => assertAdmin({ admin: false }), (error) => error.status === 403);
  });
});

describe("parseHistoryQuery", () => {
  it("parses filters and defaults", () => {
    assert.deepEqual(
      parseHistoryQuery({
        flowId: FLOW_ID,
        action: "update",
        entity: "operation",
        search: " webhook "
      }),
      {
        flowId: FLOW_ID,
        page: 1,
        limit: 25,
        action: "update",
        entity: "operation",
        search: "webhook"
      }
    );
  });

  it("rejects invalid flow ids and actions", () => {
    assert.throws(() => parseHistoryQuery({ flowId: "nope" }), (error) => error.status === 400);
    assert.throws(
      () => parseHistoryQuery({ flowId: FLOW_ID, action: "run" }),
      (error) => error.status === 400
    );
  });
});

describe("activity ids", () => {
  it("parses numeric ids", () => {
    assert.equal(parseActivityId("42"), 42);
  });

  it("rejects ids that are not numbers", () => {
    assert.throws(() => parseActivityId("abc"), (error) => error.status === 400);
    assert.throws(() => parseActivityId(undefined), (error) => error.status === 400);
  });
});
