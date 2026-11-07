const FIELD_LABELS = {
  name: "Name",
  key: "Key",
  type: "Type",
  icon: "Icon",
  color: "Color",
  description: "Description",
  status: "Status",
  trigger: "Trigger",
  accountability: "Activity & logs",
  options: "Settings",
  operation: "First step",
  resolve: "Next step on success",
  reject: "Next step on failure",
  position_x: "Position",
  position_y: "Position",
  flow: "Flow"
};

const ACRONYMS = new Set(["url", "id", "api", "json", "http", "html", "csv", "ip", "uuid", "sql"]);
const LINK_FIELDS = new Set(["resolve", "reject", "operation"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function relativeTime(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "at an unknown time";
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return `on ${new Date(time).toLocaleDateString()}`;
}

function humanize(segment) {
  const words = String(segment)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.toLowerCase()));
  if (!words.length) return String(segment);
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/** Short label for a changed field path ("options.url" → "URL"). */
function fieldLabel(path) {
  const [top, next] = String(path).split(".");
  if (top === "options" && next && !/^\d+$/.test(next)) return humanize(next);
  return FIELD_LABELS[top] ?? humanize(top);
}

/** Longer label for the before/after table ("options.headers.0.value" → "Headers › Value"). */
function fieldDetailLabel(path) {
  const segments = String(path).split(".");
  if (segments[0] === "position_x") return "Position (across)";
  if (segments[0] === "position_y") return "Position (down)";
  if (segments[0] !== "options" || segments.length === 1) return fieldLabel(path);
  return segments
    .slice(1)
    .filter((segment) => !/^\d+$/.test(segment))
    .map(humanize)
    .join(" › ");
}

// Fields that only describe how steps are wired or placed. They change on almost every edit and mean
// little on their own, so they are summarised instead of listed.
const PLUMBING = new Set(["flow", "resolve", "reject", "operation", "position_x", "position_y"]);
const topLevel = (path) => String(path).split(".")[0];

/** "URL, method" — distinct labels, first one capitalised, the rest lowercase unless acronyms. */
function changedFieldsText(paths) {
  const all = paths ?? [];
  const real = all.filter((path) => !PLUMBING.has(topLevel(path)));
  if (real.length === 0) return all.length ? "connections and layout" : "";
  const labels = [...new Set(real.map(fieldLabel))];
  return labels
    .map((label, index) => (index === 0 || label === label.toUpperCase() ? label : lowerFirst(label)))
    .join(", ");
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function actorName(actor, currentUserId) {
  if (actor?.id && actor.id === currentUserId) return "You";
  if (!actor?.id) return "Someone";
  return actor.label || "Someone";
}

/** "Jane changed the step ‘Send email’". */
function changeSentence(event, currentUserId = null) {
  const who = actorName(event.actor, currentUserId);
  if (event.entity === "flow") {
    if (event.action === "create") return `${who} created the flow`;
    if (event.action === "delete") return `${who} deleted the flow`;
    return `${who} changed the flow settings`;
  }
  const name = `‘${event.entityLabel || "Unnamed step"}’`;
  if (event.action === "create") return `${who} added the step ${name}`;
  if (event.action === "delete") return `${who} removed the step ${name}`;
  return `${who} changed the step ${name}`;
}

/** The change without who made it: "Added the step ‘Send email’". */
function changeAction(event) {
  if (event.entity === "flow") {
    if (event.action === "create") return "Created the flow";
    if (event.action === "delete") return "Deleted the flow";
    return "Changed the flow settings";
  }
  const name = `‘${event.entityLabel || "Unnamed step"}’`;
  if (event.action === "create") return `Added the step ${name}`;
  if (event.action === "delete") return `Removed the step ${name}`;
  return `Changed the step ${name}`;
}

/**
 * Put changes saved by the same person within a short time into one editing session.
 * `events` must be newest first; every group keeps that order.
 */
function groupEvents(events, gapMs = 60000) {
  const groups = [];
  for (const event of events ?? []) {
    const group = groups[groups.length - 1];
    const last = group?.events[group.events.length - 1];
    const sameActor = last && (last.actor?.id ?? null) === (event.actor?.id ?? null);
    const gap = last ? Date.parse(last.timestamp) - Date.parse(event.timestamp) : Infinity;
    if (group && sameActor && gap <= gapMs) {
      group.events.push(event);
    } else {
      groups.push({ key: String(event.id), actor: event.actor, timestamp: event.timestamp, events: [event] });
    }
  }
  return groups;
}

function quotedList(names) {
  const quoted = names.map((name) => `‘${name || "Unnamed step"}’`);
  if (quoted.length <= 2) return quoted.join(" and ");
  return `${quoted.slice(0, 2).join(", ")} and ${quoted.length - 2} more`;
}

// Plugging a step into the one before it only edits that step's wiring. When the same save adds or removes
// a step, that wiring is just how the new step got connected, so it is not worth listing on its own.
const WIRING = new Set(["resolve", "reject", "operation", "flow"]);
const isWiringOnly = (event) => {
  const paths = pathsOf(event);
  return event.action === "update" && paths.length > 0 && paths.every((path) => WIRING.has(topLevel(path)));
};
const addsOrRemoves = (group) => group.events.some((event) => event.entity === "operation" && event.action !== "update");
const visibleEvents = (group) => (addsOrRemoves(group) ? group.events.filter((event) => !isWiringOnly(event)) : group.events);

// What a group of changes did, sorted into the kinds the list shows as pills.
function classify(group) {
  const added = [];
  const removed = [];
  const touched = [];
  const moved = [];
  const result = { created: false, deleted: false, flowSettings: false };
  const push = (list, name) => {
    if (!list.includes(name)) list.push(name);
  };
  for (const event of visibleEvents(group)) {
    if (event.entity === "flow") {
      if (event.action === "create") result.created = true;
      else if (event.action === "delete") result.deleted = true;
      else if (pathsOf(event).some((path) => !PLUMBING.has(topLevel(path)))) result.flowSettings = true;
      continue;
    }
    if (event.action === "create") push(added, event.entityLabel);
    else if (event.action === "delete") push(removed, event.entityLabel);
    else if (isPlumbingOnly(event)) push(moved, event.entityLabel);
    else push(touched, event.entityLabel);
  }
  // A step added in this save is not also "changed"; a step that was changed is not also "rearranged".
  const changed = touched.filter((name) => !added.includes(name));
  const rearranged = moved.filter((name) => !added.includes(name) && !touched.includes(name));
  return { ...result, added, removed, changed, rearranged };
}

/** A change that put the flow back to an earlier version carries this note in the activity log. */
const REVERT_NOTE = "Reverted to the version from";
const isRevert = (event) => typeof event?.comment === "string" && event.comment.startsWith(REVERT_NOTE);

/**
 * What a version did, as pills: [{ kind, label, names }]. kind is one of reverted, created, deleted,
 * added, removed, changed, settings, rearranged. A revert is shown on its own.
 */
function groupParts(group) {
  const revert = group.events.find(isRevert);
  if (revert) return [{ kind: "reverted", label: "Reverted", names: [revert.comment.slice(REVERT_NOTE.length).trim()] }];
  const { created, deleted, flowSettings, added, removed, changed, rearranged } = classify(group);
  const parts = [];
  const name = (value) => value || "Unnamed step";
  if (created) parts.push({ kind: "created", label: "Created", names: ["the flow"] });
  if (deleted) parts.push({ kind: "deleted", label: "Deleted", names: ["the flow"] });
  if (added.length) parts.push({ kind: "added", label: "Added", names: added.map(name) });
  if (removed.length) parts.push({ kind: "removed", label: "Removed", names: removed.map(name) });
  if (changed.length) parts.push({ kind: "changed", label: "Changed", names: changed.map(name) });
  if (flowSettings) parts.push({ kind: "settings", label: "Changed", names: ["flow settings"] });
  if (rearranged.length) parts.push({ kind: "rearranged", label: "Rearranged", names: rearranged.map(name) });
  if (!parts.length) parts.push({ kind: "rearranged", label: "Rearranged", names: ["connections and layout"] });
  return parts;
}

/** Title and short parts for an editing session: "You edited the flow" + ["Added ‘X’", "Changed ‘Y’"]. */
function groupSummary(group, currentUserId = null) {
  const who = actorName(group.actor, currentUserId);
  if (group.events.length === 1) return { title: changeSentence(group.events[0], currentUserId), parts: [] };

  const { created, deleted, flowSettings, added, removed, changed, rearranged } = classify(group);
  const parts = [];
  if (created) parts.push("Created the flow");
  if (deleted) parts.push("Deleted the flow");
  if (added.length) parts.push(`Added ${quotedList(added)}`);
  if (removed.length) parts.push(`Removed ${quotedList(removed)}`);
  if (changed.length) parts.push(`Changed ${quotedList(changed)}`);
  if (flowSettings) parts.push("Updated the flow settings");
  if (rearranged.length) parts.push(`Rearranged ${quotedList(rearranged)}`);
  if (!parts.length) parts.push("Updated connections and layout");

  return { title: `${who} edited the flow`, parts };
}

// One press of Save in the flow editor writes its changes within a moment of each other.
const SAVE_GAP_MS = 5000;

/**
 * The change that finished the same save as `id`. Directus records one Save as several events, but only
 * the state after all of them ever existed, so the picture for any of them is drawn as of the last one.
 * `events` is newest first.
 */
function findSaveEnd(events, id, gapMs = SAVE_GAP_MS) {
  const list = events ?? [];
  let index = list.findIndex((event) => event.id === id);
  if (index < 0) return id;
  while (index > 0) {
    const newer = list[index - 1];
    const current = list[index];
    const sameActor = (newer.actor?.id ?? null) === (current.actor?.id ?? null);
    if (sameActor && Date.parse(newer.timestamp) - Date.parse(current.timestamp) <= gapMs) index -= 1;
    else break;
  }
  return list[index].id;
}

/** The changes saved together with `id`, newest first (the change itself included). */
function saveEvents(events, id, gapMs = SAVE_GAP_MS) {
  const list = events ?? [];
  const end = findSaveEnd(list, id, gapMs);
  const start = list.findIndex((event) => event.id === end);
  if (start < 0) return [];
  return list.slice(start, start + saveSize(list, id, gapMs));
}

/**
 * The change that finished the version before the save `id` belongs to, or null when there is none
 * in the list (the first version, or older history that is not loaded yet).
 */
function previousSaveEnd(events, id, gapMs = SAVE_GAP_MS) {
  const list = events ?? [];
  const group = saveEvents(list, id, gapMs);
  if (!group.length) return null;
  const oldest = list.findIndex((event) => event.id === group[group.length - 1].id);
  return list[oldest + 1]?.id ?? null;
}

/** How many changes were saved together with `id` (including itself). */
function saveSize(events, id, gapMs = SAVE_GAP_MS) {
  const list = events ?? [];
  const end = findSaveEnd(list, id, gapMs);
  const endIndex = list.findIndex((event) => event.id === end);
  let size = 1;
  for (let index = endIndex; index < list.length - 1; index += 1) {
    const current = list[index];
    const older = list[index + 1];
    const sameActor = (older.actor?.id ?? null) === (current.actor?.id ?? null);
    if (sameActor && Date.parse(current.timestamp) - Date.parse(older.timestamp) <= gapMs) size += 1;
    else break;
  }
  return size;
}

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A removed step has no name in the history. Borrow it from an earlier change to the same step so the
 * list can say "Removed ‘Send email’" instead of showing an id.
 */
function withStepNames(events) {
  const names = new Map();
  const types = new Map();
  for (const event of events ?? []) {
    if (event.entity !== "operation") continue;
    if (event.entityLabel && !UUID_LIKE.test(event.entityLabel) && !names.has(event.itemId)) names.set(event.itemId, event.entityLabel);
    if (event.stepType && !types.has(event.itemId)) types.set(event.itemId, event.stepType);
  }
  return (events ?? []).map((event) => {
    if (event.entity !== "operation") return event;
    const next = { ...event };
    if ((!next.entityLabel || UUID_LIKE.test(next.entityLabel)) && names.has(next.itemId)) next.entityLabel = names.get(next.itemId);
    if (!next.stepType && types.has(next.itemId)) next.stepType = types.get(next.itemId);
    return next;
  });
}

/**
 * The kinds of card a version touched, in order: "trigger" for the flow's own settings, then each step's
 * operation type ("log", "mail", "discord-operation", ...). Unknown types are left out.
 */
function groupStepTypes(group) {
  const types = [];
  const push = (type) => {
    if (type && !types.includes(type)) types.push(type);
  };
  for (const event of [...visibleEvents(group)].reverse()) {
    if (event.entity === "flow") {
      if (event.action === "create" || pathsOf(event).some((path) => !PLUMBING.has(topLevel(path)))) push("trigger");
    } else push(event.stepType);
  }
  return types;
}

/** "Jane: " for someone else's change, nothing for your own. */
function actorTag(actor, currentUserId = null) {
  if (!actor?.id || actor.id === currentUserId) return "";
  return `${actor.label || "Someone"}: `;
}

const pathsOf = (event) => event.changedPaths ?? event.changedFields ?? [];

/** True when a change only touched how steps are wired or placed (no settings, no name). */
function isPlumbingOnly(event) {
  const paths = pathsOf(event);
  return paths.length > 0 && paths.every((path) => PLUMBING.has(topLevel(path)));
}

/** One short line for a list: "Changed ‘Send email’". */
function changeBrief(event, currentUserId = null) {
  const tag = actorTag(event.actor, currentUserId);
  if (event.entity === "flow") {
    if (event.action === "create") return `${tag}Created the flow`;
    if (event.action === "delete") return `${tag}Deleted the flow`;
    return `${tag}Changed flow settings`;
  }
  const name = `‘${event.entityLabel || "Unnamed step"}’`;
  if (event.action === "create") return `${tag}Added ${name}`;
  if (event.action === "delete") return `${tag}Removed ${name}`;
  if (isPlumbingOnly(event)) return `${tag}Rearranged ${name}`;
  return `${tag}Changed ${name}`;
}

/** One line for a whole editing session: "Added ‘Teams’ · Changed ‘Discord’ and ‘Slack’". */
function groupHeadline(group, currentUserId = null) {
  if (group.events.some(isRevert)) return `${actorTag(group.actor, currentUserId)}Reverted the flow to an earlier version`;
  if (group.events.length === 1) return changeBrief(group.events[0], currentUserId);
  return actorTag(group.actor, currentUserId) + groupSummary(group, currentUserId).parts.join(" · ");
}

/** "now", "5m", "3h", "2d", or "21 Oct" — small enough to sit beside a title. */
function shortTime(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "Today", "Yesterday", or the date. */
function dayLabel(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Earlier";
  const startOf = (ms) => new Date(new Date(ms).toDateString()).getTime();
  const days = Math.round((startOf(now) - startOf(time)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(time).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/**
 * Display form of one value. Short values come back as text; objects, arrays
 * and long strings come back flagged `long` with pretty-printed JSON.
 */
function displayValue(value, path = "", stepNames = {}) {
  if (value === null || value === undefined || value === "") return { text: "(empty)", long: false };
  if (typeof value === "boolean") return { text: value ? "Yes" : "No", long: false };
  if (typeof value === "string") {
    if (LINK_FIELDS.has(String(path).split(".")[0]) && UUID_RE.test(value)) {
      return { text: stepNames[value] ? `‘${stepNames[value]}’` : "another step", long: false };
    }
    return value.length > 80 ? { text: value, long: true } : { text: value, long: false };
  }
  if (typeof value === "number") return { text: String(value), long: false };
  return { text: JSON.stringify(value, null, 2), long: true };
}

/** Drop bookkeeping fields and "empty to empty" rows from a raw diff. */
function meaningfulChanges(diffs) {
  return (diffs ?? []).filter((diff) => {
    const top = String(diff.path).split(".")[0];
    if (["id", "date_created", "user_created", "operations"].includes(top)) return false;
    return !(isEmpty(diff.before) && isEmpty(diff.after));
  });
}

function isEmpty(value) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value).length === 0;
}

function lastEditedTime(flow) {
  return Date.parse(flow?.lastEditedAt ?? flow?.dateCreated ?? "") || 0;
}

function pickMostRecentFlow(flows) {
  let best = null;
  for (const flow of flows ?? []) {
    if (!best || lastEditedTime(flow) > lastEditedTime(best)) best = flow;
  }
  return best;
}

export {
  SAVE_GAP_MS,
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
  groupSummary,
  isRevert,
  meaningfulChanges,
  pickMostRecentFlow,
  previousSaveEnd,
  relativeTime,
  saveEvents,
  saveSize,
  shortTime,
  withStepNames
};
