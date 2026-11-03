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

/** "URL, method" — distinct labels, first one capitalised, the rest lowercase unless acronyms. */
function changedFieldsText(paths) {
  const labels = [...new Set((paths ?? []).map(fieldLabel))];
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
  changeSentence,
  changedFieldsText,
  displayValue,
  fieldDetailLabel,
  fieldLabel,
  meaningfulChanges,
  pickMostRecentFlow,
  relativeTime
};
