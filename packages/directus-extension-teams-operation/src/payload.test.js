import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import api from "./api.js";
import {
    CARD_CONTENT_TYPE,
    CARD_SCHEMA,
    CARD_VERSION,
    MAX_ACTIONS,
    buildCard,
    buildPayload,
    detectEndpoint,
    normalizeActions,
    normalizeFacts,
    normalizeMentions,
    parseJsonOption,
    parseRawCard,
    wrapCard,
} from "./payload.js";

const WORKFLOWS_URL =
    "https://default123.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=SECRET_SIG";
const LEGACY_URL = "https://contoso.webhook.office.com/webhookb2/abc/IncomingWebhook/def/SECRET_SIG";

describe("parseJsonOption", () => {
    test("parses strings, passes objects through, ignores empty", () => {
        assert.deepEqual(parseJsonOption(' [{"a":1}] ', "X"), [{ a: 1 }]);
        assert.deepEqual(parseJsonOption({ a: 1 }, "X"), { a: 1 });
        assert.equal(parseJsonOption("   ", "X"), undefined);
        assert.equal(parseJsonOption(null, "X"), undefined);
    });

    test("throws a labelled error on invalid JSON", () => {
        assert.throws(() => parseJsonOption("{nope", "Facts"), /Facts is not valid JSON/);
    });
});

describe("buildCard", () => {
    test("builds title, text, facts, image and actions", () => {
        const card = buildCard({
            title: "  Article published ",
            text: " **Hello** world ",
            style: "good",
            facts: '[{"title":"Status","value":"published"},{"name":"Views","value":42}]',
            imageUrl: "https://example.com/a.png",
            imageAlt: "Cover",
            actions: [{ title: "Open", url: "https://example.com/item/1" }],
        });

        assert.equal(card.$schema, CARD_SCHEMA);
        assert.equal(card.type, "AdaptiveCard");
        assert.equal(card.version, CARD_VERSION);
        assert.deepEqual(card.body, [
            {
                type: "Container",
                style: "good",
                bleed: true,
                items: [{ type: "TextBlock", text: "Article published", size: "Large", weight: "Bolder", wrap: true }],
            },
            { type: "TextBlock", text: "**Hello** world", wrap: true },
            {
                type: "FactSet",
                facts: [
                    { title: "Status", value: "published" },
                    { title: "Views", value: "42" },
                ],
            },
            { type: "Image", url: "https://example.com/a.png", size: "Stretch", altText: "Cover" },
        ]);
        assert.deepEqual(card.actions, [{ type: "Action.OpenUrl", title: "Open", url: "https://example.com/item/1" }]);
        assert.equal(card.msteams, undefined);
    });

    test("default style renders a plain heading", () => {
        const card = buildCard({ title: "Hi" });
        assert.deepEqual(card.body, [{ type: "TextBlock", text: "Hi", size: "Large", weight: "Bolder", wrap: true }]);
        assert.equal(card.actions, undefined);
    });

    test("accepts facts as a key/value object", () => {
        assert.deepEqual(normalizeFacts({ Status: "draft", Meta: { a: 1 } }), [
            { title: "Status", value: "draft" },
            { title: "Meta", value: '{"a":1}' },
        ]);
    });

    test("rejects empty cards, bad styles, bad images and bad facts", () => {
        assert.throws(() => buildCard({ title: "  " }), /at least a title, text or facts/);
        assert.throws(() => buildCard({ title: "x", style: "purple" }), /Style must be one of/);
        assert.throws(() => buildCard({ title: "x", imageUrl: "not a url" }), /Image URL/);
        assert.throws(() => normalizeFacts('[{"value":"x"}]'), /Facts\[0\] needs a "title"/);
        assert.throws(() => normalizeFacts('"x"'), /Facts must be/);
    });

    test("full width sets msteams.width", () => {
        assert.deepEqual(buildCard({ text: "x", fullWidth: true }).msteams, { width: "Full" });
    });
});

describe("mentions", () => {
    test("builds msteams mention entities", () => {
        assert.deepEqual(normalizeMentions('[{"id":" jane@contoso.com ","name":"Jane Doe"}]'), [
            { type: "mention", text: "<at>Jane Doe</at>", mentioned: { id: "jane@contoso.com", name: "Jane Doe" } },
        ]);
    });

    test("builder keeps tags already in text and appends missing ones", () => {
        const card = buildCard({
            text: "Review needed <at>Jane Doe</at>",
            mentions: [
                { id: "jane@contoso.com", name: "Jane Doe" },
                { id: "00000000-0000-0000-0000-000000000001", name: "Bob" },
            ],
        });

        assert.deepEqual(card.body, [
            { type: "TextBlock", text: "Review needed <at>Jane Doe</at>", wrap: true },
            { type: "TextBlock", text: "<at>Bob</at>", wrap: true },
        ]);
        assert.equal(card.msteams.entities.length, 2);
        assert.equal(card.msteams.entities[1].mentioned.id, "00000000-0000-0000-0000-000000000001");
    });

    test("rejects mentions without id or name", () => {
        assert.throws(() => normalizeMentions([{ name: "Jane" }]), /needs an "id"/);
        assert.throws(() => normalizeMentions([{ id: "jane@contoso.com" }]), /needs a "name"/);
        assert.throws(() => normalizeMentions({ id: "x" }), /must be a JSON array/);
    });
});

describe("actions", () => {
    test("validates title, url and count", () => {
        assert.throws(() => normalizeActions([{ url: "https://x.dev" }]), /needs a "title"/);
        assert.throws(() => normalizeActions([{ title: "x", url: "javascript:alert(1)" }]), /valid http\(s\) "url"/);
        const tooMany = Array.from({ length: MAX_ACTIONS + 1 }, (_, i) => ({ title: `b${i}`, url: "https://x.dev" }));
        assert.throws(() => normalizeActions(tooMany), /At most 5 action buttons/);
        assert.throws(() => normalizeActions('{"title":"x"}'), /must be a JSON array/);
    });
});

describe("parseRawCard", () => {
    const raw = { type: "AdaptiveCard", body: [{ type: "TextBlock", text: "Hi <at>Jane</at>" }] };

    test("fills $schema and version, keeps user values", () => {
        const card = parseRawCard(JSON.stringify(raw));
        assert.equal(card.$schema, CARD_SCHEMA);
        assert.equal(card.version, CARD_VERSION);
        assert.equal(parseRawCard({ ...raw, version: "1.5" }).version, "1.5");
    });

    test("unwraps a full message envelope", () => {
        assert.deepEqual(parseRawCard(wrapCard(raw)).body, raw.body);
    });

    test("merges mentions into existing msteams entities", () => {
        const existing = { type: "mention", text: "<at>Bob</at>", mentioned: { id: "bob", name: "Bob" } };
        const card = parseRawCard(
            { ...raw, msteams: { entities: [existing] } },
            { mentions: [{ id: "jane@contoso.com", name: "Jane" }], fullWidth: true }
        );
        assert.equal(card.msteams.width, "Full");
        assert.deepEqual(
            card.msteams.entities.map((entity) => entity.mentioned.id),
            ["bob", "jane@contoso.com"]
        );
    });

    test("rejects invalid cards", () => {
        assert.throws(() => parseRawCard(""), /required in raw mode/);
        assert.throws(() => parseRawCard("{bad"), /not valid JSON/);
        assert.throws(() => parseRawCard({ type: "MessageCard" }), /"type": "AdaptiveCard"/);
        assert.throws(() => parseRawCard([raw]), /"type": "AdaptiveCard"/);
        assert.throws(() => parseRawCard({ type: "AdaptiveCard", body: {} }), /"body" must be an array/);
        assert.throws(() => parseRawCard({ type: "AdaptiveCard", actions: "x" }), /"actions" must be an array/);
    });
});

describe("envelope", () => {
    test("wraps the card in a Teams message", () => {
        const payload = buildPayload({ title: "Hi" });
        assert.equal(payload.type, "message");
        assert.equal(payload.attachments.length, 1);
        assert.equal(payload.attachments[0].contentType, CARD_CONTENT_TYPE);
        assert.equal(payload.attachments[0].contentUrl, null);
        assert.equal(payload.attachments[0].content.type, "AdaptiveCard");
    });

    test("raw mode and invalid message type", () => {
        const payload = buildPayload({ messageType: "raw", cardJson: '{"type":"AdaptiveCard","body":[]}' });
        assert.deepEqual(payload.attachments[0].content.body, []);
        assert.throws(() => buildPayload({ messageType: "html" }), /either 'card' or 'raw'/);
    });

    test("detects endpoint kinds", () => {
        assert.equal(detectEndpoint(WORKFLOWS_URL), "workflows");
        assert.equal(detectEndpoint("https://prod-01.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke"), "workflows");
        assert.equal(detectEndpoint(LEGACY_URL), "legacy");
        assert.equal(detectEndpoint("https://example.com/hook"), "unknown");
    });
});

describe("handler", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    const mockFetch = (response) => {
        const calls = [];
        globalThis.fetch = async (url, init) => {
            calls.push({ url, init });
            if (response instanceof Error) throw response;
            return response;
        };
        return calls;
    };

    test("posts the envelope and returns ok/status", async () => {
        const calls = mockFetch(new Response(null, { status: 202 }));

        const result = await api.handler({ webhookUrl: ` ${WORKFLOWS_URL} `, title: "Hi", text: "There" }, {});

        assert.equal(result.ok, true);
        assert.equal(result.status, 202);
        assert.equal(result.endpoint, "workflows");
        assert.equal(result.type, "card");
        assert.ok(!JSON.stringify(result).includes("SECRET_SIG"));

        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, WORKFLOWS_URL);
        assert.equal(calls[0].init.method, "POST");
        assert.equal(calls[0].init.headers["Content-Type"], "application/json");
        const body = JSON.parse(calls[0].init.body);
        assert.equal(body.type, "message");
        assert.equal(body.attachments[0].content.body[1].text, "There");
    });

    test("ignores show_more_options", async () => {
        const options = { webhookUrl: WORKFLOWS_URL, title: "Hi", text: "There", style: "good" };
        const without = mockFetch(new Response(null, { status: 202 }));
        const resultWithout = await api.handler(options, {});
        const withFlag = mockFetch(new Response(null, { status: 202 }));
        const resultWith = await api.handler({ ...options, show_more_options: true }, {});

        assert.equal(withFlag[0].init.body, without[0].init.body);
        assert.deepEqual({ ...resultWith, timestamp: null }, { ...resultWithout, timestamp: null });
        assert.deepEqual(buildPayload({ ...options, show_more_options: false }), buildPayload(options));
    });

    test("warns on legacy webhook URLs without logging the URL", async () => {
        mockFetch(new Response("1", { status: 200 }));
        const warnings = [];
        const logger = { warn: (message) => warnings.push(message) };

        const result = await api.handler({ webhookUrl: LEGACY_URL, text: "x" }, { logger });

        assert.equal(result.endpoint, "legacy");
        assert.equal(warnings.length, 1);
        assert.ok(!warnings[0].includes("SECRET_SIG"));
    });

    test("fails on missing or non-https URL before calling fetch", async () => {
        const calls = mockFetch(new Response(null, { status: 202 }));
        await assert.rejects(api.handler({ webhookUrl: "  ", text: "x" }, {}), /Webhook URL is required/);
        await assert.rejects(api.handler({ webhookUrl: "http://example.com", text: "x" }, {}), /must use https/);
        await assert.rejects(api.handler({ webhookUrl: "nope", text: "x" }, {}), /not a valid URL/);
        assert.equal(calls.length, 0);
    });

    test("fails on invalid JSON options", async () => {
        mockFetch(new Response(null, { status: 202 }));
        await assert.rejects(
            api.handler({ webhookUrl: WORKFLOWS_URL, messageType: "raw", cardJson: "{oops" }, {}),
            /Failed to send Teams message: Adaptive Card JSON is not valid JSON/
        );
    });

    test("rejects payloads over the size limit", async () => {
        const calls = mockFetch(new Response(null, { status: 202 }));
        await assert.rejects(
            api.handler({ webhookUrl: WORKFLOWS_URL, text: "x".repeat(30 * 1024) }, {}),
            /Teams accepts at most 28 KB/
        );
        assert.equal(calls.length, 0);
    });

    test("non-2xx includes truncated, redacted response text", async () => {
        const longText = `bad request for ${WORKFLOWS_URL} ${"y".repeat(1000)}`;
        mockFetch(new Response(longText, { status: 400, statusText: "Bad Request" }));

        const error = await api.handler({ webhookUrl: WORKFLOWS_URL, text: "x" }, {}).catch((err) => err);

        assert.match(error.message, /Teams webhook responded with 400 Bad Request: bad request for \[redacted\]/);
        assert.ok(!error.message.includes("SECRET_SIG"));
        assert.ok(error.message.length < 700);
    });

    test("network errors do not leak the URL", async () => {
        const failure = new TypeError(`fetch failed ${WORKFLOWS_URL}`, { cause: { code: "ENOTFOUND" } });
        mockFetch(failure);

        const error = await api.handler({ webhookUrl: WORKFLOWS_URL, text: "x" }, {}).catch((err) => err);

        assert.match(error.message, /Network error: failed to reach the Teams webhook \(ENOTFOUND\)/);
        assert.ok(!error.message.includes("SECRET_SIG"));
    });
});
