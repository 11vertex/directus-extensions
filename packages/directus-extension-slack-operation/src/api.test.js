import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import api from "./api.js";

const WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/webhook-secret";
const TOKEN = "xoxb-token-secret";
const originalFetch = globalThis.fetch;

/**
 * Replaces global fetch with a stub that records calls and returns `response`
 */
const mockFetch = (response) => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        if (response instanceof Error) throw response;
        return response;
    };
    return calls;
};

const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const assertNoSecrets = (error) => {
    assert.ok(!error.message.includes("webhook-secret"), "webhook URL leaked");
    assert.ok(!error.message.includes(TOKEN), "token leaked");
    return true;
};

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("exports the operation id", () => {
    assert.equal(api.id, "slack");
});

test("webhook mode posts JSON and returns { ok: true }", async () => {
    const calls = mockFetch(new Response("ok", { status: 200 }));
    const result = await api.handler({ integrationMethod: "webhook", webhookUrl: WEBHOOK_URL, text: " Hi " });

    assert.deepEqual(result, { ok: true, integrationMethod: "webhook" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, WEBHOOK_URL);
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(calls[0].body, { text: "Hi" });
});

test("show_more_options is ignored by the API", async () => {
    const options = { webhookUrl: WEBHOOK_URL, text: "Hi", mentionHere: true };
    const without = mockFetch(new Response("ok", { status: 200 }));
    const resultWithout = await api.handler(options);
    const withFlag = mockFetch(new Response("ok", { status: 200 }));
    const resultWith = await api.handler({ ...options, show_more_options: true });

    assert.deepEqual(resultWith, resultWithout);
    assert.equal(withFlag[0].url, without[0].url);
    assert.deepEqual(withFlag[0].body, without[0].body);
    assert.deepEqual(withFlag[0].body, { text: "<!here> Hi" });
});

test("webhook non-2xx responses surface Slack's error code without the URL", async () => {
    mockFetch(new Response("invalid_token", { status: 403, statusText: "Forbidden" }));
    await assert.rejects(
        api.handler({ integrationMethod: "webhook", webhookUrl: WEBHOOK_URL, text: "Hi" }),
        (error) =>
            /Failed to send Slack message: Slack API Error \(HTTP 403\): invalid_token/.test(error.message) &&
            assertNoSecrets(error)
    );
});

test("bot mode calls chat.postMessage and returns ts and channel", async () => {
    const calls = mockFetch(
        jsonResponse({ ok: true, channel: "C0123", ts: "1700000000.000100", message: { thread_ts: "1699.1" } })
    );
    const result = await api.handler({
        integrationMethod: "bot",
        token: TOKEN,
        channel: "#general",
        text: "Reply",
        threadTs: "1699.1",
    });

    assert.deepEqual(result, {
        ok: true,
        integrationMethod: "bot",
        ts: "1700000000.000100",
        channel: "C0123",
        threadTs: "1699.1",
    });
    assert.equal(calls[0].url, "https://slack.com/api/chat.postMessage");
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(calls[0].body, { channel: "#general", text: "Reply", thread_ts: "1699.1" });
});

test("bot mode treats HTTP 200 with ok:false as a failure", async () => {
    mockFetch(jsonResponse({ ok: false, error: "channel_not_found" }));
    await assert.rejects(
        api.handler({ integrationMethod: "bot", token: TOKEN, channel: "C1", text: "Hi" }),
        (error) => /Slack API Error: channel_not_found/.test(error.message) && assertNoSecrets(error)
    );
});

test("bot mode non-2xx responses are failures", async () => {
    mockFetch(jsonResponse({ ok: false, error: "ratelimited" }, 429));
    await assert.rejects(
        api.handler({ integrationMethod: "bot", token: TOKEN, channel: "C1", text: "Hi" }),
        /HTTP 429\): ratelimited/
    );
});

test("network errors are reported without request details", async () => {
    mockFetch(new TypeError(`fetch failed for ${WEBHOOK_URL}`));
    await assert.rejects(
        api.handler({ integrationMethod: "webhook", webhookUrl: WEBHOOK_URL, text: "Hi" }),
        (error) => /Network error: Failed to connect to Slack/.test(error.message) && assertNoSecrets(error)
    );
});

test("validation errors happen before any request", async () => {
    const calls = mockFetch(jsonResponse({ ok: true }));
    await assert.rejects(api.handler({ integrationMethod: "bot", channel: "C1", text: "Hi" }), /Bot token is required/);
    await assert.rejects(
        api.handler({ integrationMethod: "webhook", webhookUrl: WEBHOOK_URL, text: "Hi", blocksMode: "raw", rawBlocks: "{" }),
        /Blocks JSON is not valid JSON/
    );
    assert.equal(calls.length, 0);
});
