import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clients } from "./support/client.mjs";

const { state, admin } = clients();
const history = (flowId) => admin.ok("GET", `/flow-version-history/history?flowId=${flowId}`);

describe("Flow Version History", () => {
  it("lists flows with when they were last edited", async () => {
    const meta = await admin.ok("GET", "/flow-version-history/meta");
    const notify = meta.flows.find((flow) => flow.id === state.flows.notify);
    assert.ok(notify, "seeded flow is listed");
    assert.ok(notify.lastEditedAt, "last edit time is known");
  });

  it("shows the flow's own edits, newest first", async () => {
    const result = await history(state.flows.notify);
    const rename = result.items.find((event) => event.entity === "flow" && event.changedPaths?.includes("name"));
    assert.ok(rename, "the rename is in the history");
    const slackEdit = result.items.find((event) => event.entity === "operation" && event.entityLabel === "Slack" && event.action === "update");
    assert.ok(slackEdit, "the Slack step edit is in the history");
    assert.deepEqual(slackEdit.changedPaths, ["options.text"]);
    const ids = result.items.map((event) => event.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  });

  it("does not mix in steps from other flows edited at the same time", async () => {
    const notify = await history(state.flows.notify);
    const labels = notify.items.filter((event) => event.entity === "operation").map((event) => event.entityLabel);
    assert.ok(!labels.includes("Bad Slack"), `"Bad Slack" belongs to another flow (got ${labels.join(", ")})`);

    const broken = await history(state.flows.broken);
    const brokenLabels = broken.items.filter((event) => event.entity === "operation").map((event) => event.entityLabel);
    assert.ok(brokenLabels.includes("Bad Slack"));
    for (const label of ["Discord", "Slack", "Teams"]) assert.ok(!brokenLabels.includes(label));
  });

  it("shows before and after for a change", async () => {
    const result = await history(state.flows.notify);
    const slackEdit = result.items.find((event) => event.entityLabel === "Slack" && event.action === "update");
    const detail = await admin.ok("GET", `/flow-version-history/history/${slackEdit.id}`);
    const text = detail.changes.find((change) => change.path === "options.text");
    assert.equal(text.before, "Order {{$trigger.query.order}} on Slack");
    assert.equal(text.after, "Order {{$trigger.query.order}} on Slack!");
  });

  it("never exposes webhook secrets in history", async () => {
    const result = await history(state.flows.notify);
    for (const event of result.items) {
      const detail = await admin.ok("GET", `/flow-version-history/history/${event.id}`);
      const text = JSON.stringify(detail);
      assert.ok(!text.includes(state.seed.slackWebhook), `event ${event.id} leaks the Slack webhook`);
      assert.ok(!text.includes(state.seed.discordWebhook), `event ${event.id} leaks the Discord webhook`);
    }
  });

  it("rejects a missing flow id", async () => {
    const response = await admin.get("/flow-version-history/history");
    assert.equal(response.status, 400);
  });
});
