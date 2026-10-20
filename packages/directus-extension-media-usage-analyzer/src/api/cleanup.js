import { isUuid, normalizeId } from "./content-references.js";

export const MAX_DELETE_IDS = 1000;
export const DELETE_BATCH_SIZE = 100;

export function validateDeleteRequest(body) {
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) throw badRequest("Provide a non-empty `ids` array of file ids.");
  if (ids.length > MAX_DELETE_IDS) throw badRequest(`At most ${MAX_DELETE_IDS} files can be processed per request.`);
  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") throw badRequest("`dryRun` must be a boolean.");
  return { ids, dryRun: body.dryRun !== false };
}

/**
 * Re-verifies and deletes files batch by batch. Every batch is checked for existence and references
 * immediately before it is deleted, so files that became used since the scan are skipped.
 *
 * @param {{ ids: unknown[], dryRun: boolean }} request
 * @param {object} deps
 * @param {(ids: string[]) => Promise<Set<string>>} deps.findExisting lower-cased ids that still exist
 * @param {(ids: string[]) => Promise<{ references: Map<string, string[]>, unverified?: string|null }>} deps.findReferences
 * @param {(ids: string[]) => Promise<void>} deps.deleteFiles
 */
export async function processDeletion({ ids, dryRun }, deps, batchSize = DELETE_BATCH_SIZE) {
  const results = [];
  const seen = new Set();
  const candidates = [];

  for (const raw of ids) {
    const id = normalizeId(raw);
    if (!isUuid(id)) {
      results.push({ id: String(raw), status: "invalid", message: "Not a valid file id." });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    candidates.push(id);
  }

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);

    try {
      const existing = await deps.findExisting(batch);
      const present = batch.filter((id) => existing.has(id));
      for (const id of batch) if (!existing.has(id)) results.push({ id, status: "not_found", message: "File no longer exists." });
      if (present.length === 0) continue;

      const { references, unverified } = await deps.findReferences(present);
      if (unverified) {
        for (const id of present) results.push({ id, status: "unverified", message: unverified });
        continue;
      }

      const deletable = [];
      for (const id of present) {
        const usedBy = references.get(id);
        if (usedBy?.length) results.push({ id, status: "in_use", references: usedBy, message: `Still referenced by ${usedBy.join(", ")}.` });
        else deletable.push(id);
      }
      if (deletable.length === 0) continue;

      if (dryRun) {
        for (const id of deletable) results.push({ id, status: "would_delete" });
        continue;
      }

      await deps.deleteFiles(deletable);
      for (const id of deletable) results.push({ id, status: "deleted" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error.";
      const done = new Set(results.map((result) => result.id));
      for (const id of batch) if (!done.has(id)) results.push({ id, status: "error", message });
    }
  }

  const summary = {};
  for (const result of results) summary[result.status] = (summary[result.status] ?? 0) + 1;
  return { dryRun, summary, results };
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
