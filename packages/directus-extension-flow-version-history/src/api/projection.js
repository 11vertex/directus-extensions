import { redactValue } from "./redact.js";

const FLOW_CONTENT_KEYS = [
  "id",
  "name",
  "icon",
  "color",
  "description",
  "status",
  "trigger",
  "accountability",
  "options",
  "date_created"
];

const OPERATION_CONTENT_KEYS = [
  "id",
  "name",
  "key",
  "type",
  "position_x",
  "position_y",
  "options",
  "date_created"
];

/**
 * Reconstruct a read-only flow graph as of a point in time from chronological
 * activity/revision rows. Relational edges only appear when present in deltas.
 */
function buildDefinitionProjection({ flowId, asOfTimestamp, activities }) {
  const asOf = Date.parse(asOfTimestamp);
  const chronological = [...activities]
    .filter((activity) => {
      const time = Date.parse(activity.timestamp);
      if (!Number.isFinite(time)) return false;
      if (Number.isFinite(asOf) && time > asOf) return false;
      return true;
    })
    .sort((left, right) => {
      const time = String(left.timestamp).localeCompare(String(right.timestamp));
      if (time !== 0) return time;
      return Number(left.id) - Number(right.id);
    });

  let flow = { id: flowId };
  const operations = new Map();
  const deletedOps = new Set();
  let sawEdge = false;
  let flowExists = false;

  for (const activity of chronological) {
    const revision = firstRevision(activity.revisions);
    const data = asObject(revision?.data);
    const delta = asObject(revision?.delta);

    if (activity.collection === "directus_flows") {
      if (activity.action === "delete") {
        flowExists = false;
        continue;
      }
      flowExists = true;
      if (data) flow = { ...flow, ...pick(data, FLOW_CONTENT_KEYS) };
      if (delta?.operation !== undefined) {
        flow.operation = delta.operation ? String(delta.operation) : null;
        sawEdge = true;
      }
      continue;
    }

    if (activity.collection !== "directus_operations") continue;
    const opId = String(activity.item);

    if (activity.action === "delete") {
      operations.delete(opId);
      deletedOps.add(opId);
      continue;
    }

    deletedOps.delete(opId);
    const existing = operations.get(opId) ?? { id: opId };
    const next = { ...existing };
    if (data) Object.assign(next, pick(data, OPERATION_CONTENT_KEYS));
    if (!next.id) next.id = opId;

    if (delta) {
      if (delta.resolve !== undefined) {
        next.resolve = delta.resolve ? String(delta.resolve) : null;
        sawEdge = true;
      }
      if (delta.reject !== undefined) {
        next.reject = delta.reject ? String(delta.reject) : null;
        sawEdge = true;
      }
      if (delta.flow !== undefined) {
        next.flow = delta.flow ? String(delta.flow) : null;
      }
      // Content fields may only appear in delta on partial updates.
      Object.assign(next, pick(delta, OPERATION_CONTENT_KEYS));
    }

    if (next.flow && String(next.flow) !== String(flowId)) {
      // Belongs to another flow; keep out of this projection.
      operations.delete(opId);
      continue;
    }

    next.flow = flowId;
    operations.set(opId, next);
  }

  const panels = buildPanels(flow, [...operations.values()]);
  const warnings = [
    "This is a reconstructed read-only view from native activity/revisions.",
    "Directus snapshots omit relational graph edges; resolve/reject/start links appear only when those fields were patched."
  ];
  if (!sawEdge) {
    warnings.push(
      "No graph-edge deltas were found at this point in time; cards show content and positions only."
    );
  }

  return {
    flowId: String(flowId),
    asOfTimestamp: asOfTimestamp ?? null,
    flowExists,
    confidence: sawEdge ? "partial" : "content_only",
    flow: redactValue({
      ...pick(flow, FLOW_CONTENT_KEYS),
      operation: flow.operation ?? null
    }),
    operations: [...operations.values()]
      .map((operation) =>
        redactValue({
          ...pick(operation, OPERATION_CONTENT_KEYS),
          flow: flowId,
          resolve: operation.resolve ?? null,
          reject: operation.reject ?? null
        })
      )
      .sort(sortOperations),
    deletedOperationIds: [...deletedOps],
    panels,
    warnings
  };
}

function buildPanels(flow, operations) {
  const trigger = {
    id: "$trigger",
    kind: "trigger",
    name: flow.name ?? "Trigger",
    type: flow.trigger ?? "unknown",
    icon: flow.icon || "bolt",
    color: flow.color ?? null,
    status: flow.status ?? null,
    options: redactValue(flow.options ?? {}),
    x: 1,
    y: 1,
    resolve: flow.operation ? String(flow.operation) : null,
    reject: null
  };

  const cards = operations.map((operation) => ({
    id: String(operation.id),
    kind: "operation",
    name: operation.name || operation.key || String(operation.id),
    key: operation.key ?? null,
    type: operation.type ?? "unknown",
    icon: iconForType(operation.type),
    color: null,
    options: redactValue(operation.options ?? {}),
    x: Number.isFinite(Number(operation.position_x)) ? Number(operation.position_x) : null,
    y: Number.isFinite(Number(operation.position_y)) ? Number(operation.position_y) : null,
    resolve: operation.resolve ? String(operation.resolve) : null,
    reject: operation.reject ? String(operation.reject) : null
  }));

  assignFallbackPositions(cards);
  return [trigger, ...cards.sort(sortPanels)];
}

function buildCurrentProjection({ flowId, flow, operations }) {
  const flowRow = flow ?? { id: flowId };
  const ops = (operations ?? []).map((operation) => ({
    ...operation,
    id: String(operation.id),
    resolve: operation.resolve ? String(operation.resolve) : null,
    reject: operation.reject ? String(operation.reject) : null,
    flow: flowId
  }));

  const panels = buildPanels(
    {
      ...flowRow,
      operation: flowRow.operation ? String(flowRow.operation) : null
    },
    ops
  );

  return {
    flowId: String(flowId),
    asOfTimestamp: null,
    flowExists: Boolean(flow),
    confidence: "current",
    flow: redactValue({
      ...pick(flowRow, FLOW_CONTENT_KEYS),
      operation: flowRow.operation ? String(flowRow.operation) : null
    }),
    operations: ops
      .map((operation) =>
        redactValue({
          ...pick(operation, OPERATION_CONTENT_KEYS),
          flow: flowId,
          resolve: operation.resolve ?? null,
          reject: operation.reject ?? null
        })
      )
      .sort(sortOperations),
    deletedOperationIds: [],
    panels,
    warnings: ["Showing the live flow definition (not a historical reconstruction)."]
  };
}

function assignFallbackPositions(cards) {
  let nextX = 16;
  let nextY = 1;
  for (const card of cards) {
    if (card.x == null || card.y == null) {
      card.x = nextX;
      card.y = nextY;
      card.positionFallback = true;
      nextY += 16;
      if (nextY > 60) {
        nextY = 1;
        nextX += 16;
      }
    }
  }
}

function iconForType(type) {
  const map = {
    condition: "rule",
    exec: "code",
    request: "cloud",
    log: "box",
    notification: "notifications",
    mail: "mail",
    sleep: "schedule",
    transform: "transform",
    item_create: "add_circle",
    item_read: "visibility",
    item_update: "edit",
    item_delete: "delete",
    trigger: "bolt"
  };
  return map[type] ?? "extension";
}

function sortOperations(left, right) {
  const y = (Number(left.position_y) || 0) - (Number(right.position_y) || 0);
  if (y !== 0) return y;
  return (Number(left.position_x) || 0) - (Number(right.position_x) || 0);
}

function sortPanels(left, right) {
  const y = (left.y || 0) - (right.y || 0);
  if (y !== 0) return y;
  return (left.x || 0) - (right.x || 0);
}

function pick(source, keys) {
  const result = {};
  if (!isPlainObject(source)) return result;
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
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

export { buildCurrentProjection, buildDefinitionProjection };
