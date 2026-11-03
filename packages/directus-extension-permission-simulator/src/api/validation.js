const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = ["create", "read", "update", "delete"];
function isUuid(value) {
  return UUID_RE.test(value);
}
function isPermissionAction(value) {
  return ACTIONS.includes(value);
}
function getPermissionActions() {
  return [...ACTIONS];
}
function assertAdmin(accountability) {
  if (!accountability?.admin) {
    const error = new Error("Administrator access is required to use Permission Simulator.");
    error.status = 403;
    throw error;
  }
}
function parseSimulateRequest(body) {
  if (!body || typeof body !== "object") {
    throw validationError("Request body must be a JSON object.");
  }
  const input = body;
  const mode = input.mode;
  if (mode !== "user" && mode !== "role") {
    throw validationError('mode must be either "user" or "role".');
  }
  const principalId = requireUuid(input.principalId, "principalId");
  const context = parseSharedContext(input);
  return {
    mode,
    principalId,
    ...context
  };
}
function parseCompareRequest(body) {
  if (!body || typeof body !== "object") {
    throw validationError("Request body must be a JSON object.");
  }
  const input = body;
  const leftRoleId = requireUuid(input.leftRoleId, "leftRoleId");
  const rightRoleId = requireUuid(input.rightRoleId, "rightRoleId");
  const context = parseSharedContext(input);
  return {
    leftRoleId,
    rightRoleId,
    ...context
  };
}
function normalizeAccessLevel(access) {
  if (access === "partial" || access === "full") return access;
  return "none";
}
function parseSharedContext(input) {
  const context = {};
  if (input.collection !== void 0 && input.collection !== null && input.collection !== "") {
    if (typeof input.collection !== "string") {
      throw validationError("collection must be a string.");
    }
    const collection = input.collection.trim();
    if (!/^[a-zA-Z0-9_]+$/.test(collection)) {
      throw validationError("collection contains invalid characters.");
    }
    context.collection = collection;
  }
  if (input.primaryKey !== void 0 && input.primaryKey !== null && input.primaryKey !== "") {
    if (typeof input.primaryKey !== "string" && typeof input.primaryKey !== "number") {
      throw validationError("primaryKey must be a string or number.");
    }
    context.primaryKey = String(input.primaryKey).trim();
  }
  if (input.fields !== void 0 && input.fields !== null) {
    if (!Array.isArray(input.fields) || input.fields.some((field) => typeof field !== "string")) {
      throw validationError("fields must be an array of strings.");
    }
    context.fields = input.fields.map((field) => field.trim()).filter(Boolean);
  }
  if (context.primaryKey && !context.collection) {
    throw validationError("collection is required when primaryKey is provided.");
  }
  return context;
}
function requireUuid(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(`${field} is required.`);
  }
  const trimmed = value.trim();
  if (!isUuid(trimmed)) {
    throw validationError(`${field} must be a valid UUID.`);
  }
  return trimmed;
}
function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
export {
  assertAdmin,
  getPermissionActions,
  isPermissionAction,
  isUuid,
  normalizeAccessLevel,
  parseCompareRequest,
  parseSimulateRequest
};
