// Values of the Action enum in @directus/constants.
export const ACTIONS = [
  "create",
  "update",
  "delete",
  "revert",
  "version_save",
  "comment",
  "upload",
  "login",
  "logout",
  "run",
  "install"
];

export const KNOWN_SYSTEM_COLLECTIONS = new Set([
  "directus_access",
  "directus_activity",
  "directus_collections",
  "directus_comments",
  "directus_dashboards",
  "directus_deployments",
  "directus_extensions",
  "directus_fields",
  "directus_files",
  "directus_flows",
  "directus_folders",
  "directus_migrations",
  "directus_notifications",
  "directus_operations",
  "directus_panels",
  "directus_permissions",
  "directus_policies",
  "directus_presets",
  "directus_relations",
  "directus_revisions",
  "directus_roles",
  "directus_sessions",
  "directus_settings",
  "directus_shares",
  "directus_translations",
  "directus_users",
  "directus_versions",
  "directus_webhooks"
]);

export const DEFAULT_BATCH_SIZE = 500;
export const MAX_BATCH_SIZE = 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function parseIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value.trim())) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Validate the shape of a purge request. Whether the collection exists is checked by the engine.
 */
export function parsePurgeRequest(body, { defaultBatchSize = DEFAULT_BATCH_SIZE } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "Request body must be a JSON object.");

  const collection = typeof body.collection === "string" ? body.collection.trim() : "";
  if (!collection || collection.length > 128 || /[\u0000-\u001f]/.test(collection)) {
    throw httpError(400, "\"collection\" must be a non-empty collection name.");
  }

  let action = null;
  if (body.action !== undefined && body.action !== null && body.action !== "") {
    if (!ACTIONS.includes(body.action)) throw httpError(400, `"action" must be one of: ${ACTIONS.join(", ")}.`);
    action = body.action;
  }

  let olderThan = null;
  if (body.olderThan !== undefined && body.olderThan !== null && body.olderThan !== "") {
    olderThan = parseIsoDate(body.olderThan);
    if (!olderThan) throw httpError(400, "\"olderThan\" must be an ISO 8601 date, e.g. 2025-01-31 or 2025-01-31T00:00:00Z.");
  }

  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") throw httpError(400, "\"dryRun\" must be a boolean.");
  const dryRun = body.dryRun !== false;

  let batchSize = clampBatch(defaultBatchSize);
  if (body.batchSize !== undefined && body.batchSize !== null) {
    if (!Number.isInteger(body.batchSize) || body.batchSize < 1 || body.batchSize > MAX_BATCH_SIZE) {
      throw httpError(400, `"batchSize" must be an integer between 1 and ${MAX_BATCH_SIZE}.`);
    }
    batchSize = body.batchSize;
  }

  if (!dryRun && body.confirm !== collection) {
    throw httpError(400, "Type the collection name into \"confirm\" to run a real purge.");
  }

  return { collection, action, olderThan, dryRun, batchSize };
}

function clampBatch(value) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(number, MAX_BATCH_SIZE);
}
