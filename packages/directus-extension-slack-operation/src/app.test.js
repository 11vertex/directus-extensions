import { test } from "node:test";
import assert from "node:assert/strict";
import app from "./app.js";

// Option keys saved by existing flows; they must never be renamed or removed
const SAVED_KEYS = [
    "integrationMethod",
    "webhookUrl",
    "token",
    "channel",
    "text",
    "mentionUsers",
    "mentionHere",
    "mentionChannel",
    "blocksMode",
    "headerText",
    "sectionText",
    "fields",
    "buttonText",
    "buttonUrl",
    "rawBlocks",
    "threadTs",
    "replyBroadcast",
    "username",
    "iconEmoji",
];

const DEFAULT_VISIBLE = ["integrationMethod", "webhookUrl", "token", "channel", "text", "show_more_options"];

/** Collects every field name used in a filter rule (handles _and / _or) */
const ruleFields = (rule) =>
    Object.entries(rule).flatMap(([key, value]) =>
        key === "_and" || key === "_or" ? value.flatMap(ruleFields) : [key]
    );

const fields = app.options.map((option) => option.field);

test("option keys are unique and all saved keys still exist", () => {
    assert.equal(new Set(fields).size, fields.length);
    for (const key of SAVED_KEYS) assert.ok(fields.includes(key), `missing ${key}`);
});

test("conditions only reference existing fields and use one top-level key", () => {
    for (const option of app.options) {
        for (const condition of option.meta?.conditions ?? []) {
            assert.equal(Object.keys(condition.rule).length, 1, `${option.field}: rule needs exactly one top-level key`);
            for (const field of ruleFields(condition.rule)) {
                assert.ok(fields.includes(field), `${option.field} references unknown field ${field}`);
            }
        }
    }
});

test("only the connection and message are visible by default", () => {
    const hiddenByDefault = app.options.filter((option) => option.meta?.hidden === true).map((option) => option.field);
    assert.deepEqual(
        fields.filter((field) => !hiddenByDefault.includes(field)),
        DEFAULT_VISIBLE
    );
    for (const field of hiddenByDefault) {
        const option = app.options.find((item) => item.field === field);
        const rules = JSON.stringify(option.meta.conditions);
        assert.ok(rules.includes('"show_more_options":{"_eq":true}'), `${field} must be shown by More options`);
    }
});

test("overview is short and never shows the webhook URL or token", () => {
    const lines = app.overview({ webhookUrl: "https://hooks.slack.com/services/secret", token: "xoxb-secret", text: "Hi" });
    assert.ok(lines.length <= 3);
    assert.ok(!JSON.stringify(lines).includes("secret"));
    assert.deepEqual(app.overview({ integrationMethod: "bot", channel: "#alerts", text: "Hi" }), [
        { label: "Channel", text: "#alerts" },
        { label: "Message", text: "Hi" },
    ]);
});

test("Send with comes first so the connection fields below it make sense", () => {
    assert.equal(fields[0], "integrationMethod");
    assert.ok(fields.indexOf("integrationMethod") < fields.indexOf("webhookUrl"));
    assert.notEqual(app.options[0].meta?.hidden, true);
});
