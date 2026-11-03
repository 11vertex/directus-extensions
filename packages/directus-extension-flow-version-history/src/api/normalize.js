import { redactValue, stripRelationalFields } from "./redact.js";

const TRACKED_COLLECTIONS = new Set(["directus_flows", "directus_operations"]);
const TRACKED_ACTIONS = new Set(["create", "update", "delete"]);

function normalizeHistoryEvent(activity, context = {}) {
  const revision = firstRevision(activity.revisions);
  const rawSnapshot = asObject(revision?.data);
  const rawDelta = asObject(revision?.delta);
  const collection = activity.collection ?? null;
  const itemId = activity.item ? String(activity.item) : null;
  const entity = collection === "directus_flows" ? "flow" : "operation";
  const flowId = resolveFlowId(activity, rawSnapshot, rawDelta, context.operationFlowMap);
  const current = context.currentByEntity?.get(`${collection}:${itemId}`) ?? null;
  const snapshot = redactValue(rawSnapshot);
  const delta = redactValue(rawDelta);
  const comparableCurrent = current
    ? redactValue(stripRelationalFields(current, collection))
    : null;

  return {
    id: Number(activity.id),
    action: activity.action,
    collection,
    entity,
    itemId,
    flowId,
    timestamp: activity.timestamp ?? null,
    actor: normalizeActor(activity.user),
    ip: activity.ip ?? null,
    origin: activity.origin ?? null,
    revisionId: revision?.id ?? null,
    revisionParentId: revision?.parent ? Number(revision.parent) : null,
    hasRevision: Boolean(revision),
    association:
      context.associationByActivityId?.get(Number(activity.id)) ??
      (flowId ? "mapped" : "unresolved"),
    snapshot,
    delta,
    changedFields: Object.keys(delta ?? {}).sort((a, b) => a.localeCompare(b)),
    entityLabel: entityLabel(entity, itemId, snapshot, current),
    currentExists: Boolean(current),
    currentDiff: comparableCurrent ? diffValues(snapshot, comparableCurrent) : []
  };
}

function normalizeHistoryDetail(activity, context = {}) {
  const event = normalizeHistoryEvent(activity, context);
  const current = context.currentByEntity?.get(`${event.collection}:${event.itemId}`) ?? null;
  return {
    ...event,
    current: current
      ? redactValue(stripRelationalFields(current, event.collection))
      : null,
    warnings: buildWarnings(event)
  };
}

function toHistorySummary(event) {
  const summary = { ...event };
  delete summary.snapshot;
  delete summary.delta;
  delete summary.currentDiff;
  return summary;
}

function compareHistoryEvents(left, right) {
  if (left.collection !== right.collection || left.itemId !== right.itemId) {
    const error = new Error(
      "Revisions must belong to the same flow or operation to compare."
    );
    error.status = 400;
    throw error;
  }

  return {
    collection: left.collection,
    entity: left.entity,
    itemId: left.itemId,
    entityLabel: right.entityLabel || left.entityLabel,
    left: eventIdentity(left),
    right: eventIdentity(right),
    differences: diffValues(left.snapshot, right.snapshot),
    caveats: [
      "Directus revision snapshots omit relational graph edges (resolve/reject/flow/operation).",
      "Compare content fields only; topology may be incomplete."
    ]
  };
}

function diffValues(left, right) {
  const differences = [];
  walkDiff(left, right, "", differences);
  return differences;
}

function walkDiff(left, right, path, output) {
  if (stableStringify(left) === stableStringify(right)) return;

  const leftObject = isPlainObject(left);
  const rightObject = isPlainObject(right);
  if (leftObject || rightObject) {
    const keys = unique([
      ...Object.keys(leftObject ? left : {}),
      ...Object.keys(rightObject ? right : {})
    ]).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      walkDiff(
        leftObject ? left[key] : void 0,
        rightObject ? right[key] : void 0,
        path ? `${path}.${key}` : key,
        output
      );
    }
    return;
  }

  const leftMissing = left === void 0;
  const rightMissing = right === void 0;
  output.push({
    path: path || "$",
    change: leftMissing ? "added" : rightMissing ? "removed" : "changed",
    before: leftMissing ? null : left,
    after: rightMissing ? null : right
  });
}

const NOISE_FIELDS = new Set(["id", "date_created", "user_created", "operations"]);

/**
 * Field-level before/after list for one definition change, compared with the
 * previous saved snapshot of the same flow/operation. Bookkeeping fields and
 * "empty to empty" differences are dropped.
 */
function describeRevisionChanges({ action, previousSnapshot = null, snapshot = null, delta = null }) {
  const previous = asObject(previousSnapshot);
  const current = asObject(snapshot);
  const patch = asObject(delta);
  let changes = [];

  if (action === "delete") {
    changes = previous ? diffValues(previous, void 0) : [];
  } else if (action === "create" || previous) {
    changes = diffValues(previous ?? void 0, current ?? void 0);
    for (const [key, value] of Object.entries(patch ?? {})) {
      const known = (previous && key in previous) || (current && key in current);
      if (!known) changes.push({ path: key, change: "changed", before: null, after: value });
    }
  } else {
    changes = Object.entries(patch ?? {}).map(([key, value]) => ({
      path: key,
      change: "changed",
      before: null,
      after: value,
      beforeUnknown: true
    }));
  }

  return changes.filter(
    (entry) =>
      !NOISE_FIELDS.has(entry.path.split(".")[0]) && !(isEmpty(entry.before) && isEmpty(entry.after))
  );
}

/** The newest earlier activity for the same item that has a saved snapshot. */
function findPreviousSnapshotActivity(activity, activities) {
  let best = null;
  for (const candidate of activities ?? []) {
    if (candidate.collection !== activity.collection) continue;
    if (String(candidate.item) !== String(activity.item)) continue;
    if (Number(candidate.id) >= Number(activity.id)) continue;
    if (!asObject(firstRevision(candidate.revisions)?.data)) continue;
    if (!best || Number(candidate.id) > Number(best.id)) best = candidate;
  }
  return best;
}

/** Most recent definition edit per flow, from activity rows sorted any way. */
function computeLastEdited(rows, operationFlowMap = new Map()) {
  const result = new Map();
  for (const row of rows ?? []) {
    const flowId =
      row.collection === "directus_flows"
        ? String(row.item)
        : operationFlowMap.get(String(row.item)) ?? null;
    if (!flowId || !row.timestamp) continue;
    const previous = result.get(flowId);
    if (!previous || String(row.timestamp) > previous) result.set(flowId, String(row.timestamp));
  }
  return result;
}

function isEmpty(value) {
  if (value === null || value === void 0 || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return isPlainObject(value) && Object.keys(value).length === 0;
}

function isTrackedDefinitionActivity(activity) {
  return (
    TRACKED_COLLECTIONS.has(activity?.collection) &&
    TRACKED_ACTIONS.has(activity?.action)
  );
}

function resolveFlowId(activity, snapshot, delta, operationFlowMap = new Map()) {
  if (activity.collection === "directus_flows") {
    return activity.item ? String(activity.item) : null;
  }
  // Snapshot create payloads omit relational FKs; update deltas may include them.
  const embedded = delta?.flow ?? snapshot?.flow;
  if (embedded) return String(embedded);
  const itemId = activity.item ? String(activity.item) : null;
  return itemId ? operationFlowMap.get(itemId) ?? null : null;
}

function normalizeActor(user) {
  if (!user) return { id: null, label: "System / unknown" };
  if (typeof user === "string") return { id: user, label: user };
  const firstName = typeof user.first_name === "string" ? user.first_name : "";
  const lastName = typeof user.last_name === "string" ? user.last_name : "";
  const name = `${firstName} ${lastName}`.trim();
  return {
    id: user.id ? String(user.id) : null,
    label: name || user.email || (user.id ? String(user.id) : "System / unknown")
  };
}

function entityLabel(entity, itemId, snapshot, current) {
  if (entity === "flow") {
    return current?.name ?? snapshot?.name ?? itemId ?? "Unknown flow";
  }
  return (
    current?.name ??
    current?.key ??
    snapshot?.name ??
    snapshot?.key ??
    itemId ??
    "Unknown operation"
  );
}

function eventIdentity(event) {
  return {
    id: event.id,
    revisionId: event.revisionId,
    action: event.action,
    timestamp: event.timestamp,
    actor: event.actor,
    snapshot: event.snapshot,
    delta: event.delta
  };
}

function buildWarnings(event) {
  const warnings = [];
  if (!event.hasRevision) {
    if (event.action === "delete") {
      warnings.push(
        "Directus records delete activity without a revision snapshot, so deleted values may be unavailable."
      );
    } else {
      warnings.push("No revision payload is available for this change.");
    }
  }
  if (!event.currentExists) {
    warnings.push(
      "The current item no longer exists, so current-vs-saved comparison is unavailable."
    );
  }
  if (event.association === "time_window") {
    warnings.push(
      "This operation change was associated by timestamp proximity to a flow save, not a parent revision link."
    );
  }
  warnings.push(
    "Revision snapshots omit relational graph edges (resolve/reject/flow/operation)."
  );
  return warnings;
}

function firstRevision(revisions) {
  return Array.isArray(revisions) && revisions.length > 0 ? revisions[0] : null;
}

function asObject(value) {
  return isPlainObject(value) ? value : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)])
    );
  }
  return value;
}

function unique(values) {
  return [...new Set(values)];
}

export {
  compareHistoryEvents,
  computeLastEdited,
  describeRevisionChanges,
  diffValues,
  findPreviousSnapshotActivity,
  isTrackedDefinitionActivity,
  normalizeHistoryDetail,
  normalizeHistoryEvent,
  resolveFlowId,
  toHistorySummary
};
