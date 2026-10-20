import { test } from "node:test";
import assert from "node:assert/strict";
import {
    SLACK_POST_MESSAGE_URL,
    buildBuilderBlocks,
    buildMentions,
    buildSlackRequest,
    clean,
    parseJsonOption,
    parseRawBlocks,
} from "./payload.js";

const WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/secret";
const TOKEN = "xoxb-secret-token";

const webhookOptions = (overrides = {}) => ({
    integrationMethod: "webhook",
    webhookUrl: WEBHOOK_URL,
    text: "Hello",
    ...overrides,
});

const botOptions = (overrides = {}) => ({
    integrationMethod: "bot",
    token: TOKEN,
    channel: "C0123456789",
    text: "Hello",
    ...overrides,
});

test("clean trims strings and drops empty values", () => {
    assert.equal(clean("  hi  "), "hi");
    assert.equal(clean("   "), undefined);
    assert.equal(clean(null), undefined);
    assert.equal(clean(42), "42");
});

test("parseJsonOption parses strings, passes through objects and reports invalid JSON", () => {
    assert.deepEqual(parseJsonOption('[{"a":1}]', "X"), [{ a: 1 }]);
    assert.deepEqual(parseJsonOption([1], "X"), [1]);
    assert.equal(parseJsonOption("  ", "X"), undefined);
    assert.throws(() => parseJsonOption("{nope", "X"), /X is not valid JSON/);
});

test("webhook payload contains trimmed text only and targets the webhook URL", () => {
    const request = buildSlackRequest(webhookOptions({ text: "  Hello *world*  ", webhookUrl: ` ${WEBHOOK_URL} ` }));
    assert.equal(request.integrationMethod, "webhook");
    assert.equal(request.url, WEBHOOK_URL);
    assert.deepEqual(request.payload, { text: "Hello *world*" });
    assert.equal(request.headers.Authorization, undefined);
});

test("webhook mode ignores bot-only options", () => {
    const request = buildSlackRequest(
        webhookOptions({ threadTs: "123.456", username: "Bot", iconEmoji: "robot_face", channel: "C1" })
    );
    assert.deepEqual(request.payload, { text: "Hello" });
});

test("integration method defaults to webhook", () => {
    const request = buildSlackRequest({ webhookUrl: WEBHOOK_URL, text: "Hi" });
    assert.equal(request.integrationMethod, "webhook");
});

test("webhook mode validates the URL without leaking it", () => {
    assert.throws(() => buildSlackRequest(webhookOptions({ webhookUrl: "" })), /Webhook URL is required/);
    assert.throws(
        () => buildSlackRequest(webhookOptions({ webhookUrl: "https://evil.example.com/secret-value" })),
        (error) => /Invalid webhook URL format/.test(error.message) && !error.message.includes("secret-value")
    );
});

test("bot payload includes channel, bearer token and chat.postMessage URL", () => {
    const request = buildSlackRequest(botOptions({ token: `  ${TOKEN} `, channel: " #general " }));
    assert.equal(request.url, SLACK_POST_MESSAGE_URL);
    assert.equal(request.headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(request.payload, { channel: "#general", text: "Hello" });
});

test("bot mode requires token and channel", () => {
    assert.throws(() => buildSlackRequest(botOptions({ token: " " })), /Bot token is required/);
    assert.throws(() => buildSlackRequest(botOptions({ channel: "" })), /Channel ID or name is required/);
});

test("bot payload supports thread_ts, reply_broadcast, username and icon_emoji", () => {
    const request = buildSlackRequest(
        botOptions({ threadTs: " 1700000000.123456 ", replyBroadcast: true, username: "Directus", iconEmoji: "robot_face" })
    );
    assert.equal(request.payload.thread_ts, "1700000000.123456");
    assert.equal(request.payload.reply_broadcast, true);
    assert.equal(request.payload.username, "Directus");
    assert.equal(request.payload.icon_emoji, ":robot_face:");
});

test("reply_broadcast is omitted without thread_ts and empty thread_ts is dropped", () => {
    const request = buildSlackRequest(botOptions({ threadTs: "  ", replyBroadcast: true }));
    assert.equal(request.payload.thread_ts, undefined);
    assert.equal(request.payload.reply_broadcast, undefined);
});

test("message text is required", () => {
    assert.throws(() => buildSlackRequest(webhookOptions({ text: "  " })), /Message text is required/);
});

test("invalid integration method is rejected", () => {
    assert.throws(() => buildSlackRequest(webhookOptions({ integrationMethod: "email" })), /integrationMethod/);
});

test("buildMentions renders user ids, @here and @channel", () => {
    assert.equal(
        buildMentions({ mentionUsers: ["U012ABC", "@W999", "<@U777>"], mentionHere: true, mentionChannel: "true" }),
        "<!channel> <!here> <@U012ABC> <@W999> <@U777>"
    );
    assert.equal(buildMentions({ mentionUsers: "U1A, U2B  U1A" }), "<@U1A> <@U2B>");
    assert.equal(buildMentions({ mentionUsers: '["U1A"]' }), "<@U1A>");
    assert.equal(buildMentions({}), "");
});

test("buildMentions rejects malformed user ids", () => {
    assert.throws(() => buildMentions({ mentionUsers: ["john"] }), /Invalid Slack user ID "john"/);
});

test("mentions are prefixed to the fallback text", () => {
    const request = buildSlackRequest(webhookOptions({ mentionUsers: ["U1A"], mentionHere: true }));
    assert.equal(request.payload.text, "<!here> <@U1A> Hello");
});

test("block builder builds header, section with fields and a button", () => {
    const blocks = buildBuilderBlocks({
        headerText: " Deploy ",
        sectionText: "Status *green*",
        fields: [{ title: "Env", value: "prod" }, "plain", { title: "", value: "" }],
        buttonText: "View",
        buttonUrl: "https://example.com",
    });

    assert.deepEqual(blocks, [
        { type: "header", text: { type: "plain_text", text: "Deploy", emoji: true } },
        {
            type: "section",
            text: { type: "mrkdwn", text: "Status *green*" },
            fields: [
                { type: "mrkdwn", text: "*Env*\nprod" },
                { type: "mrkdwn", text: "plain" },
            ],
        },
        {
            type: "actions",
            elements: [
                { type: "button", text: { type: "plain_text", text: "View", emoji: true }, url: "https://example.com" },
            ],
        },
    ]);
});

test("block builder accepts fields as a JSON string and defaults the button label", () => {
    const blocks = buildBuilderBlocks({ fields: '[{"title":"A","value":"1"}]', buttonUrl: "http://x.test" });
    assert.deepEqual(blocks[0].fields, [{ type: "mrkdwn", text: "*A*\n1" }]);
    assert.equal(blocks[0].text, undefined);
    assert.equal(blocks[1].elements[0].text.text, "Open");
});

test("block builder validates input", () => {
    assert.throws(() => buildBuilderBlocks({}), /needs at least/);
    assert.throws(() => buildBuilderBlocks({ headerText: "x".repeat(151) }), /150 characters/);
    assert.throws(() => buildBuilderBlocks({ buttonUrl: "javascript:alert(1)" }), /Button URL/);
    assert.throws(() => buildBuilderBlocks({ fields: { a: 1 } }), /Fields must be a list/);
    assert.throws(
        () => buildBuilderBlocks({ fields: Array.from({ length: 11 }, (_, i) => `f${i}`) }),
        /at most 10 fields/
    );
});

test("builder mode sends blocks plus fallback text, mentions block on top", () => {
    const request = buildSlackRequest(
        botOptions({ blocksMode: "builder", sectionText: "Body", mentionChannel: true })
    );
    assert.equal(request.payload.text, "<!channel> Hello");
    assert.deepEqual(request.payload.blocks, [
        { type: "section", text: { type: "mrkdwn", text: "<!channel>" } },
        { type: "section", text: { type: "mrkdwn", text: "Body" } },
    ]);
});

test("parseRawBlocks accepts arrays and JSON strings", () => {
    const blocks = [{ type: "divider" }];
    assert.deepEqual(parseRawBlocks(blocks), blocks);
    assert.deepEqual(parseRawBlocks(' [{"type":"divider"}] '), blocks);
});

test("parseRawBlocks validates shape", () => {
    assert.throws(() => parseRawBlocks(""), /Blocks JSON is required/);
    assert.throws(() => parseRawBlocks("{oops"), /Blocks JSON is not valid JSON/);
    assert.throws(() => parseRawBlocks('{"blocks":[]}'), /must be an array/);
    assert.throws(() => parseRawBlocks("[]"), /at least one block/);
    assert.throws(() => parseRawBlocks([{ text: "no type" }]), /index 0/);
    assert.throws(() => parseRawBlocks(Array(51).fill({ type: "divider" })), /at most 50 blocks/);
});

test("raw mode sends parsed blocks and plain mode sends none", () => {
    const raw = buildSlackRequest(webhookOptions({ blocksMode: "raw", rawBlocks: '[{"type":"divider"}]' }));
    assert.deepEqual(raw.payload, { text: "Hello", blocks: [{ type: "divider" }] });

    const plain = buildSlackRequest(webhookOptions({ blocksMode: "none", rawBlocks: "[{}]" }));
    assert.equal(plain.payload.blocks, undefined);
});

test("unknown blocks mode is rejected", () => {
    assert.throws(() => buildSlackRequest(webhookOptions({ blocksMode: "fancy" })), /blocksMode/);
});
