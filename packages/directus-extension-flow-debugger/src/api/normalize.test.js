import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareExecutionDetails,
  deriveFinalStatus,
  findFailedStepKey,
  normalizeExecutionDetail,
  normalizeExecutionSummary
} from "./normalize.js";

const FLOW_ID = "550e8400-e29b-41d4-a716-446655440000";
const OP_ID = "11111111-1111-4111-8111-111111111111";

function activity(overrides = {}) {
  return {
    id: 12,
    action: "run",
    timestamp: "2026-07-30T18:00:00.000Z",
    user: "22222222-2222-4222-8222-222222222222",
    ip: "127.0.0.1",
    user_agent: "test",
    origin: "http://localhost:8055",
    collection: "directus_flows",
    item: FLOW_ID,
    revisions: [
      {
        id: 99,
        data: {
          steps: [
            {
              operation: OP_ID,
              key: "item_read_1",
              status: "resolve",
              options: { collection: "articles" }
            },
            {
              operation: "33333333-3333-4333-8333-333333333333",
              key: "webhook_1",
              status: "reject",
              options: { url: "https://example.com" }
            }
          ],
          data: {
            $trigger: { body: { id: 1 } },
            $last: { message: "failed" },
            $accountability: { user: "22222222-2222-4222-8222-222222222222" },
            $env: { PUBLIC: "yes" },
            item_read_1: { id: 1, title: "Hello" },
            webhook_1: { message: "Request failed" }
          }
        }
      }
    ],
    ...overrides
  };
}

describe("status helpers", () => {
  it("derives final status from the last step", () => {
    assert.equal(
      deriveFinalStatus([
        { status: "resolve" },
        { status: "reject" }
      ]),
      "reject"
    );
    assert.equal(deriveFinalStatus([]), "unknown");
  });

  it("finds the latest rejected step key", () => {
    assert.equal(
      findFailedStepKey([
        { key: "a", status: "reject" },
        { key: "b", status: "resolve" },
        { key: "c", status: "reject" }
      ]),
      "c"
    );
  });
});

describe("normalizeExecutionSummary", () => {
  it("normalizes a detailed activity row", () => {
    const flowMap = new Map([
      [FLOW_ID, { name: "Notify Discord", accountability: "all" }]
    ]);
    const summary = normalizeExecutionSummary(activity(), flowMap);
    assert.equal(summary.id, 12);
    assert.equal(summary.flowName, "Notify Discord");
    assert.equal(summary.finalStatus, "reject");
    assert.equal(summary.hasDetails, true);
    assert.equal(summary.stepCount, 2);
    assert.equal(summary.failedStepKey, "webhook_1");
    assert.equal(summary.revisionId, 99);
  });

  it("marks activity-only runs as missing details", () => {
    const flowMap = new Map([
      [FLOW_ID, { name: "Silent Flow", accountability: "activity" }]
    ]);
    const summary = normalizeExecutionSummary(
      activity({ revisions: [] }),
      flowMap
    );
    assert.equal(summary.hasDetails, false);
    assert.equal(summary.finalStatus, "unknown");
    assert.equal(summary.stepCount, 0);
  });
});

describe("normalizeExecutionDetail", () => {
  it("builds step timeline and separates variables from reserved keys", () => {
    const flowMap = new Map([
      [FLOW_ID, { name: "Notify Discord", accountability: "all" }]
    ]);
    const operationsMap = new Map([
      [OP_ID, { name: "Read Item", type: "item-read" }]
    ]);
    const detail = normalizeExecutionDetail(activity(), flowMap, operationsMap);

    assert.equal(detail.steps.length, 2);
    assert.equal(detail.steps[0].name, "Read Item");
    assert.equal(detail.steps[0].type, "item-read");
    assert.equal(detail.steps[0].isError, false);
    assert.deepEqual(detail.steps[0].result, { id: 1, title: "Hello" });
    assert.equal(detail.steps[1].isError, true);
    assert.deepEqual(detail.trigger, { body: { id: 1 } });
    assert.deepEqual(detail.variables, {
      item_read_1: { id: 1, title: "Hello" },
      webhook_1: { message: "Request failed" }
    });
    assert.equal(detail.warnings.length, 0);
  });

  it("warns when accountability prevents detail logging", () => {
    const flowMap = new Map([
      [FLOW_ID, { name: "Silent Flow", accountability: "activity" }]
    ]);
    const detail = normalizeExecutionDetail(activity({ revisions: [] }), flowMap);
    assert.ok(detail.warnings.some((warning) => warning.includes('"activity"')));
  });
});

describe("compareExecutionDetails", () => {
  it("finds the first status divergence and changed variables", () => {
    const baseline = {
      id: 1,
      flowId: FLOW_ID,
      flowName: "Notify Discord",
      finalStatus: "resolve",
      completedAt: "2026-07-30T18:00:00.000Z",
      userId: null,
      stepCount: 2,
      failedStepKey: null,
      trigger: { id: 1 },
      steps: [
        { key: "read", status: "resolve", result: { id: 1 }, options: null },
        { key: "notify", status: "resolve", result: { ok: true }, options: null }
      ],
      variables: { read: { id: 1 }, notify: { ok: true } }
    };
    const comparison = {
      ...baseline,
      id: 2,
      finalStatus: "reject",
      failedStepKey: "notify",
      steps: [
        { key: "read", status: "resolve", result: { id: 1 }, options: null },
        {
          key: "notify",
          status: "reject",
          result: { message: "Request failed" },
          options: null
        }
      ],
      variables: {
        read: { id: 1 },
        notify: { message: "Request failed" }
      }
    };

    const result = compareExecutionDetails(baseline, comparison);
    assert.equal(result.summary.statusChanged, true);
    assert.equal(result.summary.firstDivergenceKey, "notify");
    assert.equal(result.summary.changedSteps, 1);
    assert.equal(result.summary.changedVariables, 1);
    assert.equal(result.steps[1].change, "status_changed");
  });

  it("marks missing branch steps as added or removed", () => {
    const base = {
      id: 1,
      flowId: FLOW_ID,
      finalStatus: "resolve",
      steps: [{ key: "a", status: "resolve", result: 1, options: null }],
      variables: {},
      trigger: null
    };
    const result = compareExecutionDetails(base, {
      ...base,
      id: 2,
      steps: [{ key: "b", status: "resolve", result: 2, options: null }]
    });
    assert.deepEqual(
      result.steps.map((step) => step.change),
      ["removed", "added"]
    );
  });
});
