// Bounded, read-only SELECT queries (via the Directus knex instance) used for orphan detection.
import { incomingRelations, isRedactedCollection, outgoingRelations, pickLabelField } from "./schema-graph.js";

export function textCastType(knex) {
  const client = String(knex?.client?.config?.client ?? "");
  if (/mysql/i.test(client)) return "CHAR";
  if (/mssql/i.test(client)) return "NVARCHAR(255)";
  if (/oracle/i.test(client)) return "VARCHAR2(255)";
  return "TEXT";
}

function fieldType(schema, collection, field) {
  return schema.collections[collection]?.fields?.[field]?.type ?? null;
}

/**
 * Adds `left = right` to a builder. Columns of different types (relations without a foreign key,
 * or M2A string keys) are compared as text so the query works on every vendor.
 */
export function whereColumnsMatch(knex, builder, left, leftType, right, rightType) {
  if (leftType && leftType === rightType) return builder.whereRaw("?? = ??", [left, right]);
  const cast = textCastType(knex);
  return builder.whereRaw(`CAST(?? AS ${cast}) = CAST(?? AS ${cast})`, [left, right]);
}

async function run(query, { primary, labelField, limit, extra = {} }) {
  const [countRow] = await query.clone().count({ count: "*" });
  const total = Number(countRow?.count ?? Object.values(countRow ?? {})[0] ?? 0);
  if (total === 0 || limit === 0) return { total, items: [] };

  const columns = { pk: `t.${primary}`, ...(labelField ? { label: `t.${labelField}` } : {}), ...extra };
  const rows = await query.clone().select(columns).orderBy(`t.${primary}`).limit(limit);
  return {
    total,
    items: rows.map((row) => ({
      pk: row.pk,
      label: row.label !== null && row.label !== undefined ? String(row.label) : String(row.pk),
      ...(row.value !== undefined ? { value: row.value } : {})
    }))
  };
}

export async function scanOrphans(knex, schema, collection, { limit, required = new Set() }) {
  const info = schema.collections[collection];
  const primary = info.primary;
  const primaryType = fieldType(schema, collection, primary);
  const labelField = pickLabelField(info);
  const itemLimit = isRedactedCollection(collection) ? 0 : limit;
  const options = { primary, labelField, limit: itemLimit };
  const incoming = incomingRelations(schema, collection);
  const outgoing = outgoingRelations(schema, collection);

  // 1. Items no incoming relation points at.
  let unreferenced = { applicable: false, relations: [], total: 0, items: [] };
  if (incoming.length > 0) {
    const query = knex({ t: collection });
    incoming.forEach((relation, index) => {
      const alias = `r${index}`;
      query.whereNotExists(function () {
        this.select(knex.raw("1")).from({ [alias]: relation.collection });
        const refType = relation.kind === "m2a" ? "m2a-key" : fieldType(schema, relation.collection, relation.field);
        whereColumnsMatch(knex, this, `${alias}.${relation.field}`, refType, `t.${primary}`, primaryType);
        if (relation.kind === "m2a") this.andWhere(`${alias}.${relation.collectionField}`, collection);
      });
    });
    unreferenced = { applicable: true, relations: incoming.map((relation) => relation.id), ...(await run(query, options)) };
  }

  // 2. Required (Directus field metadata) relational fields that are empty.
  const missingRequired = [];
  for (const relation of outgoing.filter((entry) => required.has(entry.field))) {
    const query = knex({ t: collection }).where((builder) => {
      builder.whereNull(`t.${relation.field}`);
      if (relation.kind === "m2a") builder.orWhereNull(`t.${relation.collectionField}`);
    });
    missingRequired.push({ id: relation.id, field: relation.field, type: relation.type, target: relation.target, ...(await run(query, options)) });
  }

  // 3. Broken references: values pointing at items that no longer exist (only possible without a foreign key).
  const brokenReferences = [];
  for (const relation of outgoing.filter((entry) => !entry.constraint)) {
    const targets = relation.kind === "m2a" ? relation.allowed : [relation.target];
    for (const target of targets) {
      const targetInfo = schema.collections[target];
      if (!targetInfo) continue;
      const query = knex({ t: collection }).whereNotNull(`t.${relation.field}`);
      if (relation.kind === "m2a") query.andWhere(`t.${relation.collectionField}`, target);
      query.whereNotExists(function () {
        this.select(knex.raw("1")).from({ x: target });
        const leftType = relation.kind === "m2a" ? "m2a-key" : fieldType(schema, collection, relation.field);
        whereColumnsMatch(knex, this, `x.${targetInfo.primary}`, fieldType(schema, target, targetInfo.primary), `t.${relation.field}`, leftType);
      });
      brokenReferences.push({
        id: `${relation.id}->${target}`,
        field: relation.field,
        type: relation.type,
        target,
        ...(await run(query, { ...options, extra: { value: `t.${relation.field}` } }))
      });
    }
  }

  return {
    collection,
    primary,
    labelField,
    limit,
    redacted: isRedactedCollection(collection),
    unreferenced,
    missingRequired,
    brokenReferences
  };
}
