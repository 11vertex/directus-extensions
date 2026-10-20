import { httpError } from "./errors.js";
import { cascadePaths, describeDeleteOutcome, describeDeselect, summarizeImpact } from "./impact.js";
import { scanOrphans } from "./orphan-queries.js";
import {
  buildSchemaGraph,
  incomingFilter,
  incomingRelations,
  isRedactedCollection,
  junctionRef,
  outgoingRef,
  outgoingRelations,
  pickLabelField,
  toRecordRef,
  unique
} from "./schema-graph.js";

// Every read uses `accountability: null` (full read access) and nothing here ever writes.
async function load(context) {
  const schema = await context.getSchema();
  const items = (collection) =>
    new context.services.ItemsService(collection, { schema, accountability: null, knex: context.database });
  return { schema, items };
}

function requireCollection(schema, collection) {
  const info = schema.collections[collection];
  if (!info) throw httpError(404, `Collection "${collection}" does not exist.`);
  return info;
}

async function countItems(service, filter) {
  const [row] = await service.readByQuery({ aggregate: { count: ["*"] }, filter });
  return Number(row?.count ?? 0);
}

async function readRecord(service, primary, pk, fields) {
  const [row] = await service.readByQuery({ fields, filter: { [primary]: { _eq: pk } }, limit: 1 });
  return row ?? null;
}

/** Fill in `label` / `exists` on references, batching one query per collection. */
async function resolveRefs(schema, items, refs) {
  const byCollection = new Map();
  for (const ref of refs) {
    if (!schema.collections[ref.collection]) {
      ref.exists = false;
      ref.label = String(ref.pk);
      continue;
    }
    if (!byCollection.has(ref.collection)) byCollection.set(ref.collection, []);
    byCollection.get(ref.collection).push(ref);
  }

  for (const [collection, group] of byCollection) {
    const info = schema.collections[collection];
    const labelField = pickLabelField(info);
    const keys = unique(group.map((ref) => ref.pk));
    const rows = await items(collection).readByQuery({
      fields: unique([info.primary, labelField]),
      filter: { [info.primary]: { _in: keys } },
      limit: keys.length
    });
    const found = new Map(rows.map((row) => [String(row[info.primary]), row]));

    for (const ref of group) {
      const row = found.get(String(ref.pk));
      ref.exists = Boolean(row);
      ref.label = row ? toRecordRef(collection, row, info.primary, labelField).label : String(ref.pk);
      if (isRedactedCollection(collection)) ref.label = "(hidden)";
    }
  }
  return refs;
}

function relationSummary(relation) {
  return {
    id: relation.id,
    collection: relation.collection,
    field: relation.field,
    type: relation.type,
    kind: relation.kind,
    target: relation.target,
    allowed: relation.allowed,
    oneField: relation.oneField,
    onDelete: relation.onDelete,
    constraint: relation.constraint,
    junction: relation.junction
  };
}

export async function getGraph(context) {
  const schema = await context.getSchema();
  return { generatedAt: new Date().toISOString(), ...buildSchemaGraph(schema) };
}

export async function browseRecords(context, { collection, search, limit }) {
  const { schema, items } = await load(context);
  const info = requireCollection(schema, collection);
  const labelField = pickLabelField(info);

  if (isRedactedCollection(collection)) {
    return { collection, primary: info.primary, labelField: null, redacted: true, items: [] };
  }

  const rows = await items(collection).readByQuery({
    fields: unique([info.primary, labelField]),
    sort: [info.primary],
    limit,
    ...(search ? { search } : {})
  });

  return {
    collection,
    primary: info.primary,
    labelField,
    singleton: Boolean(info.singleton),
    items: rows.map((row) => toRecordRef(collection, row, info.primary, labelField))
  };
}

export async function exploreRecord(context, { collection, pk, limit }) {
  const { schema, items } = await load(context);
  const info = requireCollection(schema, collection);
  if (isRedactedCollection(collection)) throw httpError(400, `Items of ${collection} cannot be explored.`);

  const labelField = pickLabelField(info);
  const outgoing = outgoingRelations(schema, collection);
  const fields = unique([info.primary, labelField, ...outgoing.flatMap((relation) => [relation.field, relation.collectionField])]);
  const record = await readRecord(items(collection), info.primary, pk, fields);
  if (!record) throw httpError(404, `Item "${pk}" was not found in ${collection}.`);

  const outgoingGroups = outgoing.map((relation) => {
    const ref = outgoingRef(relation, record);
    return { ...relationSummary(relation), total: ref ? 1 : 0, items: ref ? [ref] : [] };
  });
  await resolveRefs(schema, items, outgoingGroups.flatMap((group) => group.items));

  const incomingGroups = [];
  for (const relation of incomingRelations(schema, collection)) {
    const sourceInfo = schema.collections[relation.collection];
    const sourceLabel = pickLabelField(sourceInfo);
    const filter = incomingFilter(relation, collection, pk);
    const service = items(relation.collection);
    const total = await countItems(service, filter);
    const redacted = isRedactedCollection(relation.collection);

    let entries = [];
    if (total > 0 && !redacted) {
      const rows = await service.readByQuery({
        fields: unique([sourceInfo.primary, sourceLabel, relation.junction?.field, relation.junction?.collectionField]),
        filter,
        sort: [sourceInfo.primary],
        limit
      });

      entries = rows.map((row) => {
        const self = toRecordRef(relation.collection, row, sourceInfo.primary, sourceLabel);
        const target = relation.junction ? junctionRef(relation.junction, row) : null;
        return target ? { ...target, via: self } : self;
      });
      await resolveRefs(schema, items, entries.filter((entry) => entry.via));
    }

    incomingGroups.push({ ...relationSummary(relation), total, redacted, items: entries });
  }

  return {
    record: { ...toRecordRef(collection, record, info.primary, labelField), singleton: Boolean(info.singleton) },
    limit,
    outgoing: outgoingGroups,
    incoming: incomingGroups
  };
}

export async function analyzeImpact(context, { collection, pk }) {
  const { schema, items } = await load(context);
  const info = requireCollection(schema, collection);
  const labelField = pickLabelField(info);
  const record = await readRecord(items(collection), info.primary, pk, unique([info.primary, labelField]));
  if (!record) throw httpError(404, `Item "${pk}" was not found in ${collection}.`);

  const entries = [];
  for (const relation of incomingRelations(schema, collection)) {
    const count = await countItems(items(relation.collection), incomingFilter(relation, collection, pk));
    entries.push({
      ...relationSummary(relation),
      nullable: relation.nullable,
      count,
      deselect: describeDeselect({ ...relation, target: collection }),
      ...describeDeleteOutcome(relation, count)
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    record: toRecordRef(collection, record, info.primary, labelField),
    entries,
    summary: summarizeImpact(entries),
    cascades: cascadePaths(schema, collection)
  };
}

export async function findOrphans(context, { collection, limit }) {
  const { schema, items } = await load(context);
  const info = requireCollection(schema, collection);
  // "Required" is Directus field metadata (directus_fields.required), not a database constraint.
  const fields = await items("directus_fields").readByQuery({
    fields: ["field"],
    filter: { _and: [{ collection: { _eq: collection } }, { required: { _eq: true } }] },
    limit: -1
  });
  const required = new Set(fields.map((field) => field.field));

  return {
    generatedAt: new Date().toISOString(),
    ...(await scanOrphans(context.database, schema, collection, { limit, required })),
    singleton: Boolean(info.singleton)
  };
}
