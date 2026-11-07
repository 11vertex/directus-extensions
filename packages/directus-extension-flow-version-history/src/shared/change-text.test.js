import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actorTag,
  changeAction,
  changeBrief,
  changeSentence,
  changedFieldsText,
  dayLabel,
  displayValue,
  fieldDetailLabel,
  fieldLabel,
  findSaveEnd,
  isPlumbingOnly,
  groupEvents,
  groupHeadline,
  groupParts,
  groupStepTypes,
  isRevert,
  groupSummary,
  meaningfulChanges,
  pickMostRecentFlow,
  previousSaveEnd,
  relativeTime,
  saveEvents,
  saveSize,
  shortTime,
  withStepNames
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
    assert.equal(changedFieldsText(["position_x", "position_y"]), "connections and layout");
    assert.equal(changedFieldsText(["options.message", "flow"]), "Message");
    assert.equal(changedFieldsText(["position_x", "resolve", "flow"]), "connections and layout");
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

const at = (seconds) => new Date(Date.UTC(2026, 10, 3, 12, 0, 0) - seconds * 1000).toISOString();
const jane = { id: "u1", label: "Jane Doe" };
const step = (id, seconds, action, label, extra = {}) => ({
  id, timestamp: at(seconds), actor: jane, entity: "operation", action, entityLabel: label, ...extra
});

describe("changeAction", () => {
  it("describes a change without naming who made it", () => {
    assert.equal(changeAction(step(1, 0, "create", "Send email")), "Added the step ‘Send email’");
    assert.equal(changeAction({ entity: "flow", action: "update" }), "Changed the flow settings");
  });
});

describe("groupEvents", () => {
  it("puts quick saves by the same person into one editing session", () => {
    const events = [step(5, 0, "update", "A"), step(4, 2, "update", "B"), step(3, 30, "create", "C"), step(2, 600, "update", "D")];
    const groups = groupEvents(events);
    assert.deepEqual(groups.map((group) => group.events.map((event) => event.id)), [[5, 4, 3], [2]]);
    assert.equal(groups[0].key, "5");
  });

  it("starts a new session for a different person or a long pause", () => {
    const other = { ...step(2, 1, "update", "B"), actor: { id: "u2", label: "Sam" } };
    assert.equal(groupEvents([step(3, 0, "update", "A"), other]).length, 2);
    assert.equal(groupEvents([step(2, 0, "update", "A"), step(1, 120, "update", "B")]).length, 2);
    assert.deepEqual(groupEvents([]), []);
  });
});

describe("groupSummary", () => {
  it("keeps the normal sentence for a single change", () => {
    const group = groupEvents([step(1, 0, "update", "Send email")])[0];
    assert.deepEqual(groupSummary(group), { title: "Jane Doe changed the step ‘Send email’", parts: [] });
  });

  it("summarises a session in a few short parts (the Discord rewiring that plugged in the new step is not listed)", () => {
    const events = [
      { id: 6, timestamp: at(0), actor: jane, entity: "flow", action: "update", changedPaths: ["operation"] },
      step(5, 1, "update", "Send Discord Message", { changedPaths: ["resolve", "flow"] }),
      step(4, 2, "update", "Send Slack Message", { changedPaths: ["position_x"] }),
      step(3, 3, "create", "Send Teams Message")
    ];
    const summary = groupSummary(groupEvents(events)[0], "u1");
    assert.equal(summary.title, "You edited the flow");
    assert.deepEqual(summary.parts, [
      "Added ‘Send Teams Message’",
      "Rearranged ‘Send Slack Message’"
    ]);
  });

  it("shortens long lists and mentions real flow setting changes", () => {
    const events = [
      { id: 9, timestamp: at(0), actor: jane, entity: "flow", action: "update", changedPaths: ["name"] },
      step(8, 1, "update", "A"), step(7, 1, "update", "B"), step(6, 1, "update", "C"), step(5, 1, "update", "A")
    ];
    const { parts } = groupSummary(groupEvents(events)[0]);
    assert.deepEqual(parts, ["Changed ‘A’, ‘B’ and 1 more", "Updated the flow settings"]);
  });

  it("falls back to a plain line when only wiring changed", () => {
    const events = [
      { id: 2, timestamp: at(0), actor: jane, entity: "flow", action: "update", changedPaths: ["operation"] },
      { id: 1, timestamp: at(1), actor: jane, entity: "flow", action: "update", changedPaths: ["operation"] }
    ];
    assert.deepEqual(groupSummary(groupEvents(events)[0]).parts, ["Updated connections and layout"]);
  });
});

describe("dayLabel", () => {
  it("labels today, yesterday and older days", () => {
    const now = Date.parse("2026-11-03T15:00:00");
    assert.equal(dayLabel("2026-11-03T08:00:00", now), "Today");
    assert.equal(dayLabel("2026-11-02T23:00:00", now), "Yesterday");
    assert.match(dayLabel("2026-10-01T10:00:00", now), /2026/);
    assert.equal(dayLabel("garbage", now), "Earlier");
  });
});

describe("compact list wording", () => {
  const sam = { id: "u2", label: "Sam" };

  it("names the person only when it is someone else", () => {
    assert.equal(actorTag(sam, "u1"), "Sam: ");
    assert.equal(actorTag(jane, "u9"), "Jane Doe: ");
    assert.equal(actorTag(jane, "u1"), "");
    assert.equal(actorTag(null, "u1"), "");
  });

  it("writes one short line per change", () => {
    assert.equal(changeBrief(step(1, 0, "update", "Send email"), "u1"), "Changed ‘Send email’");
    assert.equal(changeBrief(step(1, 0, "create", "Send email"), "u1"), "Added ‘Send email’");
    assert.equal(changeBrief(step(1, 0, "delete", "Send email"), "u1"), "Removed ‘Send email’");
    assert.equal(changeBrief({ entity: "flow", action: "update", actor: sam }, "u1"), "Sam: Changed flow settings");
    assert.equal(changeBrief({ entity: "flow", action: "create", actor: sam }, "u1"), "Sam: Created the flow");
    assert.equal(changeBrief({ entity: "flow", action: "create", actor: jane }, "u1"), "Created the flow");
  });

  it("writes one line for a whole session", () => {
    const group = groupEvents([step(3, 0, "create", "Teams"), step(2, 1, "update", "Discord"), step(1, 2, "update", "Slack")])[0];
    assert.equal(groupHeadline(group, "u1"), "Added ‘Teams’ · Changed ‘Discord’ and ‘Slack’");
    assert.equal(groupHeadline(group, "u9"), "Jane Doe: Added ‘Teams’ · Changed ‘Discord’ and ‘Slack’");
    assert.equal(groupHeadline(groupEvents([step(1, 0, "update", "Slack")])[0], "u1"), "Changed ‘Slack’");
  });
});

describe("shortTime", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  it("keeps times tiny", () => {
    assert.equal(shortTime("2026-11-03T11:59:50Z", now), "now");
    assert.equal(shortTime("2026-11-03T11:55:00Z", now), "5m");
    assert.equal(shortTime("2026-11-03T09:00:00Z", now), "3h");
    assert.equal(shortTime("2026-10-31T12:00:00Z", now), "3d");
    assert.match(shortTime("2026-10-01T12:00:00Z", now), /Oct|1/);
    assert.equal(shortTime("garbage", now), "");
  });
});

describe("saves", () => {
  // newest first: four changes from one Save (1s apart), then another Save a minute earlier
  const events = [
    step(10, 0, "update", "Flow"), step(9, 1, "delete", "Teams"), step(8, 2, "update", "Discord"), step(7, 3, "update", "Slack"),
    step(6, 60, "create", "Teams"), step(5, 61, "update", "Discord")
  ];

  it("finds the change that finished the same save", () => {
    assert.equal(findSaveEnd(events, 7), 10);
    assert.equal(findSaveEnd(events, 8), 10);
    assert.equal(findSaveEnd(events, 10), 10);
    assert.equal(findSaveEnd(events, 5), 6);
    assert.equal(findSaveEnd(events, 999), 999);
  });

  it("does not merge saves made by different people or far apart", () => {
    const other = [step(3, 0, "update", "A"), { ...step(2, 1, "update", "B"), actor: { id: "u2", label: "Sam" } }];
    assert.equal(findSaveEnd(other, 2), 2);
    assert.equal(findSaveEnd([step(2, 0, "update", "A"), step(1, 30, "update", "B")], 1), 1);
  });

  it("counts the changes saved together", () => {
    assert.equal(saveSize(events, 8), 4);
    assert.equal(saveSize(events, 5), 2);
    assert.equal(saveSize([step(1, 0, "update", "A")], 1), 1);
  });
});

describe("withStepNames", () => {
  const id = "1c41c11f-0b67-4a2e-9d3a-7a1f5c0b2e11";

  it("gives a removed step its name back", () => {
    const events = [
      { ...step(3, 0, "delete", id), itemId: "op1", entityLabel: id },
      { ...step(2, 5, "update", "Send Teams"), itemId: "op1" },
      { ...step(1, 9, "create", "Send Teams"), itemId: "op1" }
    ];
    assert.equal(withStepNames(events)[0].entityLabel, "Send Teams");
    assert.equal(withStepNames(events)[1].entityLabel, "Send Teams");
  });

  it("leaves unknown steps alone", () => {
    const events = [{ ...step(1, 0, "delete", id), itemId: "op9", entityLabel: id }];
    assert.equal(withStepNames(events)[0].entityLabel, id);
    assert.deepEqual(withStepNames(undefined), []);
  });
});

describe("rearranged steps", () => {
  const moved = (id, seconds, label) => step(id, seconds, "update", label, { changedPaths: ["position_x", "resolve", "flow"] });

  it("tells a move or rewire apart from a settings change", () => {
    assert.equal(isPlumbingOnly(moved(1, 0, "A")), true);
    assert.equal(isPlumbingOnly(step(1, 0, "update", "A", { changedPaths: ["options.message", "flow"] })), false);
    assert.equal(isPlumbingOnly(step(1, 0, "update", "A")), false);
    assert.equal(changeBrief(moved(1, 0, "Send Slack"), "u1"), "Rearranged ‘Send Slack’");
    assert.equal(changeBrief(step(1, 0, "update", "Send Slack", { changedPaths: ["options.text"] }), "u1"), "Changed ‘Send Slack’");
  });

  it("summarises your Teams-removed, Slack-moved save in plain words", () => {
    const events = [
      { id: 10, timestamp: at(0), actor: jane, entity: "flow", action: "update", changedPaths: ["operation"] },
      { ...step(9, 1, "delete", "Send Microsoft Teams Message") },
      moved(8, 2, "Send Discord Message"),
      moved(7, 3, "Send Slack Message")
    ];
    assert.deepEqual(groupSummary(groupEvents(events, 5000)[0], "u1").parts, [
      "Removed ‘Send Microsoft Teams Message’",
      "Rearranged ‘Send Discord Message’ and ‘Send Slack Message’"
    ]);
  });

  it("puts a real settings change ahead of rearranging", () => {
    const events = [moved(3, 0, "A"), step(2, 1, "update", "B", { changedPaths: ["options.text"] }), step(1, 2, "create", "C")];
    assert.deepEqual(groupSummary(groupEvents(events)[0]).parts, ["Added ‘C’", "Changed ‘B’", "Rearranged ‘A’"]);
  });
});

describe("version before a save", () => {
  // newest first: a 3-change save, then a 2-change save a minute earlier, then a lone first change
  const events = [
    step(10, 0, "update", "A"), step(9, 1, "delete", "B"), step(8, 2, "update", "C"),
    step(7, 60, "create", "B"), step(6, 61, "create", "A"),
    step(5, 600, "create", "Flow")
  ];

  it("lists the changes of a save and finds the version before it", () => {
    assert.deepEqual(saveEvents(events, 9).map((event) => event.id), [10, 9, 8]);
    assert.equal(previousSaveEnd(events, 9), 7);
    assert.equal(previousSaveEnd(events, 10), 7);
    assert.equal(previousSaveEnd(events, 6), 5);
  });

  it("has nothing before the first version or an unknown change", () => {
    assert.equal(previousSaveEnd(events, 5), null);
    assert.equal(previousSaveEnd(events, 999), null);
    assert.deepEqual(saveEvents(events, 999), []);
    assert.equal(previousSaveEnd(undefined, 1), null);
  });
});

describe("version pills", () => {
  const op = (id, action, label, delta = { name: label }) => ({ id, entity: "operation", action, entityLabel: label, delta, changedFields: Object.keys(delta), timestamp: "2026-01-01T00:00:00Z", actor: { id: "u" } });

  it("lists what was added, removed and changed as separate pills", () => {
    const group = { events: [op(3, "create", "Teams"), op(2, "delete", "Slack"), op(1, "update", "Discord", { options: { a: 1 } })] };
    assert.deepEqual(groupParts(group).map((part) => [part.kind, part.names]), [
      ["added", ["Teams"]],
      ["removed", ["Slack"]],
      ["changed", ["Discord"]]
    ]);
  });

  it("shows a revert on its own", () => {
    const events = [{ ...op(2, "update", "Slack"), comment: "Reverted to the version from 2026-01-01T00:00:00" }, op(1, "create", "Teams")];
    assert.ok(isRevert(events[0]));
    assert.deepEqual(groupParts({ events }).map((part) => part.kind), ["reverted"]);
  });

  it("names the kinds of card a version touched", () => {
    const flow = { id: 4, entity: "flow", action: "update", changedFields: ["name"], timestamp: "2026-01-01T00:00:00Z", actor: { id: "u" } };
    const group = { events: [flow, { ...op(3, "create", "A"), stepType: "mail" }, { ...op(2, "update", "B"), stepType: "mail" }, { ...op(1, "create", "C"), stepType: "discord-operation" }] };
    assert.deepEqual(groupStepTypes(group), ["discord-operation", "mail", "trigger"]);
  });

  it("does not list the wiring of a step plugged into a new one", () => {
    const group = { events: [op(3, "update", "Slack", { resolve: "x" }), op(2, "update", "Slack", { position_x: 1 }), { ...op(1, "create", "Check"), stepType: "condition" }] };
    group.events[0].stepType = "slack-operation";
    assert.deepEqual(groupParts(group).map((part) => [part.kind, part.names]), [["added", ["Check"]], ["rearranged", ["Slack"]]]);
    const wiringOnly = { events: [group.events[0], group.events[2]] };
    assert.deepEqual(groupParts(wiringOnly).map((part) => part.kind), ["added"]);
    assert.deepEqual(groupStepTypes(wiringOnly), ["condition"]);
  });
});
