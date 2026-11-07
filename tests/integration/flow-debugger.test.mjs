import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clients } from "./support/client.mjs";

const { state, admin } = clients();

describe("Flow Debugger", () => {
  it("lists flows and whether they record step details", async () => {
    const meta = await admin.ok("GET", "/flow-debugger/meta");
    const notify = meta.flows.find((flow) => flow.id === state.flows.notify);
    assert.equal(notify.name, "Order notifications");
    assert.equal(notify.detailLogging, true);
  });

  it("lists completed runs, newest first, with their outcome", async () => {
    const result = await admin.ok("GET", "/flow-debugger/executions");
    const notifyRuns = result.items.filter((run) => run.flowId === state.flows.notify);
    const brokenRuns = result.items.filter((run) => run.flowId === state.flows.broken);
    assert.equal(notifyRuns.length, 2);
    assert.equal(brokenRuns.length, 2);
    assert.ok(notifyRuns.every((run) => run.finalStatus === "resolve" && run.stepCount === 3));
    assert.ok(brokenRuns.every((run) => run.finalStatus === "reject" && run.failedStepKey === "bad_slack"));
    const times = result.items.map((run) => String(run.timestamp ?? run.completedAt ?? ""));
    assert.deepEqual(times, [...times].sort().reverse());
  });

  it("filters to failed runs and to one flow", async () => {
    const failed = await admin.ok("GET", "/flow-debugger/executions?status=reject");
    assert.ok(failed.items.length >= 2);
    assert.ok(failed.items.every((run) => run.finalStatus === "reject"));

    const oneFlow = await admin.ok("GET", `/flow-debugger/executions?flowId=${state.flows.notify}`);
    assert.ok(oneFlow.items.length >= 2);
    assert.ok(oneFlow.items.every((run) => run.flowId === state.flows.notify));
  });

  it("shows each step of a successful run with its data", async () => {
    const runs = await admin.ok("GET", `/flow-debugger/executions?flowId=${state.flows.notify}`);
    const detail = await admin.ok("GET", `/flow-debugger/executions/${runs.items[0].id}`);
    assert.equal(detail.hasDetails, true);
    assert.equal(detail.finalStatus, "resolve");
    assert.deepEqual(detail.steps.map((step) => step.key), ["discord_msg", "slack_msg", "teams_msg"]);
    assert.ok(detail.steps.every((step) => step.status === "resolve"));
    assert.equal(detail.steps[0].name, "Discord");
  });

  it("points at the failing step of a failed run", async () => {
    const runs = await admin.ok("GET", `/flow-debugger/executions?flowId=${state.flows.broken}`);
    const detail = await admin.ok("GET", `/flow-debugger/executions/${runs.items[0].id}`);
    assert.equal(detail.finalStatus, "reject");
    assert.equal(detail.failedStepKey, "bad_slack");
    const failedStep = detail.steps.find((step) => step.key === "bad_slack");
    assert.equal(failedStep.status, "reject");
    assert.match(JSON.stringify(failedStep.result), /webhook URL/i);

    // The run can be drawn on the flow: every step that ran is a card, the failed one is among them.
    const cards = new Map(detail.graph.panels.map((panel) => [panel.id, panel]));
    assert.equal(cards.get("$trigger").kind, "trigger");
    assert.ok(cards.has(failedStep.operationId), "the failed step is a card in the picture");
    assert.ok(detail.graph.panels.every((panel) => Number.isFinite(panel.x) && Number.isFinite(panel.y)));
  });

  it("compares two runs of the same flow", async () => {
    const runs = await admin.ok("GET", `/flow-debugger/executions?flowId=${state.flows.notify}`);
    const comparison = await admin.get(
      `/flow-debugger/compare?baselineId=${runs.items[1].id}&comparisonId=${runs.items[0].id}`
    );
    assert.equal(comparison.status, 200, JSON.stringify(comparison.data));
  });

  it("refuses to compare runs of different flows", async () => {
    const notify = await admin.ok("GET", `/flow-debugger/executions?flowId=${state.flows.notify}`);
    const broken = await admin.ok("GET", `/flow-debugger/executions?flowId=${state.flows.broken}`);
    const comparison = await admin.get(
      `/flow-debugger/compare?baselineId=${notify.items[0].id}&comparisonId=${broken.items[0].id}`
    );
    assert.equal(comparison.status, 400);
  });

  it("can remember the chosen flow per user in Directus' presets", async () => {
    const me = await admin.ok("GET", "/users/me?fields=id");
    const created = await admin.ok("POST", "/presets", { user: me.id, collection: "flow-debugger", layout_options: { flowId: state.flows.notify } });
    await admin.ok("PATCH", `/presets/${created.id}`, { layout_options: { flowId: null } });
    const found = await admin.ok("GET", `/presets?filter[user][_eq]=${me.id}&filter[collection][_eq]=flow-debugger&fields=id,layout_options&limit=1`);
    assert.equal(found.length, 1);
    assert.equal(found[0].layout_options.flowId, null);
    await admin.ok("DELETE", `/presets/${created.id}`);
  });

  it("returns 404 for an activity that is not a flow run", async () => {
    const response = await admin.get("/flow-debugger/executions/1");
    assert.equal(response.status, 404);
  });
});
