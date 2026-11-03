import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatExecutionDetailCsv,
  formatExecutionDetailJson,
  formatExecutionsCsv,
  formatExecutionsJson
} from "./reports.js";

const listResult = {
  items: [
    {
      id: 12,
      flowId: "550e8400-e29b-41d4-a716-446655440000",
      flowName: "Notify Discord",
      finalStatus: "reject",
      completedAt: "2026-07-30T18:00:00.000Z",
      userId: "22222222-2222-4222-8222-222222222222",
      hasDetails: true,
      stepCount: 2,
      failedStepKey: "webhook_1",
      origin: "http://localhost:8055"
    }
  ],
  page: 1,
  limit: 25,
  total: 1
};

const detail = {
  id: 12,
  flowId: "550e8400-e29b-41d4-a716-446655440000",
  flowName: "Notify Discord",
  finalStatus: "reject",
  completedAt: "2026-07-30T18:00:00.000Z",
  userId: "22222222-2222-4222-8222-222222222222",
  hasDetails: true,
  steps: [
    {
      index: 0,
      key: "item_read_1",
      status: "resolve",
      type: "item-read",
      name: "Read Item",
      isError: false
    }
  ],
  warnings: ['Set accountability to "All" for details.']
};

describe("report formatters", () => {
  it("formats executions JSON without secrets keys invented by the formatter", () => {
    const json = formatExecutionsJson(listResult, detail);
    const parsed = JSON.parse(json);
    assert.equal(parsed.meta.reportType, "flow-executions");
    assert.equal(parsed.list.items[0].id, 12);
    assert.equal(parsed.detail.id, 12);
    assert.equal(json.includes("password"), false);
  });

  it("formats executions CSV rows", () => {
    const csv = formatExecutionsCsv(listResult);
    assert.ok(csv.includes("Notify Discord"));
    assert.ok(csv.includes("reject"));
    assert.ok(csv.includes("webhook_1"));
  });

  it("formats execution detail JSON and CSV", () => {
    const json = JSON.parse(formatExecutionDetailJson(detail));
    const csv = formatExecutionDetailCsv(detail);
    assert.equal(json.meta.reportType, "flow-execution-detail");
    assert.ok(csv.includes("item_read_1"));
    assert.ok(csv.includes("warning"));
  });
});
