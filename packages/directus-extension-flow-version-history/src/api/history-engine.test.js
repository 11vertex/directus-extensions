import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findOperationsInOtherFlows, listFlows, listHistory } from "./history-engine.js";

const FLOW_ID = "550e8400-e29b-41d4-a716-446655440000";
const OP_ID = "11111111-1111-4111-8111-111111111111";

const flowActivities = [
  {
    id: 1,
    action: "create",
    collection: "directus_flows",
    item: FLOW_ID,
    timestamp: "2026-07-01T00:00:00.000Z",
    user: { id: "u1", first_name: "Jane", last_name: "Doe" },
    revisions: [{ id: 101, data: { name: "Notify" }, delta: { name: "Notify" } }]
  }
];

const opActivities = [
  {
    id: 2,
    action: "create",
    collection: "directus_operations",
    item: OP_ID,
    timestamp: "2026-07-02T00:00:00.000Z",
    user: { id: "u1", first_name: "Jane", last_name: "Doe" },
    revisions: [
      { id: 102, data: { name: "Send", options: { url: "https://a.example", method: "GET" } } }
    ]
  },
  {
    id: 3,
    action: "update",
    collection: "directus_operations",
    item: OP_ID,
    timestamp: "2026-07-03T00:00:00.000Z",
    user: { id: "u1", first_name: "Jane", last_name: "Doe" },
    revisions: [
      {
        id: 103,
        data: { name: "Send", options: { url: "https://b.example", method: "POST" } },
        delta: { options: { url: "https://b.example", method: "POST" } }
      }
    ]
  }
];

function filterText(query) {
  return JSON.stringify(query.filter ?? {});
}

function context() {
  class FlowsService {
    async readByQuery() {
      return [
        { id: FLOW_ID, name: "Notify", date_created: "2026-06-01T00:00:00.000Z" },
        { id: "other", name: "Other", date_created: "2026-06-02T00:00:00.000Z" }
      ];
    }
    async readOne(id) {
      return { id, name: "Notify" };
    }
  }
  class OperationsService {
    async readByQuery() {
      return [{ id: OP_ID, flow: FLOW_ID, name: "Send" }];
    }
  }
  class ActivityService {
    async readByQuery(query) {
      const text = filterText(query);
      if (text.includes('"_in":["directus_flows","directus_operations"]')) {
        return [...opActivities, ...flowActivities].map(({ collection, item, timestamp }) => ({
          collection,
          item,
          timestamp
        }));
      }
      if (text.includes("_between")) return [];
      if (text.includes('"directus_flows"')) return flowActivities;
      if (text.includes('"directus_operations"')) return opActivities;
      return [];
    }
  }
  class RevisionsService {
    async readByQuery() {
      return [];
    }
  }
  return {
    getSchema: async () => ({}),
    database: {},
    services: { FlowsService, OperationsService, ActivityService, RevisionsService }
  };
}

describe("history engine", () => {
  it("adds lastEditedAt per flow, counting operation edits", async () => {
    const flows = await listFlows(context());
    const notify = flows.find((flow) => flow.id === FLOW_ID);
    assert.equal(notify.lastEditedAt, "2026-07-03T00:00:00.000Z");
    assert.equal(flows.find((flow) => flow.id === "other").lastEditedAt, null);
  });

  it("returns changed field paths compared with the previous snapshot", async () => {
    const result = await listHistory({ flowId: FLOW_ID, page: 1, limit: 25 }, context());
    const update = result.items.find((item) => item.id === 3);
    assert.deepEqual(update.changedPaths, ["options.method", "options.url"]);
    assert.equal(update.previousId, 2);
    const created = result.items.find((item) => item.id === 2);
    assert.equal(created.previousId, null);
  });
});

describe("findOperationsInOtherFlows", () => {
  it("returns operations that currently belong to a different flow", async () => {
    const service = {
      readByQuery: async ({ filter }) => {
        assert.deepEqual(filter, { id: { _in: ["a", "b", "c"] } });
        return [
          { id: "a", flow: FLOW_ID },
          { id: "b", flow: "other-flow" }
        ];
      }
    };
    const result = await findOperationsInOtherFlows(["a", "b", "c"], FLOW_ID, service);
    assert.deepEqual([...result], ["b"]);
  });

  it("skips the query when there is nothing to check", async () => {
    const service = { readByQuery: async () => assert.fail("should not query") };
    assert.equal((await findOperationsInOtherFlows([], FLOW_ID, service)).size, 0);
  });
});
