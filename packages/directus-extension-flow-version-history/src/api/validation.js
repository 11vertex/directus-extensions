const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = ["create", "update", "delete"];
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function assertAdmin(accountability) {
  if (!accountability?.admin) {
    const error = new Error(
      "Administrator access is required to use Flow Version History."
    );
    error.status = 403;
    throw error;
  }
}

function parseHistoryQuery(query = {}) {
  const input = query && typeof query === "object" ? query : {};
  const flowId = requireUuid(input.flowId, "flowId");
  const result = {
    flowId,
    page: parsePositiveInteger(input.page, "page", 1),
    limit: parsePositiveInteger(input.limit, "limit", DEFAULT_LIMIT, MAX_LIMIT),
    action: null,
    entity: null,
    search: null
  };

  if (input.action !== void 0 && input.action !== null && input.action !== "") {
    if (typeof input.action !== "string" || !ACTIONS.includes(input.action)) {
      throw validationError('action must be "create", "update", or "delete".');
    }
    result.action = input.action;
  }

  if (input.entity !== void 0 && input.entity !== null && input.entity !== "") {
    if (input.entity !== "flow" && input.entity !== "operation") {
      throw validationError('entity must be "flow" or "operation".');
    }
    result.entity = input.entity;
  }

  if (input.search !== void 0 && input.search !== null && input.search !== "") {
    if (typeof input.search !== "string") {
      throw validationError("search must be a string.");
    }
    const search = input.search.trim();
    if (search.length > 200) {
      throw validationError("search must be at most 200 characters.");
    }
    result.search = search || null;
  }

  return result;
}

function parseActivityId(value, field = "activityId") {
  if (typeof value !== "string" && typeof value !== "number") {
    throw validationError(`${field} is required.`);
  }
  const id = String(value).trim();
  if (!/^\d+$/.test(id)) {
    throw validationError(`${field} must be a numeric activity id.`);
  }
  return Number(id);
}

function parseCompareQuery(query = {}) {
  const input = query && typeof query === "object" ? query : {};
  const leftId = parseActivityId(input.leftId, "leftId");
  const rightId = parseActivityId(input.rightId, "rightId");
  if (leftId === rightId) {
    throw validationError("Select two different revisions to compare.");
  }
  return { leftId, rightId };
}

function parseGraphQuery(query = {}) {
  const input = query && typeof query === "object" ? query : {};
  const flowId = requireUuid(input.flowId, "flowId");
  const result = {
    flowId,
    activityId: null,
    asOfTimestamp: null
  };

  if (input.activityId !== void 0 && input.activityId !== null && input.activityId !== "") {
    result.activityId = parseActivityId(input.activityId, "activityId");
  }

  if (input.asOf !== void 0 && input.asOf !== null && input.asOf !== "") {
    if (typeof input.asOf !== "string") {
      throw validationError("asOf must be an ISO timestamp string.");
    }
    const parsed = Date.parse(input.asOf);
    if (!Number.isFinite(parsed)) {
      throw validationError("asOf must be a valid ISO timestamp.");
    }
    result.asOfTimestamp = new Date(parsed).toISOString();
  }

  return result;
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) {
    throw validationError(`${field} must be a valid UUID.`);
  }
  return value.trim();
}

function parsePositiveInteger(value, field, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (value === void 0 || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw validationError(`${field} must be an integer between 1 and ${max}.`);
  }
  return parsed;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export {
  assertAdmin,
  parseActivityId,
  parseCompareQuery,
  parseGraphQuery,
  parseHistoryQuery
};
