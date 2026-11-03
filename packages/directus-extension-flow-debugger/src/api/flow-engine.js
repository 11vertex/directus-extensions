import {
  compareExecutionDetails,
  normalizeExecutionDetail,
  normalizeExecutionSummary
} from "./normalize.js";

async function listFlows(context) {
  const schema = await context.getSchema();
  const flowsService = new context.services.FlowsService({
    schema,
    accountability: null,
    knex: context.database
  });

  const flows = await flowsService.readByQuery({
    fields: [
      "id",
      "name",
      "status",
      "trigger",
      "accountability",
      "icon",
      "color",
      "date_created"
    ],
    sort: ["name"],
    limit: -1
  });

  return flows.map((flow) => ({
    id: String(flow.id),
    name: typeof flow.name === "string" ? flow.name : String(flow.id),
    status: flow.status ?? null,
    trigger: flow.trigger ?? null,
    accountability: flow.accountability ?? null,
    icon: flow.icon ?? null,
    color: flow.color ?? null,
    dateCreated: flow.date_created ?? null,
    detailLogging: flow.accountability === "all"
  }));
}

async function listExecutions(query, context) {
  const schema = await context.getSchema();
  const activityService = new context.services.ActivityService({
    schema,
    accountability: null,
    knex: context.database
  });

  const flowMap = await loadFlowMap(context, schema);
  const filter = {
    _and: [
      { action: { _eq: "run" } },
      { collection: { _eq: "directus_flows" } }
    ]
  };

  if (query.flowId) {
    filter._and.push({ item: { _eq: query.flowId } });
  }

  // When filtering by derived status we over-fetch, then page in memory.
  const needsDerivedFilter = Boolean(query.status || query.search);
  const fetchLimit = needsDerivedFilter ? Math.min(query.limit * query.page + 200, 500) : query.limit;
  const fetchPage = needsDerivedFilter ? 1 : query.page;

  const activities = await activityService.readByQuery({
    filter,
    fields: [
      "id",
      "action",
      "timestamp",
      "user",
      "ip",
      "user_agent",
      "origin",
      "collection",
      "item",
      "revisions.id",
      "revisions.data"
    ],
    sort: ["-timestamp"],
    limit: fetchLimit,
    page: fetchPage
  });

  let summaries = activities.map((activity) => normalizeExecutionSummary(activity, flowMap));

  if (query.status) {
    summaries = summaries.filter((entry) => entry.finalStatus === query.status);
  }

  if (query.search) {
    const needle = query.search.toLowerCase();
    summaries = summaries.filter((entry) => {
      const haystack = [
        entry.flowName,
        entry.flowId,
        entry.userId,
        entry.origin,
        entry.failedStepKey,
        String(entry.id)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  const total = summaries.length;
  const offset = (query.page - 1) * query.limit;
  const items = needsDerivedFilter
    ? summaries.slice(offset, offset + query.limit)
    : summaries;

  return {
    items,
    page: query.page,
    limit: query.limit,
    total: needsDerivedFilter ? total : null,
    truncated: needsDerivedFilter && activities.length >= fetchLimit,
    warnings: [
      "Native Directus history only contains completed runs.",
      'Step details require the flow accountability setting "All".',
      "Duration and live in-progress monitoring are not available from native logs."
    ]
  };
}

async function getExecution(activityId, context) {
  const schema = await context.getSchema();
  const activityService = new context.services.ActivityService({
    schema,
    accountability: null,
    knex: context.database
  });

  let activity;
  try {
    activity = await activityService.readOne(activityId, {
      fields: [
        "id",
        "action",
        "timestamp",
        "user",
        "ip",
        "user_agent",
        "origin",
        "collection",
        "item",
        "revisions.id",
        "revisions.data"
      ]
    });
  } catch {
    const error = new Error(`Execution "${activityId}" was not found.`);
    error.status = 404;
    throw error;
  }

  if (activity.action !== "run" || activity.collection !== "directus_flows") {
    const error = new Error(`Activity "${activityId}" is not a flow execution.`);
    error.status = 404;
    throw error;
  }

  const flowMap = await loadFlowMap(context, schema);
  const operationsMap = await loadOperationsMap(activity.item, context, schema);
  return normalizeExecutionDetail(activity, flowMap, operationsMap);
}

async function compareExecutions(request, context) {
  const [baseline, comparison] = await Promise.all([
    getExecution(request.baselineId, context),
    getExecution(request.comparisonId, context)
  ]);

  if (baseline.flowId !== comparison.flowId) {
    const error = new Error("Executions must belong to the same flow.");
    error.status = 400;
    throw error;
  }

  if (!baseline.hasDetails || !comparison.hasDetails) {
    const error = new Error(
      'Both executions need step details. Set flow accountability to "All" before running the flow.'
    );
    error.status = 400;
    throw error;
  }

  return compareExecutionDetails(baseline, comparison);
}

async function loadFlowMap(context, schema) {
  const flowsService = new context.services.FlowsService({
    schema,
    accountability: null,
    knex: context.database
  });
  const flows = await flowsService.readByQuery({
    fields: ["id", "name", "accountability", "status", "trigger"],
    limit: -1
  });
  return new Map(
    flows.map((flow) => [
      String(flow.id),
      {
        id: String(flow.id),
        name: typeof flow.name === "string" ? flow.name : String(flow.id),
        accountability: flow.accountability ?? null,
        status: flow.status ?? null,
        trigger: flow.trigger ?? null
      }
    ])
  );
}

async function loadOperationsMap(flowId, context, schema) {
  if (!flowId) return /* @__PURE__ */ new Map();
  const operationsService = new context.services.OperationsService({
    schema,
    accountability: null,
    knex: context.database
  });
  const operations = await operationsService.readByQuery({
    filter: { flow: { _eq: flowId } },
    fields: ["id", "name", "key", "type"],
    limit: -1
  });
  return new Map(
    operations.map((operation) => [
      String(operation.id),
      {
        id: String(operation.id),
        name: typeof operation.name === "string" ? operation.name : null,
        key: typeof operation.key === "string" ? operation.key : null,
        type: typeof operation.type === "string" ? operation.type : null
      }
    ])
  );
}

export {
  compareExecutions,
  getExecution,
  listExecutions,
  listFlows
};
