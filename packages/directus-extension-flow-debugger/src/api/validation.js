const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = ["resolve", "reject", "unknown"];
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function assertAdmin(accountability) {
  if (!accountability?.admin) {
    const error = new Error("Administrator access is required to use Flow Debugger.");
    error.status = 403;
    throw error;
  }
}

function parseExecutionsQuery(query = {}) {
  const input = query && typeof query === "object" ? query : {};
  const result = {
    page: 1,
    limit: DEFAULT_LIMIT,
    flowId: null,
    status: null,
    search: null
  };

  if (input.page !== void 0 && input.page !== null && input.page !== "") {
    const page = Number(input.page);
    if (!Number.isInteger(page) || page < 1) {
      throw validationError("page must be a positive integer.");
    }
    result.page = page;
  }

  if (input.limit !== void 0 && input.limit !== null && input.limit !== "") {
    const limit = Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw validationError(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
    }
    result.limit = limit;
  }

  if (input.flowId !== void 0 && input.flowId !== null && input.flowId !== "") {
    if (typeof input.flowId !== "string" || !isUuid(input.flowId.trim())) {
      throw validationError("flowId must be a valid UUID.");
    }
    result.flowId = input.flowId.trim();
  }

  if (input.status !== void 0 && input.status !== null && input.status !== "") {
    if (typeof input.status !== "string" || !STATUSES.includes(input.status)) {
      throw validationError('status must be one of "resolve", "reject", or "unknown".');
    }
    result.status = input.status;
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

function parseExecutionId(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw validationError("Execution id is required.");
  }
  const id = String(value).trim();
  if (!/^\d+$/.test(id)) {
    throw validationError("Execution id must be a numeric activity id.");
  }
  return Number(id);
}

function parseCompareQuery(query = {}) {
  const input = query && typeof query === "object" ? query : {};
  const baselineId = parseExecutionId(input.baselineId);
  const comparisonId = parseExecutionId(input.comparisonId);

  if (baselineId === comparisonId) {
    throw validationError("Select two different executions to compare.");
  }

  return { baselineId, comparisonId };
}

function getKnownStatuses() {
  return [...STATUSES];
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export {
  assertAdmin,
  getKnownStatuses,
  isUuid,
  parseCompareQuery,
  parseExecutionId,
  parseExecutionsQuery
};
