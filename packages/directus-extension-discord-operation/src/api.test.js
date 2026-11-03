import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import api from "./api.js";

const WEBHOOK_URL = "https://discord.com/api/webhooks/123456/secret-token";
const CHANNEL_ID = "123456789012345678";
const originalFetch = globalThis.fetch;

const mockFetch = (body = { id: "m1", channel_id: CHANNEL_ID, timestamp: "2026-01-01T00:00:00.000Z" }) => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return new Response(JSON.stringify(body), { status: 200 });
    };
    return calls;
};

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("exports the operation id", () => {
    assert.equal(api.id, "discord");
});

test("saved webhook + simple options send the same request as before", async () => {
    const calls = mockFetch();
    const result = await api.handler({
        integrationMethod: "webhook",
        channelId: ` ${WEBHOOK_URL} `,
        messageType: "simple",
        message: " Hello ",
    });

    assert.equal(calls[0].url, `${WEBHOOK_URL}?wait=true`);
    assert.deepEqual(calls[0].body, { content: "Hello" });
    assert.equal(result.status, "success");
    assert.equal(result.type, "simple");
    assert.equal(result.integrationMethod, "webhook");
});

test("bot + embed options send an embed with the bot token", async () => {
    const calls = mockFetch();
    await api.handler({
        integrationMethod: "bot",
        channelId: CHANNEL_ID,
        token: "bot-token",
        messageType: "embed",
        embedTemplate: "success",
        embedTitle: "Title",
        embedDescription: "Body",
        embedFields: '[{"name":"A","value":"1"}]',
    });

    assert.equal(calls[0].url, `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`);
    assert.equal(calls[0].init.headers.Authorization, "Bot bot-token");
    assert.deepEqual(calls[0].body.embeds[0], {
        color: 5763719,
        footer: { text: "Success" },
        title: "Title",
        description: "Body",
        fields: [{ name: "A", value: "1" }],
    });
});

test("show_more_options is ignored by the API", async () => {
    const options = { integrationMethod: "webhook", channelId: WEBHOOK_URL, messageType: "simple", message: "Hi" };

    const without = mockFetch();
    const resultWithout = await api.handler(options);
    const withFlag = mockFetch();
    const resultWith = await api.handler({ ...options, show_more_options: true });

    assert.deepEqual(withFlag[0].body, without[0].body);
    assert.equal(withFlag[0].url, without[0].url);
    assert.deepEqual({ ...resultWith, timestamp: null }, { ...resultWithout, timestamp: null });
});

test("a minimal config (only the default fields) works: webhook + plain message", async () => {
    const calls = mockFetch();
    await api.handler({ channelId: WEBHOOK_URL, message: "Hi" });
    assert.deepEqual(calls[0].body, { content: "Hi" });
});

test("embed without a saved template falls back to the basic colour", async () => {
    const calls = mockFetch();
    await api.handler({ channelId: WEBHOOK_URL, messageType: "embed", embedTitle: "T", embedDescription: "D" });
    assert.equal(calls[0].body.embeds[0].color, 3447003);
});

test("validation still rejects invalid values", async () => {
    const calls = mockFetch();
    await assert.rejects(api.handler({ integrationMethod: "email", channelId: WEBHOOK_URL, message: "Hi" }), /integrationMethod/);
    await assert.rejects(api.handler({ channelId: "https://example.com/hook", message: "Hi" }), /Invalid webhook URL/);
    await assert.rejects(api.handler({ integrationMethod: "bot", channelId: CHANNEL_ID, message: "Hi" }), /Bot token is required/);
    await assert.rejects(api.handler({ channelId: WEBHOOK_URL, message: "  " }), /Message content is required/);
    assert.equal(calls.length, 0);
});
