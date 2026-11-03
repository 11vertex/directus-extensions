// Turns Directus permission data into short sentences for non-developers.

const ACTIONS = ["create", "read", "update", "delete"];

const OPERATORS = {
  _eq: "is",
  _neq: "is not",
  _lt: "is less than",
  _lte: "is at most",
  _gt: "is greater than",
  _gte: "is at least",
  _in: "is one of",
  _nin: "is not one of",
  _contains: "contains",
  _icontains: "contains",
  _ncontains: "doesn't contain",
  _starts_with: "starts with",
  _istarts_with: "starts with",
  _ends_with: "ends with",
  _iends_with: "ends with",
  _between: "is between",
  _nbetween: "is not between"
};

const EMPTINESS = {
  _null: ["is empty", "is not empty"],
  _nnull: ["is not empty", "is empty"],
  _empty: ["is empty", "is not empty"],
  _nempty: ["is not empty", "is empty"]
};

const VARIABLES = {
  $CURRENT_USER: "the current user",
  $CURRENT_ROLE: "the current user's role",
  $CURRENT_ROLES: "the current user's roles",
  $CURRENT_POLICIES: "the current user's policies",
  $NOW: "now"
};

const VERBS = {
  create: { can: "create new items", cannot: "Cannot create items.", fields: "Can fill in" },
  read: { can: "read", cannot: "Cannot see any items.", fields: "Can see" },
  update: { can: "edit", cannot: "Cannot edit items.", fields: "Can edit" },
  delete: { can: "delete", cannot: "Cannot delete items.", fields: null }
};

export function humanize(key) {
  const text = String(key).replaceAll("_", " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function isEmptyFilter(filter) {
  return !filter || typeof filter !== "object" || Object.keys(filter).length === 0;
}

function describeValue(value) {
  if (Array.isArray(value)) return value.map(describeValue).join(", ");
  if (value === null || value === undefined) return "empty";
  if (typeof value === "string") {
    if (value in VARIABLES) return VARIABLES[value];
    const variable = Object.keys(VARIABLES).find((name) => value.startsWith(`${name}.`));
    if (variable) {
      const path = value.slice(variable.length + 1).split(".").map((part) => humanize(part).toLowerCase());
      return `${VARIABLES[variable]}'s ${path.join(" ")}`;
    }
    return value;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function wrap(text) {
  return / (and|or) /.test(text) ? `(${text})` : text;
}

function describeNode(node, path, labelFor) {
  if (!node || typeof node !== "object") return null;
  const parts = [];

  for (const [key, value] of Object.entries(node)) {
    if (key === "_and" || key === "_or") {
      const items = (Array.isArray(value) ? value : [])
        .map((child) => describeNode(child, path, labelFor))
        .filter(Boolean);
      if (items.length === 1) parts.push(items[0]);
      else if (items.length > 1) parts.push(items.map(wrap).join(key === "_and" ? " and " : " or "));
      continue;
    }

    const subject = path.length > 0 ? path.map((field, depth) => labelFor(field, depth)).join(" → ") : "Item";

    if (key in OPERATORS) {
      const shown = key === "_between" || key === "_nbetween"
        ? (Array.isArray(value) ? value.map(describeValue).join(" and ") : describeValue(value))
        : describeValue(value);
      parts.push(`${subject} ${OPERATORS[key]} ${shown}`);
      continue;
    }

    if (key in EMPTINESS) {
      const [yes, no] = EMPTINESS[key];
      parts.push(`${subject} ${value === false || value === "false" ? no : yes}`);
      continue;
    }

    if (key === "_some" || key === "_none") {
      const inner = describeNode(value, path, labelFor);
      if (inner) parts.push(key === "_none" ? `no ${inner}` : inner);
      continue;
    }

    if (key.startsWith("_")) {
      parts.push(`${subject} matches a custom rule`);
      continue;
    }

    const nested = describeNode(value, [...path, key], labelFor);
    if (nested) parts.push(nested);
  }

  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : parts.map(wrap).join(" and ");
}

/** "Status is published and Author is the current user" — or null for "no filter". */
export function describeFilter(filter, labelFor = humanize) {
  if (isEmptyFilter(filter)) return null;
  return describeNode(filter, [], labelFor);
}

export function describeFieldList(fields, totalFields, labelFor = humanize) {
  if (!fields || fields.length === 0) return "no fields";
  if (fields.includes("*")) return "all fields";
  const names = fields.map((field) => labelFor(field, 0));
  const shown = names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more` : names.join(", ");
  return totalFields ? `${fields.length} of ${totalFields} fields: ${shown}` : `${fields.length} fields: ${shown}`;
}

function describePresets(presets, labelFor) {
  return Object.entries(presets)
    .map(([field, value]) => `${labelFor(field, 0)} = ${describeValue(value)}`)
    .join(", ");
}

/**
 * Plain sentences for one action on one collection.
 * `merged` is an entry of the simulate response `mergedRules`, `access` the `collectionAccess` entry.
 */
export function explainAction({ action, access, merged, totalFields, isAdmin = false, policyNames = [], labelFor = humanize }) {
  const verb = VERBS[action];
  if (isAdmin) {
    const headline = action === "create" ? "Can create new items (admin access)." : `Can ${verb.can} all items (admin access).`;
    return { level: "full", headline, lines: [] };
  }

  const level = access?.access === "full" || access?.access === "partial" ? access.access : "none";
  if (level === "none") return { level, headline: verb.cannot, lines: [] };

  const filter = action === "create" ? null : describeFilter(merged?.permissions, labelFor);
  const headline =
    action === "create"
      ? "Can create new items."
      : filter
        ? `Can ${verb.can} only items where ${filter}.`
        : `Can ${verb.can} all items.`;

  const lines = [];
  const fields = merged?.fields ?? access?.fields;
  if (verb.fields) lines.push(`${verb.fields} ${describeFieldList(fields, totalFields, labelFor)}.`);

  const validation = describeFilter(merged?.validation, labelFor);
  if (validation && action !== "read" && action !== "delete") lines.push(`Saved values must match: ${validation}.`);

  const presets = merged?.presets ?? access?.presets;
  if (presets && Object.keys(presets).length > 0 && action !== "read" && action !== "delete") {
    lines.push(`Filled in by default: ${describePresets(presets, labelFor)}.`);
  }

  if (merged?.hasUnresolvedUserContext) {
    lines.push("Depends on who is logged in — pick a user above to see the real result.");
  }

  if (policyNames.length > 0) {
    lines.push(`Granted by ${policyNames.length === 1 ? "policy" : "policies"}: ${policyNames.join(", ")}.`);
  }

  return { level, headline, lines };
}

const CONFLICT_TEXT = {
  divergent_fields: (c) => `Policies allow different ${c.action} fields — together they allow all of them.`,
  differing_filters: (c) => `Policies use different item rules for ${c.action} — an item is allowed if any rule matches.`,
  differing_validation: (c) => `Policies check saved values differently for ${c.action} — every check must pass.`,
  preset_collision: (c) => `Policies set different default values for ${c.action} — one will overwrite the other.`
};

/** Short warning sentences; overlapping (purely informational) rules are skipped. */
export function explainConflicts(conflicts = []) {
  return conflicts
    .filter((conflict) => conflict.severity !== "info" && CONFLICT_TEXT[conflict.kind])
    .map((conflict) => CONFLICT_TEXT[conflict.kind](conflict));
}

/** Rows of differing cells between two `collectionAccess` maps (from the compare `accessDiffs`). */
export function groupDiffsByCollection(accessDiffs = []) {
  const rows = new Map();
  for (const diff of accessDiffs) {
    if (diff.change === "same") continue;
    if (!rows.has(diff.collection)) rows.set(diff.collection, {});
    rows.get(diff.collection)[diff.action] = { left: diff.left, right: diff.right };
  }
  return rows;
}

export { ACTIONS };
