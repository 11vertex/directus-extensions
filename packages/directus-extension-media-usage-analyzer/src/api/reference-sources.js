export const FILES_COLLECTION = "directus_files";

// Optional checksum-like columns some projects add to directus_files. Directus itself stores none.
const CHECKSUM_FIELDS = ["checksum", "hash", "md5", "sha1", "sha256", "file_hash"];

// Columns read for every file, filtered against the live schema so older/newer versions still work.
const FILE_FIELDS = ["id", "filename_download", "title", "type", "filesize", "width", "height", "folder", "uploaded_on", "storage"];

const CONTENT_TYPES = new Set(["string", "text"]);
const JSON_TYPES = new Set(["json"]);

// System collections whose contents are logs or history; scanning them would mark every file as used.
const NON_CONTENT_COLLECTIONS = /^directus_/;

/**
 * Every column that stores a directus_files primary key, derived from schema.relations:
 * - M2O file/image fields (including system ones such as directus_users.avatar and directus_settings.project_logo)
 * - junction collections behind M2M "files" fields
 * - M2A junctions that allow directus_files
 */
export function getFileReferenceSources(schema) {
  const relations = schema?.relations ?? [];
  const collections = schema?.collections ?? {};
  const sources = [];

  for (const relation of relations) {
    const { collection, field } = relation;
    const info = collections[collection];
    if (!info?.fields?.[field]) continue;

    const allowed = relation.meta?.one_allowed_collections;
    const isM2a = !relation.related_collection && Array.isArray(allowed) && allowed.includes(FILES_COLLECTION);
    if (relation.related_collection !== FILES_COLLECTION && !isM2a) continue;

    const junctionField = relation.meta?.junction_field;
    const parent = junctionField
      ? relations.find((entry) => entry.collection === collection && entry.field === junctionField)
      : null;
    const parentCollection = parent?.related_collection ?? null;
    const parentField = parent?.meta?.one_field ?? null;
    const kind = isM2a ? "m2a" : parent ? "junction" : "m2o";

    sources.push({
      id: `${collection}.${field}`,
      collection,
      field,
      primary: info.primary,
      kind,
      system: collection.startsWith("directus_"),
      usageCollection: parentCollection ?? collection,
      usageField: parentCollection && parentField ? parentField : field,
      label: parentCollection && parentField
        ? `${parentCollection}.${parentField} (via ${collection})`
        : `${collection}.${field}`,
      collectionField: isM2a ? relation.meta?.one_collection_field ?? null : null
    });
  }

  return sources.filter((source) => source.kind !== "m2a" || source.collectionField);
}

/** Text-like fields of user collections that may embed `/assets/<uuid>` links (WYSIWYG, markdown, JSON blocks). */
export function getContentFields(schema, sources = []) {
  const relational = new Set(sources.map((source) => source.id));
  for (const relation of schema?.relations ?? []) {
    relational.add(`${relation.collection}.${relation.field}`);
    if (relation.meta?.one_collection_field) relational.add(`${relation.collection}.${relation.meta.one_collection_field}`);
  }
  const fields = [];

  for (const [collection, info] of Object.entries(schema?.collections ?? {})) {
    if (NON_CONTENT_COLLECTIONS.test(collection)) continue;

    for (const [field, definition] of Object.entries(info.fields ?? {})) {
      if (field === info.primary || definition.alias || relational.has(`${collection}.${field}`)) continue;
      if ((definition.special ?? []).some((special) => special === "conceal" || special === "hash")) continue;
      const json = JSON_TYPES.has(definition.type);
      if (!json && !CONTENT_TYPES.has(definition.type)) continue;

      fields.push({
        id: `${collection}.${field}`,
        collection,
        field,
        primary: info.primary,
        json,
        kind: "content",
        system: false,
        usageCollection: collection,
        usageField: field,
        label: `${collection}.${field} (content)`
      });
    }
  }

  return fields;
}

export function getFileFields(schema) {
  const available = schema?.collections?.[FILES_COLLECTION]?.fields ?? {};
  const fields = FILE_FIELDS.filter((field) => field in available);
  const checksumField = CHECKSUM_FIELDS.find((field) => field in available) ?? null;
  if (checksumField) fields.push(checksumField);
  return { fields, checksumField };
}
