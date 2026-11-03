import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capturedRequests, clients } from "./support/client.mjs";

// The seeded "Order notifications" flow (Discord -> Slack -> Teams) ran twice, with ?order=41 and ?order=42.
// Outgoing requests were caught by the test capture server, so nothing was sent to real services.
const { state, admin } = clients();
const sentTo = async (host) => (await capturedRequests(state)).filter((request) => new URL(request.url).hostname.endsWith(host));

describe("Discord operation", () => {
  it("posts the rendered message to the webhook", async () => {
    const requests = await sentTo("discord.com");
    assert.equal(requests.length, 2);
    assert.ok(requests[0].url.startsWith(state.seed.discordWebhook), requests[0].url);
    assert.equal(requests[0].method, "POST");
    assert.deepEqual(JSON.parse(requests[0].body), { content: "Order 41 placed" });
    assert.deepEqual(JSON.parse(requests[1].body), { content: "Order 42 placed" });
  });
});

describe("Slack operation", () => {
  it("posts the rendered message to the webhook", async () => {
    const requests = await sentTo("hooks.slack.com");
    assert.equal(requests.length, 2, "the failing flow's bad URL is never called");
    assert.equal(requests[0].url, state.seed.slackWebhook);
    assert.equal(JSON.parse(requests[0].body).text, "Order 41 on Slack!");
  });

  it("fails the step with a clear message for an invalid webhook URL", async () => {
    const runs = await admin.ok("GET", `/flow-debugger/executions?flowId=${state.flows.broken}`);
    const detail = await admin.ok("GET", `/flow-debugger/executions/${runs.items[0].id}`);
    const step = detail.steps.find((entry) => entry.key === "bad_slack");
    assert.equal(step.status, "reject");
    assert.match(JSON.stringify(step.result), /Invalid webhook URL/);
    assert.ok(!JSON.stringify(step.result).includes("example.com/not-slack"), "the URL is not echoed back");
  });
});

describe("Teams operation", () => {
  it("posts an Adaptive Card in the Workflows envelope", async () => {
    const requests = await sentTo("logic.azure.com");
    assert.equal(requests.length, 2);
    const payload = JSON.parse(requests[0].body);
    assert.equal(payload.type, "message");
    assert.equal(payload.attachments[0].contentType, "application/vnd.microsoft.card.adaptive");
    const card = payload.attachments[0].content;
    assert.equal(card.type, "AdaptiveCard");
    const text = JSON.stringify(card.body);
    assert.match(text, /New order/);
    assert.match(text, /Order 41 on Teams/);
  });
});

describe("message flow", () => {
  it("runs the three steps in order and passes each result on", async () => {
    const runs = await admin.ok("GET", `/flow-debugger/executions?flowId=${state.flows.notify}`);
    const detail = await admin.ok("GET", `/flow-debugger/executions/${runs.items[0].id}`);
    assert.deepEqual(
      detail.steps.map((step) => [step.key, step.status]),
      [
        ["discord_msg", "resolve"],
        ["slack_msg", "resolve"],
        ["teams_msg", "resolve"]
      ]
    );
  });
});
