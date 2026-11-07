import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clients } from "./support/client.mjs";
import { findSaveEnd, previousSaveEnd, saveEvents, saveSize, withStepNames } from "../../packages/directus-extension-flow-version-history/src/shared/change-text.js";

const { state, admin, editor } = clients();
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

  it("draws a save as one version, even when it moves a step onto the spot of a deleted one", async () => {
    // Build: trigger -> Discord -> Slack (below) and Teams on the right, then do ONE edit in the flow
    // editor: move Slack into Teams' place and delete Teams. Directus records that as several events.
    const flow = await admin.ok("POST", "/flows", { name: "Layout flow", status: "active", trigger: "manual", options: { collections: ["articles"] } });
    const teams = await admin.ok("POST", "/operations", { flow: flow.id, name: "Teams", key: "teams", type: "log", position_x: 37, position_y: 1, options: { message: "t" } });
    const slack = await admin.ok("POST", "/operations", { flow: flow.id, name: "Slack", key: "slack", type: "log", position_x: 19, position_y: 26, options: { message: "s" } });
    const discord = await admin.ok("POST", "/operations", { flow: flow.id, name: "Discord", key: "discord", type: "log", position_x: 19, position_y: 1, options: { message: "d" } });
    await admin.ok("PATCH", `/operations/${discord.id}`, { resolve: slack.id }); // the flow editor links steps like this
    await admin.ok("PATCH", `/flows/${flow.id}`, { operation: discord.id });
    await new Promise((resolve) => setTimeout(resolve, 6500)); // the Save below must be a separate save

    await admin.ok("PATCH", `/operations/${slack.id}`, { position_x: 37, position_y: 1 });
    await admin.ok("PATCH", `/operations/${discord.id}`, { options: { message: "d2" } });
    await admin.ok("DELETE", `/operations/${teams.id}`);
    await admin.ok("PATCH", `/flows/${flow.id}`, { name: "Layout flow v2" });

    const { items } = await history(flow.id);
    const events = withStepNames(items);
    assert.ok(events.filter((event) => event.entity === "operation").every((event) => event.stepType === "log"), "steps say what kind of card they are, even a removed one");
    const discordEdit = events.find((event) => event.entity === "operation" && event.action === "update" && event.entityLabel === "Discord");
    assert.ok(discordEdit, "the Discord edit is in the history");

    // The save holds four changes; asking about any of them gives the last one.
    const end = findSaveEnd(events, discordEdit.id);
    assert.notEqual(end, discordEdit.id, "the Discord edit is not the end of its save");
    assert.equal(saveSize(events, discordEdit.id), 4);

    const draw = async (id) => (await admin.ok("GET", `/flow-version-history/history/${id}`)).graph.panels;
    const spots = (panels) => panels.filter((panel) => panel.kind === "operation").map((panel) => `${panel.x},${panel.y}`);

    // At the end of the save: Teams is gone, Slack sits in its old place, nothing overlaps.
    const after = await draw(end);
    assert.deepEqual(after.filter((panel) => panel.kind === "operation").map((panel) => panel.name).sort(), ["Discord", "Slack"]);
    assert.equal(new Set(spots(after)).size, spots(after).length, "no two cards share a spot");
    assert.equal(after.find((panel) => panel.name === "Slack").x, 37);

    // Halfway through the save the picture is a state nobody ever saw: both cards on the same spot.
    const halfway = await draw(discordEdit.id);
    assert.ok(new Set(spots(halfway)).size < spots(halfway).length, "the in-between state does overlap");

    // "Before" for that save is the version before it: Teams still exists, Slack is in its original place.
    const beforeId = previousSaveEnd(events, discordEdit.id);
    assert.ok(beforeId, "there is a version before the save");
    const before = await draw(beforeId);
    assert.deepEqual(before.filter((panel) => panel.kind === "operation").map((panel) => panel.name).sort(), ["Discord", "Slack", "Teams"]);
    assert.deepEqual([before.find((panel) => panel.name === "Slack").x, before.find((panel) => panel.name === "Slack").y], [19, 26]);
    assert.deepEqual([before.find((panel) => panel.name === "Teams").x, before.find((panel) => panel.name === "Teams").y], [37, 1]);
    assert.equal(new Set(spots(before)).size, spots(before).length, "the earlier version does not overlap either");

    // The save touched Teams (removed), Slack (moved) and Discord (changed) - those are what gets highlighted.
    const touched = new Set(saveEvents(events, discordEdit.id).filter((event) => event.entity === "operation").map((event) => event.entityLabel));
    assert.deepEqual([...touched].sort(), ["Discord", "Slack", "Teams"]);

    // The removed step shows its name, not an id.
    const removed = events.find((event) => event.action === "delete" && event.entity === "operation");
    assert.equal(removed.entityLabel, "Teams");

    // Restoring the earlier version brings Teams back (same id), puts Slack and the settings back, and keeps the wiring.
    await admin.ok("POST", `/flow-version-history/restore/${beforeId}`, { flowId: flow.id });
    const live = await admin.ok("GET", `/flows/${flow.id}?fields=name,operation,operations.id,operations.name,operations.position_x,operations.position_y,operations.resolve,operations.options`);
    assert.equal(live.name, "Layout flow");
    assert.equal(live.operation, discord.id);
    const byName = Object.fromEntries(live.operations.map((operation) => [operation.name, operation]));
    assert.deepEqual(Object.keys(byName).sort(), ["Discord", "Slack", "Teams"]);
    assert.equal(byName.Teams.id, teams.id);
    assert.deepEqual([byName.Slack.position_x, byName.Slack.position_y], [19, 26]);
    assert.equal(byName.Discord.resolve, slack.id);
    assert.equal(byName.Discord.options.message, "d");
    // ...and the restore is itself a version in the history.
    const afterRestore = (await history(flow.id)).items;
    assert.ok(afterRestore.length > items.length);
    assert.ok(afterRestore.slice(0, afterRestore.length - items.length).every((event) => event.comment?.startsWith("Reverted to the version from")), "the restore is marked as a revert");
    assert.ok(items.every((event) => !event.comment), "earlier changes are not marked");
  });

  it("only administrators can restore", async () => {
    const denied = await editor.post("/flow-version-history/restore/1", { flowId: "00000000-0000-4000-8000-000000000000" });
    assert.equal(denied.status, 403);
  });
});
