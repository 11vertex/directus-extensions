// Pure helpers that turn a Directus SchemaOverview (`getSchema()`) into graph and relation descriptors.

const LABEL_CANDIDATES = [
  "title",
  "name",
  "label",
  "email",
  "filename_download",
  "slug",
  "first_name",
  "username",
  "key",
  "code",
  "handle",
  "subject"
];

const LABEL_TYPES = new Set(["string", "text"]);

// Collections whose primary keys are secrets (session tokens) — never list their items.
const REDACTED_COLLECTIONS = new Set(["directus_sessions"]);

export function isSystemCollection(collection) {
  return collection.startsWith("directus_");
}

export function isRedactedCollection(collection) {
  return REDACTED_COLLECTIONS.has(collection);
}

export function normalizeOnDelete(relation) {
  if (!relation.schema) return null;
  return String(relation.schema.on_delete ?? "NO ACTION").toUpperCase();
}

function findPartner(relation, relations) {
  const junctionField = relation.meta?.junction_field;
  if (!junctionField) return null;
  return relations.find((entry) => entry.collection === relation.collection && entry.field === junctionField) ?? null;
}

export function classifyRelation(relation, relations = []) {
  if (!relation.related_collection) {
    return relation.meta?.one_allowed_collections?.length ? "m2a" : null;
  }

  if (relation.meta?.junction_field) {
    const partner = findPartner(relation, relations);
    return partner && !partner.related_collection ? "m2a" : "m2m";
  }

  return relation.meta?.one_field ? "o2m" : "m2o";
}

function targetsOf(relation) {
  if (relation.related_collection) return [relation.related_collection];
  return relation.meta?.one_allowed_collections ?? [];
}

function fieldInfo(schema, collection, field) {
  return schema.collections[collection]?.fields?.[field] ?? null;
}

function isUsable(schema, relation) {
  return Boolean(fieldInfo(schema, relation.collection, relation.field));
}

function describeRelation(schema, relation) {
  const partner = findPartner(relation, schema.relations);

  return {
    id: `${relation.collection}.${relation.field}`,
    collection: relation.collection,
    field: relation.field,
    type: classifyRelation(relation, schema.relations),
    kind: relation.related_collection ? "m2o" : "m2a",
    target: relation.related_collection ?? null,
    allowed: relation.related_collection ? null : relation.meta?.one_allowed_collections ?? [],
    collectionField: relation.meta?.one_collection_field ?? null,
    oneField: relation.meta?.one_field ?? null,
    deselectAction: relation.meta?.one_field ? relation.meta?.one_deselect_action ?? "nullify" : null,
    onDelete: normalizeOnDelete(relation),
    constraint: Boolean(relation.schema),
    nullable: fieldInfo(schema, relation.collection, relation.field)?.nullable !== false,
    junction: partner
      ? {
          field: partner.field,
          collection: partner.related_collection ?? null,
          allowed: partner.related_collection ? null : partner.meta?.one_allowed_collections ?? [],
          collectionField: partner.meta?.one_collection_field ?? null
        }
      : null
  };
}

export function buildSchemaGraph(schema) {
  const collections = Object.values(schema.collections)
    .map((info) => ({
      id: info.collection,
      system: isSystemCollection(info.collection),
      singleton: Boolean(info.singleton),
      primary: info.primary,
      note: info.note ?? null,
      fields: Object.values(info.fields)
        .filter((field) => field.type !== "alias")
        .map((field) => ({ field: field.field, type: field.type }))
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const edges = [];

  for (const relation of schema.relations) {
    if (!schema.collections[relation.collection] || !classifyRelation(relation, schema.relations)) continue;
    const base = describeRelation(schema, relation);

    for (const target of targetsOf(relation)) {
      if (!schema.collections[target]) continue;
      edges.push({
        id: `${relation.collection}.${relation.field}->${target}`,
        source: relation.collection,
        target,
        field: relation.field,
        type: base.type,
        oneField: base.oneField,
        onDelete: base.onDelete,
        constraint: base.constraint,
        nullable: base.nullable,
        deselectAction: base.deselectAction,
        junctionField: relation.meta?.junction_field ?? null
      });
    }
  }

  edges.sort((a, b) => a.id.localeCompare(b.id));
  return { collections, edges };
}

/** Relations stored on other collections (or on itself) that point to `collection`. */
export function incomingRelations(schema, collection) {
  return schema.relations
    .filter((relation) => schema.collections[relation.collection] && isUsable(schema, relation))
    .filter((relation) => targetsOf(relation).includes(collection))
    .filter((relation) => classifyRelation(relation, schema.relations))
    .map((relation) => describeRelation(schema, relation))
    .filter((relation) => relation.kind === "m2o" || relation.collectionField)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Foreign key (M2O) and M2A fields stored on `collection` itself. */
export function outgoingRelations(schema, collection) {
  return schema.relations
    .filter((relation) => relation.collection === collection && isUsable(schema, relation))
    .filter((relation) => classifyRelation(relation, schema.relations))
    .map((relation) => describeRelation(schema, relation))
    .filter((relation) => relation.kind === "m2o" ? Boolean(schema.collections[relation.target]) : Boolean(relation.collectionField))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function pickLabelField(info) {
  if (!info) return null;
  return LABEL_CANDIDATES.find((name) => {
    const field = info.fields?.[name];
    return field && LABEL_TYPES.has(field.type) && name !== info.primary;
  }) ?? null;
}

export function toRecordRef(collection, row, primary, labelField) {
  const pk = row?.[primary];
  const label = labelField && row?.[labelField] !== null && row?.[labelField] !== undefined ? String(row[labelField]) : null;
  return { collection, pk, label: label ?? String(pk) };
}

/** Item filter matching rows of `relation.collection` that reference `pk` in `collection`. */
export function incomingFilter(relation, collection, pk) {
  if (relation.kind === "m2a") {
    return { _and: [{ [relation.field]: { _eq: String(pk) } }, { [relation.collectionField]: { _eq: collection } }] };
  }
  return { [relation.field]: { _eq: pk } };
}

/** Reference to the item a row points at through an outgoing M2O / M2A relation. */
export function outgoingRef(relation, row) {
  const value = row?.[relation.field];
  if (value === null || value === undefined) return null;
  if (relation.kind === "m2a") {
    const collection = row?.[relation.collectionField];
    return collection ? { collection, pk: value } : null;
  }
  return { collection: relation.target, pk: value };
}

/** For a junction row, the item on the other side of the M2M / M2A. */
export function junctionRef(junction, row) {
  const value = row?.[junction.field];
  if (value === null || value === undefined) return null;
  if (junction.collection) return { collection: junction.collection, pk: value };
  const collection = junction.collectionField ? row?.[junction.collectionField] : null;
  return collection ? { collection, pk: value } : null;
}

export function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}
