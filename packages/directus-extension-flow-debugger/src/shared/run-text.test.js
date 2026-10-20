import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeComparison,
  describeStepError,
  findFailedStep,
  findPreviousSuccessfulRun,
  relativeTime,
  stepLabel,
  triggerLabel
} from "./run-text.js";

const FLOW = "550e8400-e29b-41d4-a716-446655440000";
const OTHER = "660e8400-e29b-41d4-a716-446655440000";

describe("relativeTime", () => {
  const now = Date.parse("2026-10-21T12:00:00.000Z");

  it("formats recent times in plain words", () => {
    assert.equal(relativeTime("2026-10-21T11:59:50.000Z", now), "just now");
    assert.equal(relativeTime("2026-10-21T11:55:00.000Z", now), "5 min ago");
    assert.equal(relativeTime("2026-10-21T11:00:00.000Z", now), "1 hour ago");
    assert.equal(relativeTime("2026-10-21T09:00:00.000Z", now), "3 hours ago");
    assert.equal(relativeTime("2026-10-18T12:00:00.000Z", now), "3 days ago");
  });

  it("handles missing values", () => {
    assert.equal(relativeTime(null, now), "unknown time");
  });
});

describe("labels", () => {
  it("maps trigger types to friendly names", () => {
    assert.equal(triggerLabel("schedule"), "Schedule");
    assert.equal(triggerLabel("webhook"), "Webhook");
    assert.equal(triggerLabel(null), "System");
  });

  it("prefers the step name over its key", () => {
    assert.equal(stepLabel({ key: "mail_1", name: "Send email" }), "Send email");
    assert.equal(stepLabel({ key: "mail_1", name: null }), "mail_1");
  });
});

describe("describeStepError", () => {
  it("extracts messages from common error shapes", () => {
    assert.equal(describeStepError({ message: "SMTP refused" }), "SMTP refused");
    assert.equal(describeStepError("Boom"), "Boom");
    assert.equal(describeStepError({ errors: [{ message: "Invalid payload" }] }), "Invalid payload");
    assert.equal(describeStepError([{ message: "First" }]), "First");
    assert.equal(describeStepError({ status: 500, statusText: "Server Error" }), "500 Server Error");
    assert.equal(describeStepError(null), "No error message was saved.");
  });
});

describe("findFailedStep", () => {
  it("returns the step matching failedStepKey", () => {
    const detail = {
      failedStepKey: "mail_1",
      steps: [
        { key: "read_1", status: "resolve" },
        { key: "mail_1", status: "reject", name: "Send email" }
      ]
    };
    assert.equal(findFailedStep(detail).name, "Send email");
  });

  it("returns null when nothing failed", () => {
    assert.equal(findFailedStep({ steps: [{ key: "a", status: "resolve" }] }), null);
  });
});

describe("findPreviousSuccessfulRun", () => {
  const run = { id: 10, flowId: FLOW };

  it("picks the newest earlier successful run of the same flow", () => {
    const candidates = [
      { id: 12, flowId: FLOW, finalStatus: "resolve", hasDetails: true },
      { id: 9, flowId: FLOW, finalStatus: "reject", hasDetails: true },
      { id: 8, flowId: OTHER, finalStatus: "resolve", hasDetails: true },
      { id: 7, flowId: FLOW, finalStatus: "resolve", hasDetails: true },
      { id: 5, flowId: FLOW, finalStatus: "resolve", hasDetails: true }
    ];
    assert.equal(findPreviousSuccessfulRun(run, candidates).id, 7);
  });

  it("returns null when there is none", () => {
    assert.equal(findPreviousSuccessfulRun(run, []), null);
    assert.equal(findPreviousSuccessfulRun(null, []), null);
  });
});

describe("describeComparison", () => {
  it("turns differences into plain sentences", () => {
    const lines = describeComparison({
      summary: { baselineStatus: "resolve", comparisonStatus: "reject" },
      trigger: { changed: true, baseline: { a: 1 }, comparison: { a: 2 } },
      steps: [
        { key: "read_1", change: "same", baseline: {}, comparison: {} },
        {
          key: "mail_1",
          change: "status_changed",
          baseline: { key: "mail_1", name: "Send email", status: "resolve" },
          comparison: { key: "mail_1", name: "Send email", status: "reject" }
        },
        { key: "log_1", change: "removed", baseline: { key: "log_1", name: "Log" }, comparison: null }
      ]
    });
    const texts = lines.map((line) => line.text);
    assert.deepEqual(texts, [
      "This run failed, but the last successful run did not.",
      "The data that started the flow was different.",
      "‘Send email’ failed this time, but worked before.",
      "‘Log’ ran in the successful run, but not this time."
    ]);
  });

  it("returns no lines when runs match", () => {
    const lines = describeComparison({
      summary: { baselineStatus: "resolve", comparisonStatus: "resolve" },
      trigger: { changed: false },
      steps: [{ key: "a", change: "same" }]
    });
    assert.equal(lines.length, 0);
  });
});
