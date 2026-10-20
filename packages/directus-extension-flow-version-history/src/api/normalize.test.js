import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareHistoryEvents,
  computeLastEdited,
  describeRevisionChanges,
  diffValues,
  findPreviousSnapshotActivity,
  isTrackedDefinitionActivity,
  normalizeHistoryDetail,
  normalizeHistoryEvent,
  resolveFlowId
} from "./normalize.js";

const FLOW_ID = "550e8400-e29b-41d4-a716-446655440000";
const OP_ID = "11111111-1111-4111-8111-111111111111";

function activity(overrides = {}) {
  return {
    id: 10,
    action: "update",
    collection: "directus_operations",
    item: OP_ID,
    timestamp: "2026-07-31T00:00:00.000Z",
    user: { id: "user-1", first_name: "Ada", last_name: "Lovelace" },
    revisions: [
      {
        id: 20,
        data: {
          id: OP_ID,
          flow: FLOW_ID,
          name: "Send webhook",
          type: "request",
          options: { url: "https://new.example.com" }
        },
        delta: { options: { url: "https://new.example.com" } }
      }
    ],
    ...overrides
  };
}

describe("definition activity normalization", () => {
  it("separates edit activity from run activity", () => {
    assert.equal(isTrackedDefinitionActivity(activity()), true);
    assert.equal(
      isTrackedDefinitionActivity({ collection: "directus_flows", action: "run" }),
      false
    );
  });

  it("derives operation flow and actor labels", () => {
    const event = normalizeHistoryEvent(activity());
    assert.equal(event.flowId, FLOW_ID);
    assert.equal(event.entity, "operation");
    assert.equal(event.entityLabel, "Send webhook");
    assert.equal(event.actor.label, "Ada Lovelace");
    assert.deepEqual(event.changedFields, ["options"]);
  });

  it("prefers delta.flow over snapshot.flow for association", () => {
    assert.equal(
      resolveFlowId(
        activity(),
        { flow: "22222222-2222-4222-8222-222222222222" },
        { flow: FLOW_ID },
        new Map()
      ),
      FLOW_ID
    );
  });

  it("redacts webhook secrets in revision payloads", () => {
    const event = normalizeHistoryEvent(
      activity({
        revisions: [
          {
            id: 20,
            data: {
              id: OP_ID,
              name: "Send webhook",
              options: { url: "https://discord.com/api/webhooks/1/secret" }
            },
            delta: {
              options: { url: "https://discord.com/api/webhooks/1/secret" }
            }
          }
        ]
      })
    );
    assert.equal(event.snapshot.options.url, "[REDACTED]");
    assert.equal(event.delta.options.url, "[REDACTED]");
  });

  it("uses historical mapping for delete activity without a revision", () => {
    assert.equal(
      resolveFlowId(
        activity({ action: "delete", revisions: [] }),
        null,
        null,
        new Map([[OP_ID, FLOW_ID]])
      ),
      FLOW_ID
    );
  });

  it("warns for delete activity without a snapshot", () => {
    const detail = normalizeHistoryDetail(
      activity({ action: "delete", revisions: [] }),
      { operationFlowMap: new Map([[OP_ID, FLOW_ID]]) }
    );
    assert.ok(detail.warnings.some((warning) => warning.includes("delete activity")));
  });
});

describe("revision diffs", () => {
  it("returns nested field changes", () => {
    assert.deepEqual(
      diffValues(
        { name: "Old", options: { method: "GET", timeout: 5 } },
        { name: "New", options: { method: "POST", timeout: 5 } }
      ),
      [
        { path: "name", change: "changed", before: "Old", after: "New" },
        {
          path: "options.method",
          change: "changed",
          before: "GET",
          after: "POST"
        }
      ]
    );
  });

  it("compares two revisions of the same entity", () => {
    const left = normalizeHistoryEvent(activity());
    const right = normalizeHistoryEvent(
      activity({
        id: 11,
        revisions: [
          {
            id: 21,
            data: {
              id: OP_ID,
              flow: FLOW_ID,
              name: "Send webhook",
              type: "request",
              options: { url: "https://other.example.com" }
            },
            delta: { options: { url: "https://other.example.com" } }
          }
        ]
      })
    );
    const result = compareHistoryEvents(left, right);
    assert.equal(result.differences[0].path, "options.url");
  });

  it("rejects comparing different entities", () => {
    const left = normalizeHistoryEvent(activity());
    const right = normalizeHistoryEvent(
      activity({ item: "22222222-2222-4222-8222-222222222222" })
    );
    assert.throws(() => compareHistoryEvents(left, right), (error) => error.status === 400);
  });
});

describe("change descriptions", () => {
  it("lists only fields that changed since the previous snapshot", () => {
    const changes = describeRevisionChanges({
      action: "update",
      previousSnapshot: {
        id: OP_ID,
        name: "Send email",
        options: { url: "https://old.example.com", method: "GET", body: null }
      },
      snapshot: {
        id: OP_ID,
        name: "Send email",
        options: { url: "https://new.example.com", method: "POST" },
        date_created: "2026-07-31T00:00:00.000Z"
      },
      delta: { options: { url: "https://new.example.com", method: "POST" } }
    });
    assert.deepEqual(
      changes.map((change) => [change.path, change.before, change.after]),
      [
        ["options.method", "GET", "POST"],
        ["options.url", "https://old.example.com", "https://new.example.com"]
      ]
    );
  });

  it("falls back to the delta when no previous snapshot exists", () => {
    const changes = describeRevisionChanges({
      action: "update",
      snapshot: { name: "Send email" },
      delta: { name: "Send email" }
    });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].path, "name");
    assert.equal(changes[0].beforeUnknown, true);
  });

  it("includes relational delta fields missing from snapshots", () => {
    const changes = describeRevisionChanges({
      action: "update",
      previousSnapshot: { name: "A" },
      snapshot: { name: "A" },
      delta: { resolve: OP_ID }
    });
    assert.deepEqual(changes.map((change) => change.path), ["resolve"]);
  });

  it("describes creates as new values and deletes as removed values", () => {
    const created = describeRevisionChanges({
      action: "create",
      snapshot: { id: OP_ID, name: "Log", options: {} }
    });
    assert.deepEqual(created.map((change) => [change.path, change.after]), [["name", "Log"]]);

    const removed = describeRevisionChanges({
      action: "delete",
      previousSnapshot: { id: OP_ID, name: "Log" }
    });
    assert.deepEqual(removed.map((change) => [change.path, change.before]), [["name", "Log"]]);
  });

  it("finds the newest earlier snapshot of the same item", () => {
    const target = activity({ id: 30 });
    const found = findPreviousSnapshotActivity(target, [
      activity({ id: 31 }),
      activity({ id: 25 }),
      activity({ id: 28, revisions: [] }),
      activity({ id: 20 }),
      activity({ id: 29, item: "other" })
    ]);
    assert.equal(found.id, 25);
  });

  it("computes the latest edit per flow including its operations", () => {
    const result = computeLastEdited(
      [
        { collection: "directus_flows", item: FLOW_ID, timestamp: "2026-07-01T00:00:00.000Z" },
        { collection: "directus_operations", item: OP_ID, timestamp: "2026-07-05T00:00:00.000Z" },
        { collection: "directus_operations", item: "orphan", timestamp: "2026-08-01T00:00:00.000Z" }
      ],
      new Map([[OP_ID, FLOW_ID]])
    );
    assert.equal(result.get(FLOW_ID), "2026-07-05T00:00:00.000Z");
    assert.equal(result.size, 1);
  });
});
