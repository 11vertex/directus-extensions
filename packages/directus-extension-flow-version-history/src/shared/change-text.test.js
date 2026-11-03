import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changeSentence,
  changedFieldsText,
  displayValue,
  fieldDetailLabel,
  fieldLabel,
  meaningfulChanges,
  pickMostRecentFlow,
  relativeTime
} from "./change-text.js";

const OP_ID = "11111111-1111-4111-8111-111111111111";

describe("changeSentence", () => {
  const jane = { id: "u1", label: "Jane Doe" };

  it("describes step changes in plain words", () => {
    const event = { entity: "operation", action: "update", entityLabel: "Send email", actor: jane };
    assert.equal(changeSentence(event), "Jane Doe changed the step ‘Send email’");
    assert.equal(changeSentence({ ...event, action: "create" }), "Jane Doe added the step ‘Send email’");
    assert.equal(changeSentence({ ...event, action: "delete" }), "Jane Doe removed the step ‘Send email’");
  });

  it("describes flow changes and the current user", () => {
    const event = { entity: "flow", action: "create", entityLabel: "Notify", actor: jane };
    assert.equal(changeSentence(event), "Jane Doe created the flow");
    assert.equal(changeSentence(event, "u1"), "You created the flow");
    assert.equal(
      changeSentence({ ...event, action: "update", actor: { id: null, label: "System / unknown" } }),
      "Someone changed the flow settings"
    );
  });
});

describe("field labels", () => {
  it("turns paths into friendly labels", () => {
    assert.equal(fieldLabel("options.url"), "URL");
    assert.equal(fieldLabel("options.method"), "Method");
    assert.equal(fieldLabel("accountability"), "Activity & logs");
    assert.equal(fieldLabel("position_x"), "Position");
    assert.equal(fieldDetailLabel("options.headers.0.value"), "Headers › Value");
  });

  it("joins distinct labels into one short list", () => {
    assert.equal(changedFieldsText(["options.url", "options.method"]), "URL, method");
    assert.equal(changedFieldsText(["position_x", "position_y"]), "Position");
    assert.equal(changedFieldsText([]), "");
  });
});

describe("displayValue", () => {
  it("formats short and long values", () => {
    assert.deepEqual(displayValue(null), { text: "(empty)", long: false });
    assert.deepEqual(displayValue(true), { text: "Yes", long: false });
    assert.deepEqual(displayValue("POST"), { text: "POST", long: false });
    assert.equal(displayValue({ a: 1 }).long, true);
    assert.equal(displayValue("x".repeat(100)).long, true);
  });

  it("shows step names instead of ids for links", () => {
    assert.equal(displayValue(OP_ID, "resolve", { [OP_ID]: "Log" }).text, "‘Log’");
    assert.equal(displayValue(OP_ID, "reject", {}).text, "another step");
  });
});

describe("meaningfulChanges", () => {
  it("drops bookkeeping and empty-to-empty rows", () => {
    const rows = meaningfulChanges([
      { path: "id", before: "a", after: "b" },
      { path: "color", before: null, after: null },
      { path: "options.url", before: "a", after: "b" }
    ]);
    assert.deepEqual(rows.map((row) => row.path), ["options.url"]);
  });
});

describe("pickMostRecentFlow", () => {
  it("prefers the latest edit, falling back to creation date", () => {
    const flows = [
      { id: "a", lastEditedAt: "2026-07-01T00:00:00.000Z" },
      { id: "b", lastEditedAt: null, dateCreated: "2026-08-01T00:00:00.000Z" },
      { id: "c", lastEditedAt: "2026-07-15T00:00:00.000Z" }
    ];
    assert.equal(pickMostRecentFlow(flows).id, "b");
    assert.equal(pickMostRecentFlow([]), null);
  });
});

describe("relativeTime", () => {
  it("formats times relative to now", () => {
    const now = Date.parse("2026-10-21T12:00:00.000Z");
    assert.equal(relativeTime("2026-10-21T10:00:00.000Z", now), "2 hours ago");
    assert.equal(relativeTime("2026-10-18T12:00:00.000Z", now), "3 days ago");
  });
});
