import { analyzeMedia } from "./analyzer.js";
import { processDeletion } from "./cleanup.js";
import { ASSET_MARKER, extractAssetIds, normalizeId } from "./content-references.js";
import { FILES_COLLECTION, getContentFields, getFileFields, getFileReferenceSources } from "./reference-sources.js";

export const PAGE_SIZE = 500;
// Upper bound of rows read per content field, so one huge table cannot stall the scan.
export const CONTENT_ROW_LIMIT = 20_000;
// Deletion re-verification reads further before giving up, since it must be certain.
export const VERIFY_ROW_LIMIT = 100_000;

export async function runScan(context, options = {}) {
  const schema = await context.getSchema();
  const warnings = [];
  const { fields, checksumField } = getFileFields(schema);

  const files = await readPaged(itemsFor(context, schema, FILES_COLLECTION, "FilesService"), { fields, sort: ["id"] });
  const folders = await readFolders(context, schema, warnings);

  const sources = [];
  for (const source of getFileReferenceSources(schema)) {
    try {
      sources.push({ ...source, references: await countReferences(context, schema, source) });
    } catch (error) {
      warnings.push(`Could not read ${source.label}: ${messageOf(error)}`);
    }
  }

  if (options.content) {
    for (const field of getContentFields(schema, sources)) {
      try {
        const { references, truncated } = await scanContent(context, schema, field, { rowLimit: CONTENT_ROW_LIMIT });
        if (truncated) warnings.push(`Content scan of ${field.collection}.${field.field} stopped after ${CONTENT_ROW_LIMIT} rows.`);
        if (references.size > 0 || truncated) sources.push({ ...field, references, truncated });
      } catch (error) {
        warnings.push(`Could not scan content of ${field.collection}.${field.field}: ${messageOf(error)}`);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    options: { content: Boolean(options.content) },
    ...analyzeMedia({ files, folders, sources, checksumField, contentScanned: Boolean(options.content), warnings })
  };
}

export async function deleteUnusedFiles(context, { ids, dryRun, accountability }) {
  const schema = await context.getSchema();
  const sources = getFileReferenceSources(schema);
  const contentFields = getContentFields(schema, sources);
  const files = itemsFor(context, schema, FILES_COLLECTION, "FilesService");

  return processDeletion({ ids, dryRun }, {
    async findExisting(batch) {
      const rows = await files.readByQuery({ fields: ["id"], filter: { id: { _in: batch } }, limit: batch.length });
      return new Set(rows.map((row) => normalizeId(row.id)));
    },
    async findReferences(batch) {
      const references = new Map();
      const add = (id, label) => references.set(id, [...new Set([...(references.get(id) ?? []), label])]);
      const wanted = new Set(batch);

      for (const source of sources) {
        const counts = await countReferences(context, schema, source, { [source.field]: { _in: batch } });
        for (const id of counts.keys()) if (wanted.has(normalizeId(id))) add(normalizeId(id), source.label);
      }

      for (const field of contentFields) {
        const extra = field.json ? null : { _or: batch.map((id) => ({ [field.field]: { _icontains: id } })) };
        const { references: found, truncated } = await scanContent(context, schema, field, { rowLimit: VERIFY_ROW_LIMIT, extraFilter: extra });
        if (truncated) return { references, unverified: `Content of ${field.collection}.${field.field} is too large to verify; nothing in this batch was deleted.` };
        for (const id of found.keys()) if (wanted.has(id)) add(id, field.label);
      }

      return { references, unverified: null };
    },
    async deleteFiles(batch) {
      // Use the admin's accountability so the deletion is attributed in the activity log.
      const service = new context.services.FilesService({ schema, accountability, knex: context.database });
      await service.deleteMany(batch);
    }
  });
}

/** Map<fileId, referenceCount> for one file column, using GROUP BY when possible and paging otherwise. */
async function countReferences(context, schema, source, extraFilter = null) {
  const service = itemsFor(context, schema, source.collection);
  const conditions = [{ [source.field]: { _nnull: true } }];
  if (source.collectionField) conditions.push({ [source.collectionField]: { _eq: FILES_COLLECTION } });
  if (extraFilter) conditions.push(extraFilter);
  const filter = { _and: conditions };
  const counts = new Map();

  try {
    const rows = await readPaged(service, { filter, group: [source.field], aggregate: { count: ["*"] }, sort: [source.field] });
    for (const row of rows) addCount(counts, row[source.field], countOf(row));
    return counts;
  } catch {
    counts.clear();
  }

  // Fallback for databases/fields where grouping is not supported: page through the raw values.
  const rows = await readPaged(service, { filter, fields: [source.primary, source.field], sort: [source.primary] });
  for (const row of rows) addCount(counts, row[source.field], 1);
  return counts;
}

/** Map<fileId, occurrences> of `/assets/<uuid>` links found in one text/JSON field. */
async function scanContent(context, schema, field, { rowLimit, extraFilter = null }) {
  const service = itemsFor(context, schema, field.collection);
  const conditions = [field.json ? { [field.field]: { _nnull: true } } : { [field.field]: { _contains: ASSET_MARKER } }];
  if (extraFilter) conditions.push(extraFilter);

  const references = new Map();
  let truncated = false;

  await readPaged(service, { filter: { _and: conditions }, fields: [field.primary, field.field], sort: [field.primary] }, {
    maxRows: rowLimit,
    onTruncate: () => (truncated = true),
    onPage(rows) {
      for (const row of rows) for (const id of extractAssetIds(row[field.field])) addCount(references, id, 1);
    }
  });

  return { references, truncated };
}

async function readFolders(context, schema, warnings) {
  if (!schema.collections.directus_folders || !context.services.FoldersService) return [];
  try {
    return await readPaged(itemsFor(context, schema, "directus_folders", "FoldersService"), { fields: ["id", "name"], sort: ["id"] });
  } catch (error) {
    warnings.push(`Could not read folders: ${messageOf(error)}`);
    return [];
  }
}

/** Reads a query in pages of PAGE_SIZE. With `onPage`, rows are streamed instead of collected. */
async function readPaged(service, query, { maxRows = Infinity, onPage, onTruncate } = {}) {
  const collected = [];
  let read = 0;

  for (let page = 1; ; page += 1) {
    const rows = await service.readByQuery({ ...query, limit: PAGE_SIZE, page });
    read += rows.length;
    if (onPage) onPage(rows);
    else collected.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    if (read >= maxRows) {
      onTruncate?.();
      break;
    }
  }

  return collected;
}

function itemsFor(context, schema, collection, serviceName = null) {
  const options = { schema, accountability: null, knex: context.database };
  const Service = serviceName ? context.services[serviceName] : null;
  return Service ? new Service(options) : new context.services.ItemsService(collection, options);
}

function addCount(map, value, count) {
  const id = normalizeId(value);
  if (id) map.set(id, (map.get(id) ?? 0) + count);
}

function countOf(row) {
  const value = row.count;
  if (value && typeof value === "object") return Number(Object.values(value)[0]) || 0;
  return Number(value) || 0;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
