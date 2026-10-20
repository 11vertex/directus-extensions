import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCurrentProjection, buildDefinitionProjection } from "./projection.js";

const FLOW_ID = "550e8400-e29b-41d4-a716-446655440000";
const OP_A = "11111111-1111-4111-8111-111111111111";
const OP_B = "22222222-2222-4222-8222-222222222222";

function activity({ id, action, collection, item, timestamp, data, delta, parent }) {
  return {
    id,
    action,
    collection,
    item,
    timestamp,
    revisions: [
      {
        id: id * 10,
        parent: parent ?? null,
        data: data ?? null,
        delta: delta ?? null
      }
    ]
  };
}

describe("buildDefinitionProjection", () => {
  it("rebuilds trigger and operation cards with edges from deltas", () => {
    const graph = buildDefinitionProjection({
      flowId: FLOW_ID,
      asOfTimestamp: "2024-01-03T00:00:00.000Z",
      activities: [
        activity({
          id: 1,
          action: "create",
          collection: "directus_flows",
          item: FLOW_ID,
          timestamp: "2024-01-01T00:00:00.000Z",
          data: {
            id: FLOW_ID,
            name: "Notify",
            trigger: "manual",
            status: "active",
            options: {}
          }
        }),
        activity({
          id: 2,
          action: "create",
          collection: "directus_operations",
          item: OP_A,
          timestamp: "2024-01-01T00:00:01.000Z",
          data: {
            id: OP_A,
            name: "Log",
            key: "log_1",
            type: "log",
            position_x: 17,
            position_y: 1,
            options: { message: "hi" }
          },
          parent: 10
        }),
        activity({
          id: 3,
          action: "update",
          collection: "directus_flows",
          item: FLOW_ID,
          timestamp: "2024-01-02T00:00:00.000Z",
          data: {
            id: FLOW_ID,
            name: "Notify",
            trigger: "manual",
            status: "active",
            options: {}
          },
          delta: { operation: OP_A }
        }),
        activity({
          id: 4,
          action: "create",
          collection: "directus_operations",
          item: OP_B,
          timestamp: "2024-01-02T00:00:01.000Z",
          data: {
            id: OP_B,
            name: "Request",
            key: "req_1",
            type: "request",
            position_x: 33,
            position_y: 1,
            options: { url: "https://example.com" }
          }
        }),
        activity({
          id: 5,
          action: "update",
          collection: "directus_operations",
          item: OP_A,
          timestamp: "2024-01-03T00:00:00.000Z",
          data: {
            id: OP_A,
            name: "Log",
            key: "log_1",
            type: "log",
            position_x: 17,
            position_y: 1,
            options: { message: "hi" }
          },
          delta: { resolve: OP_B }
        })
      ]
    });

    assert.equal(graph.flowExists, true);
    assert.equal(graph.flow.operation, OP_A);
    assert.equal(graph.operations.length, 2);
    assert.equal(graph.panels[0].id, "$trigger");
    assert.equal(graph.panels[0].resolve, OP_A);
    const log = graph.panels.find((panel) => panel.id === OP_A);
    assert.equal(log.resolve, OP_B);
    assert.equal(log.x, 17);
    assert.equal(graph.confidence, "partial");
  });

  it("removes deleted operations and ignores later activities", () => {
    const graph = buildDefinitionProjection({
      flowId: FLOW_ID,
      asOfTimestamp: "2024-01-02T12:00:00.000Z",
      activities: [
        activity({
          id: 1,
          action: "create",
          collection: "directus_flows",
          item: FLOW_ID,
          timestamp: "2024-01-01T00:00:00.000Z",
          data: { name: "Flow", trigger: "manual", status: "active" }
        }),
        activity({
          id: 2,
          action: "create",
          collection: "directus_operations",
          item: OP_A,
          timestamp: "2024-01-01T00:00:01.000Z",
          data: {
            name: "A",
            key: "a",
            type: "log",
            position_x: 17,
            position_y: 1,
            options: {}
          }
        }),
        activity({
          id: 3,
          action: "delete",
          collection: "directus_operations",
          item: OP_A,
          timestamp: "2024-01-02T00:00:00.000Z",
          data: null,
          delta: null
        }),
        activity({
          id: 4,
          action: "create",
          collection: "directus_operations",
          item: OP_B,
          timestamp: "2024-01-03T00:00:00.000Z",
          data: {
            name: "B",
            key: "b",
            type: "log",
            position_x: 17,
            position_y: 1,
            options: {}
          }
        })
      ]
    });

    assert.equal(graph.operations.length, 0);
    assert.deepEqual(graph.deletedOperationIds, [OP_A]);
    assert.equal(graph.panels.length, 1);
  });

  it("redacts webhook secrets in card options", () => {
    const graph = buildDefinitionProjection({
      flowId: FLOW_ID,
      asOfTimestamp: "2024-01-01T00:00:00.000Z",
      activities: [
        activity({
          id: 1,
          action: "create",
          collection: "directus_flows",
          item: FLOW_ID,
          timestamp: "2024-01-01T00:00:00.000Z",
          data: { name: "Flow", trigger: "manual", options: {} }
        }),
        activity({
          id: 2,
          action: "create",
          collection: "directus_operations",
          item: OP_A,
          timestamp: "2024-01-01T00:00:00.000Z",
          data: {
            name: "Discord",
            key: "discord",
            type: "discord",
            position_x: 17,
            position_y: 1,
            options: {
              webhook: "https://discord.com/api/webhooks/1/abc"
            }
          }
        })
      ]
    });

    const card = graph.panels.find((panel) => panel.id === OP_A);
    assert.equal(card.options.webhook, "[REDACTED]");
  });
});

describe("buildCurrentProjection", () => {
  it("builds panels from live flow and operations", () => {
    const graph = buildCurrentProjection({
      flowId: FLOW_ID,
      flow: {
        id: FLOW_ID,
        name: "Live",
        trigger: "webhook",
        operation: OP_A,
        options: {}
      },
      operations: [
        {
          id: OP_A,
          name: "Step",
          key: "step",
          type: "log",
          position_x: 20,
          position_y: 5,
          resolve: OP_B,
          reject: null,
          options: { message: "x" }
        }
      ]
    });

    assert.equal(graph.confidence, "current");
    assert.equal(graph.panels[0].resolve, OP_A);
    assert.equal(graph.panels[1].x, 20);
    assert.equal(graph.panels[1].resolve, OP_B);
  });
});
