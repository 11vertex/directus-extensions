import {
  compareHistoryEvents,
  computeLastEdited,
  describeRevisionChanges,
  findPreviousSnapshotActivity,
  isTrackedDefinitionActivity,
  normalizeHistoryDetail,
  normalizeHistoryEvent,
  toHistorySummary
} from "./normalize.js";
import { buildCurrentProjection, buildDefinitionProjection } from "./projection.js";
import { redactValue } from "./redact.js";

const ACTIVITY_FIELDS = [
  "id",
  "action",
  "timestamp",
  "user.id",
  "user.first_name",
  "user.last_name",
  "user.email",
  "ip",
  "origin",
  "collection",
  "item",
  "revisions.id",
  "revisions.parent",
  "revisions.data",
  "revisions.delta"
];

const TIME_WINDOW_MS = 2000;

async function listFlows(context) {
  const schema = await context.getSchema();
  const service = new context.services.FlowsService({
    schema,
    accountability: null,
    knex: context.database
  });
  const flows = await service.readByQuery({
    fields: ["id", "name", "status", "trigger", "date_created", "user_created"],
    sort: ["name"],
    limit: -1
  });
  const lastEdited = await loadLastEdited(context, schema);
  return flows.map((flow) => ({
    id: String(flow.id),
    name: typeof flow.name === "string" ? flow.name : String(flow.id),
    status: flow.status ?? null,
    trigger: flow.trigger ?? null,
    dateCreated: flow.date_created ?? null,
    userCreated: flow.user_created ? String(flow.user_created) : null,
    lastEditedAt: lastEdited.get(String(flow.id)) ?? null
  }));
}

async function loadLastEdited(context, schema) {
  try {
    const activityService = createService(context.services.ActivityService, context, schema);
    const operationsService = createService(context.services.OperationsService, context, schema);
    const [rows, operations] = await Promise.all([
      activityService.readByQuery({
        filter: {
          _and: [
            { collection: { _in: ["directus_flows", "directus_operations"] } },
            { action: { _in: ["create", "update", "delete"] } }
          ]
        },
        fields: ["collection", "item", "timestamp"],
        sort: ["-timestamp"],
        limit: 1000
      }),
      operationsService.readByQuery({ fields: ["id", "flow"], limit: -1 })
    ]);
    const operationFlowMap = new Map(
      operations.filter((op) => op.flow).map((op) => [String(op.id), String(op.flow)])
    );
    return computeLastEdited(rows, operationFlowMap);
  } catch {
    // "Last edited" only picks the default flow; never fail the flow list over it.
    return new Map();
  }
}

async function listHistory(query, context) {
  const { current, byId, operationFlowMap, associationByActivityId } = await loadFlowCorpus(
    query.flowId,
    context
  );

  const activities = [...byId.values()].filter(isTrackedDefinitionActivity);
  const byItem = new Map();
  for (const activity of activities) {
    const key = `${activity.collection}:${activity.item}`;
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key).push(activity);
  }
  let events = activities
    .map((activity) => {
      const event = normalizeHistoryEvent(activity, {
        operationFlowMap,
        currentByEntity: current.currentByEntity,
        associationByActivityId
      });
      const previous = findPreviousSnapshotActivity(
        activity,
        byItem.get(`${activity.collection}:${activity.item}`)
      );
      const changes = changesSincePrevious(event, previous);
      return {
        ...toHistorySummary(event),
        previousId: previous ? Number(previous.id) : null,
        changedPaths: changes.map((change) => change.path)
      };
    })
    .filter((event) => event.flowId === query.flowId)
    .sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));

  if (query.action) events = events.filter((event) => event.action === query.action);
  if (query.entity) events = events.filter((event) => event.entity === query.entity);
  if (query.search) {
    const needle = query.search.toLowerCase();
    events = events.filter((event) =>
      [
        event.entityLabel,
        event.itemId,
        event.actor.label,
        event.action,
        ...event.changedFields
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }

  const total = events.length;
  const offset = (query.page - 1) * query.limit;
  return {
    items: events.slice(offset, offset + query.limit),
    page: query.page,
    limit: query.limit,
    total,
    truncated: false,
    warnings: [
      "Flow and operation edits are separate activity records.",
      "Linked operations are associated by parent revision, flow delta, current membership, or nearby timestamps.",
      "Directus delete activity has no revision snapshot.",
      "Revision snapshots omit relational graph edges (resolve/reject/flow/operation).",
      "History may be limited by activity/revision retention settings."
    ]
  };
}

async function getHistoryDetail(activityId, context) {
  const schema = await context.getSchema();
  const activity = await readActivity(activityId, context, schema);
  assertDefinitionActivity(activity, activityId);

  const itemId = String(activity.item);
  let operationFlowMap = new Map();
  const associationByActivityId = new Map();

  if (activity.collection === "directus_operations") {
    const revision = firstRevision(activity.revisions);
    const parentId = revision?.parent ? Number(revision.parent) : null;
    const embeddedFlow = revision?.delta?.flow ?? revision?.data?.flow;

    if (embeddedFlow) {
      operationFlowMap.set(itemId, String(embeddedFlow));
      associationByActivityId.set(Number(activity.id), "delta_flow");
    }

    if (parentId) {
      const parentFlowId = await resolveFlowIdFromRevisionParent(parentId, context, schema);
      if (parentFlowId) {
        operationFlowMap.set(itemId, parentFlowId);
        associationByActivityId.set(Number(activity.id), "parent_revision");
      }
    }

    if (!operationFlowMap.has(itemId)) {
      // Fall back to current membership / historical revision scan.
      operationFlowMap = await buildOperationFlowMapFallback([itemId], [activity], context, schema);
      if (operationFlowMap.has(itemId)) {
        associationByActivityId.set(Number(activity.id), "mapped");
      }
    }
  }

  const currentByEntity = await loadCurrentEntity(activity.collection, itemId, context, schema);
  const detail = normalizeHistoryDetail(activity, {
    operationFlowMap,
    currentByEntity,
    associationByActivityId
  });

  const previous = await readPreviousSnapshotActivity(activity, context, schema);
  detail.previousId = previous ? Number(previous.id) : null;
  detail.changes = changesSincePrevious(detail, previous);

  const flowId =
    detail.flowId ??
    (activity.collection === "directus_flows" ? String(activity.item) : null);

  if (flowId) {
    detail.graph = await getFlowGraph(
      { flowId, activityId: Number(activity.id), asOfTimestamp: activity.timestamp },
      context
    );
  } else {
    detail.graph = null;
  }

  return detail;
}

async function getFlowGraph(query, context) {
  const schema = await context.getSchema();
  const current = await loadCurrentDefinition(query.flowId, context, schema);
  const flow = current.currentByEntity.get(`directus_flows:${query.flowId}`) ?? null;
  const operations = [...current.operationFlowMap.keys()]
    .map((id) => current.currentByEntity.get(`directus_operations:${id}`))
    .filter(Boolean);

  if (!query.activityId && !query.asOfTimestamp) {
    return buildCurrentProjection({
      flowId: query.flowId,
      flow,
      operations
    });
  }

  const { byId } = await loadFlowCorpus(query.flowId, context);
  let asOfTimestamp = query.asOfTimestamp ?? null;

  if (query.activityId) {
    const activity = byId.get(Number(query.activityId));
    if (!activity) {
      const error = new Error(`History event "${query.activityId}" was not found for this flow.`);
      error.status = 404;
      throw error;
    }
    asOfTimestamp = activity.timestamp;
  }

  return buildDefinitionProjection({
    flowId: query.flowId,
    asOfTimestamp,
    activities: [...byId.values()]
  });
}

function changesSincePrevious(event, previousActivity) {
  const previousSnapshot = previousActivity
    ? redactValue(firstRevision(previousActivity.revisions)?.data ?? null)
    : null;
  return describeRevisionChanges({
    action: event.action,
    previousSnapshot,
    snapshot: event.snapshot,
    delta: event.delta
  });
}

async function readPreviousSnapshotActivity(activity, context, schema) {
  const service = createService(context.services.ActivityService, context, schema);
  const candidates = await service.readByQuery({
    filter: {
      _and: [
        { collection: { _eq: activity.collection } },
        { item: { _eq: String(activity.item) } },
        { action: { _in: ["create", "update"] } },
        { id: { _lt: Number(activity.id) } }
      ]
    },
    fields: ACTIVITY_FIELDS,
    sort: ["-id"],
    limit: 5
  });
  return findPreviousSnapshotActivity(activity, candidates);
}

async function compareHistory(request, context) {
  const [left, right] = await Promise.all([
    getHistoryDetail(request.leftId, context),
    getHistoryDetail(request.rightId, context)
  ]);
  if (!left.snapshot || !right.snapshot) {
    const error = new Error("Both changes need revision snapshots to compare.");
    error.status = 400;
    throw error;
  }
  return compareHistoryEvents(left, right);
}

async function loadFlowCorpus(flowId, context) {
  const schema = await context.getSchema();
  const activityService = createService(context.services.ActivityService, context, schema);
  const revisionsService = createService(context.services.RevisionsService, context, schema);
  const current = await loadCurrentDefinition(flowId, context, schema);

  const flowActivities = await activityService.readByQuery({
    filter: {
      _and: [
        { collection: { _eq: "directus_flows" } },
        { item: { _eq: flowId } },
        { action: { _in: ["create", "update", "delete"] } }
      ]
    },
    fields: ACTIVITY_FIELDS,
    sort: ["-timestamp"],
    limit: -1
  });

  const flowRevisionIds = unique(
    flowActivities.flatMap((activity) =>
      (activity.revisions ?? []).map((revision) => revision.id).filter(Boolean)
    )
  );
  const flowRevisionToFlow = new Map(
    flowActivities.flatMap((activity) =>
      (activity.revisions ?? []).map((revision) => [Number(revision.id), flowId])
    )
  );

  const childRevisions =
    flowRevisionIds.length > 0
      ? await revisionsService.readByQuery({
          filter: {
            _and: [
              { collection: { _eq: "directus_operations" } },
              { parent: { _in: flowRevisionIds } }
            ]
          },
          fields: ["id", "item", "parent", "activity", "data", "delta"],
          limit: -1
        })
      : [];

  const operationFlowMap = new Map(current.operationFlowMap);
  const associationByActivityId = new Map();
  const knownOpIds = new Set([...current.operationFlowMap.keys()]);

  for (const revision of childRevisions) {
    const opId = String(revision.item);
    knownOpIds.add(opId);
    operationFlowMap.set(opId, flowId);
    if (revision.activity != null) {
      associationByActivityId.set(Number(revision.activity), "parent_revision");
    }
  }

  let opActivities = [];
  if (knownOpIds.size > 0) {
    opActivities = await activityService.readByQuery({
      filter: {
        _and: [
          { collection: { _eq: "directus_operations" } },
          { action: { _in: ["create", "update", "delete"] } },
          { item: { _in: [...knownOpIds] } }
        ]
      },
      fields: ACTIVITY_FIELDS,
      sort: ["-timestamp"],
      limit: -1
    });
  }

  const nearbyCandidates = await fetchNearbyOperationActivities(
    activityService,
    flowActivities,
    knownOpIds
  );
  // The time window is only a guess: drop operations that still exist and belong to another flow.
  const otherFlowOps = await findOperationsInOtherFlows(
    unique(nearbyCandidates.map((activity) => String(activity.item))),
    flowId,
    createService(context.services.OperationsService, context, schema)
  );
  const nearbyOps = nearbyCandidates.filter((activity) => !otherFlowOps.has(String(activity.item)));
  for (const activity of nearbyOps) {
    const opId = String(activity.item);
    knownOpIds.add(opId);
    if (!operationFlowMap.has(opId)) operationFlowMap.set(opId, flowId);
    associationByActivityId.set(Number(activity.id), "time_window");
  }

  const byId = new Map();
  for (const activity of [...flowActivities, ...opActivities, ...nearbyOps]) {
    byId.set(Number(activity.id), activity);
  }

  for (const activity of byId.values()) {
    if (activity.collection !== "directus_operations") continue;
    const revision = firstRevision(activity.revisions);
    const flow = revision?.delta?.flow ?? revision?.data?.flow;
    if (flow) {
      operationFlowMap.set(String(activity.item), String(flow));
      if (!associationByActivityId.has(Number(activity.id))) {
        associationByActivityId.set(Number(activity.id), "delta_flow");
      }
    }
    const parentId = revision?.parent ? Number(revision.parent) : null;
    if (parentId && flowRevisionToFlow.has(parentId)) {
      operationFlowMap.set(String(activity.item), flowRevisionToFlow.get(parentId));
      associationByActivityId.set(Number(activity.id), "parent_revision");
    }
  }

  return { current, byId, operationFlowMap, associationByActivityId };
}

export async function findOperationsInOtherFlows(operationIds, flowId, operationsService) {
  if (operationIds.length === 0) return new Set();
  const operations = await operationsService.readByQuery({
    filter: { id: { _in: operationIds } },
    fields: ["id", "flow"],
    limit: -1
  });
  return new Set(
    operations
      .filter((operation) => operation.flow && String(operation.flow) !== String(flowId))
      .map((operation) => String(operation.id))
  );
}

async function fetchNearbyOperationActivities(activityService, flowActivities, knownOpIds) {
  if (flowActivities.length === 0) return [];

  const timestamps = flowActivities
    .map((activity) => Date.parse(activity.timestamp))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return [];

  const min = new Date(Math.min(...timestamps) - TIME_WINDOW_MS).toISOString();
  const max = new Date(Math.max(...timestamps) + TIME_WINDOW_MS).toISOString();

  const nearby = await activityService.readByQuery({
    filter: {
      _and: [
        { collection: { _eq: "directus_operations" } },
        { action: { _in: ["create", "update", "delete"] } },
        { timestamp: { _between: [min, max] } }
      ]
    },
    fields: ACTIVITY_FIELDS,
    sort: ["-timestamp"],
    limit: 500
  });

  const flowTimes = timestamps.sort((a, b) => a - b);
  return nearby.filter((activity) => {
    const opId = String(activity.item);
    if (knownOpIds.has(opId)) return false;
    const time = Date.parse(activity.timestamp);
    if (!Number.isFinite(time)) return false;
    return flowTimes.some((flowTime) => Math.abs(flowTime - time) <= TIME_WINDOW_MS);
  });
}

async function resolveFlowIdFromRevisionParent(parentRevisionId, context, schema) {
  const revisionsService = createService(context.services.RevisionsService, context, schema);
  try {
    const parent = await revisionsService.readOne(parentRevisionId, {
      fields: ["id", "collection", "item"]
    });
    if (parent.collection === "directus_flows") return String(parent.item);
  } catch {
    // Parent may have been purged by retention.
  }
  return null;
}

async function buildOperationFlowMapFallback(operationIds, activities, context, schema) {
  const map = new Map();
  for (const activity of activities) {
    const revision = firstRevision(activity.revisions);
    const flow = revision?.delta?.flow ?? revision?.data?.flow;
    if (flow) map.set(String(activity.item), String(flow));
  }

  const unresolved = operationIds.filter((id) => !map.has(id));
  if (unresolved.length === 0) return map;

  const revisionsService = createService(context.services.RevisionsService, context, schema);
  const revisions = await revisionsService.readByQuery({
    filter: {
      _and: [
        { collection: { _eq: "directus_operations" } },
        { item: { _in: unresolved } }
      ]
    },
    fields: ["item", "data", "delta", "parent"],
    sort: ["-id"],
    limit: -1
  });

  for (const revision of revisions) {
    const id = String(revision.item);
    if (map.has(id)) continue;
    const flow = revision.delta?.flow ?? revision.data?.flow;
    if (flow) {
      map.set(id, String(flow));
      continue;
    }
    if (revision.parent) {
      const parentFlowId = await resolveFlowIdFromRevisionParent(
        Number(revision.parent),
        context,
        schema
      );
      if (parentFlowId) map.set(id, parentFlowId);
    }
  }

  // Current ops membership as last resort.
  const operationsService = createService(context.services.OperationsService, context, schema);
  const stillMissing = unresolved.filter((id) => !map.has(id));
  if (stillMissing.length > 0) {
    const currentOps = await operationsService.readByQuery({
      filter: { id: { _in: stillMissing } },
      fields: ["id", "flow"],
      limit: -1
    });
    for (const operation of currentOps) {
      if (operation.flow) map.set(String(operation.id), String(operation.flow));
    }
  }

  return map;
}

async function readActivity(activityId, context, schema) {
  const service = createService(context.services.ActivityService, context, schema);
  try {
    return await service.readOne(activityId, { fields: ACTIVITY_FIELDS });
  } catch {
    const error = new Error(`History event "${activityId}" was not found.`);
    error.status = 404;
    throw error;
  }
}

function assertDefinitionActivity(activity, id) {
  if (!isTrackedDefinitionActivity(activity)) {
    const error = new Error(`Activity "${id}" is not a flow definition change.`);
    error.status = 404;
    throw error;
  }
}

async function loadCurrentDefinition(flowId, context, schema) {
  const currentByEntity = new Map();
  const operationFlowMap = new Map();
  const flowsService = createService(context.services.FlowsService, context, schema);
  const operationsService = createService(context.services.OperationsService, context, schema);

  try {
    const flow = await flowsService.readOne(flowId, { fields: ["*"] });
    currentByEntity.set(`directus_flows:${flowId}`, flow);
  } catch {
    // A deleted flow can still have history.
  }

  const operations = await operationsService.readByQuery({
    filter: { flow: { _eq: flowId } },
    fields: ["*"],
    limit: -1
  });
  for (const operation of operations) {
    const id = String(operation.id);
    currentByEntity.set(`directus_operations:${id}`, operation);
    operationFlowMap.set(id, flowId);
  }

  return { currentByEntity, operationFlowMap };
}

async function loadCurrentEntity(collection, itemId, context, schema) {
  const currentByEntity = new Map();
  const Service =
    collection === "directus_flows"
      ? context.services.FlowsService
      : context.services.OperationsService;
  const service = createService(Service, context, schema);
  try {
    const current = await service.readOne(itemId, { fields: ["*"] });
    currentByEntity.set(`${collection}:${itemId}`, current);
  } catch {
    // Deleted entities intentionally have no current item.
  }
  return currentByEntity;
}

function createService(Service, context, schema) {
  return new Service({
    schema,
    accountability: null,
    knex: context.database
  });
}

function firstRevision(revisions) {
  return Array.isArray(revisions) && revisions.length > 0 ? revisions[0] : null;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== void 0))];
}

export {
  compareHistory,
  getFlowGraph,
  getHistoryDetail,
  listFlows,
  listHistory
};
