import { test } from "node:test";
import assert from "node:assert/strict";
import app from "./app.js";

// Option keys saved by existing flows; they must never be renamed or removed
const SAVED_KEYS = [
    "webhookUrl",
    "messageType",
    "title",
    "style",
    "text",
    "facts",
    "imageUrl",
    "imageAlt",
    "actions",
    "cardJson",
    "mentions",
    "fullWidth",
];

const DEFAULT_VISIBLE = ["webhookUrl", "title", "text", "show_more_options"];

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

test("only the webhook URL, title and message are visible by default", () => {
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

test("overview is short and never shows the webhook URL", () => {
    const lines = app.overview({ webhookUrl: "https://x.powerplatform.com/?sig=SECRET", title: "T", text: "M" });
    assert.ok(lines.length <= 3);
    assert.ok(!JSON.stringify(lines).includes("SECRET"));
    assert.deepEqual(lines, [
        { label: "Title", text: "T" },
        { label: "Message", text: "M" },
    ]);
    assert.ok(app.overview({}).length <= 3);
});
