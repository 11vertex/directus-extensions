import { incomingRelations } from "./schema-graph.js";

const BLOCKING = new Set(["NO ACTION", "RESTRICT"]);

/**
 * What the database does to rows referencing a deleted item through `relation`.
 * Directus deletes items with a plain `DELETE`, so the foreign key `on_delete` rule decides the outcome.
 */
export function describeDeleteOutcome(relation, count) {
  const where = `${relation.collection}.${relation.field}`;

  if (count === 0) {
    return { outcome: "none", message: `No items in ${relation.collection} reference this item.` };
  }

  if (!relation.constraint) {
    return {
      outcome: "dangling",
      message: `No database constraint on ${where}: ${count} reference(s) would point to a missing item.`
    };
  }

  if (relation.onDelete === "CASCADE") {
    return { outcome: "cascade", message: `${count} item(s) in ${relation.collection} would be deleted too.` };
  }

  if (relation.onDelete === "SET NULL") {
    if (!relation.nullable) {
      return {
        outcome: "block",
        message: `${where} is SET NULL but the column is NOT NULL — the database would reject the delete.`
      };
    }
    return { outcome: "nullify", message: `${where} would be cleared on ${count} item(s).` };
  }

  if (relation.onDelete === "SET DEFAULT") {
    return { outcome: "set-default", message: `${where} would be reset to its default on ${count} item(s).` };
  }

  return {
    outcome: "block",
    message: `${relation.onDelete ?? "NO ACTION"} on ${where}: ${count} reference(s) would block the delete.`
  };
}

export function describeDeselect(relation) {
  if (!relation.oneField) return null;
  const action = relation.deselectAction === "delete" ? "deleted" : "unlinked (field set to null)";
  return `Removing an item from ${relation.target ?? "the parent"}.${relation.oneField} in the editor: the ${relation.collection} item is ${action}.`;
}

export function summarizeImpact(entries) {
  const sum = (outcome) => entries.filter((entry) => entry.outcome === outcome).reduce((total, entry) => total + entry.count, 0);
  const blocking = entries.filter((entry) => entry.outcome === "block");

  return {
    blocked: blocking.length > 0,
    blockingRelations: blocking.map((entry) => entry.id),
    relationsChecked: entries.length,
    referencingItems: entries.reduce((total, entry) => total + entry.count, 0),
    cascadeItems: sum("cascade"),
    nullifiedItems: sum("nullify") + sum("set-default"),
    danglingItems: sum("dangling"),
    blockingItems: sum("block")
  };
}

/**
 * Schema-level cascade chain: collections whose items may be deleted transitively through
 * CASCADE foreign keys, plus restricting relations on them that could still block the delete.
 */
export function cascadePaths(schema, collection, maxDepth = 5) {
  const visited = new Set([collection]);
  const result = [];
  let frontier = [{ collection, depth: 0 }];

  while (frontier.length > 0) {
    const next = [];
    for (const current of frontier) {
      if (current.depth >= maxDepth) continue;

      for (const relation of incomingRelations(schema, current.collection)) {
        if (!relation.constraint || relation.onDelete !== "CASCADE" || visited.has(relation.collection)) continue;
        visited.add(relation.collection);

        const potentialBlockers = incomingRelations(schema, relation.collection)
          .filter((entry) => entry.constraint && BLOCKING.has(entry.onDelete))
          .map((entry) => entry.id);

        const step = { collection: relation.collection, depth: current.depth + 1, via: relation.id, from: current.collection, potentialBlockers };
        result.push(step);
        next.push(step);
      }
    }
    frontier = next;
  }

  return result;
}
