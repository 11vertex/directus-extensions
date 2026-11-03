// Plain-language helpers: collection connections and delete impact as short sentences.

export function humanize(value) {
  return String(value ?? "")
    .replace(/^directus_/, "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function singular(word) {
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes)$/i.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/i.test(word)) return word;
  if (/s$/i.test(word)) return word.slice(0, -1);
  return word;
}

/** "3 comments", "1 comment" (collection names are usually plural). */
export function countOf(count, name) {
  const lower = String(name).toLowerCase();
  return `${count} ${count === 1 ? singular(lower) : lower}`;
}

export function technicalLabel(edge) {
  const rule = edge.onDelete ? ` · on delete ${edge.onDelete}` : edge.constraint === false ? " · no foreign key" : "";
  return `${edge.source}.${edge.field} → ${edge.target} · ${String(edge.type).toUpperCase()}${rule}`;
}

/**
 * What a collection uses (fields stored on it, plus its many-to-many / many-to-any lists) and
 * which collections use it. Junction rows are folded into the "many" entry of the parent.
 */
export function describeConnections(edges, id) {
  const uses = new Map();
  const usedBy = new Map();

  const add = (map, key, entry) => {
    const existing = map.get(key);
    if (!existing) return map.set(key, entry);
    existing.targets = [...new Set([...existing.targets, ...entry.targets])];
    existing.technical = [...new Set([...existing.technical, ...entry.technical])];
  };

  for (const edge of edges) {
    if (edge.source === id) {
      add(uses, `field:${edge.field}`, { key: `field:${edge.field}`, owner: id, field: edge.field, amount: "one", targets: [edge.target], via: null, technical: [technicalLabel(edge)] });
    }
    if (edge.target !== id) continue;

    if (!edge.junctionField) {
      add(usedBy, edge.id, { key: edge.id, collection: edge.source, field: edge.field, via: null, technical: [technicalLabel(edge)] });
      continue;
    }

    const partners = edges.filter((other) => other.source === edge.source && other.field === edge.junctionField);
    if (edge.oneField) {
      add(uses, `field:${edge.oneField}`, {
        key: `field:${edge.oneField}`,
        owner: id,
        field: edge.oneField,
        amount: "many",
        targets: partners.map((partner) => partner.target),
        via: edge.source,
        technical: [technicalLabel(edge), ...partners.map(technicalLabel)]
      });
      continue;
    }

    for (const partner of partners) {
      const key = `${edge.id}|${partner.target}`;
      add(usedBy, key, {
        key,
        collection: partner.target,
        field: partner.oneField,
        via: edge.source,
        technical: [technicalLabel(edge), technicalLabel(partner)]
      });
    }
  }

  return { uses: [...uses.values()], usedBy: [...usedBy.values()] };
}

const TONES = { block: "danger", cascade: "warning", dangling: "warning", nullify: "info", "set-default": "info" };
const ORDER = ["block", "cascade", "dangling", "nullify", "set-default"];

/** One sentence per affected collection and outcome of a delete impact report. */
export function impactSentences(entries, { collectionName = humanize } = {}) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.count || entry.outcome === "none") continue;
    const far = entry.junction ? entry.junction.collection ?? "" : null;
    const key = `${entry.outcome}|${entry.collection}|${far}`;
    const group = groups.get(key) ?? { outcome: entry.outcome, collection: entry.collection, far, count: 0 };
    group.count += entry.count;
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome) || b.count - a.count)
    .map((group) => {
      const one = group.count === 1;
      const what = group.far === null
        ? countOf(group.count, collectionName(group.collection))
        : `${group.count} link${one ? "" : "s"} to ${group.far ? collectionName(group.far) : "other items"}`;
      const text = {
        block: `Blocked: ${what} still point${one ? "s" : ""} to it`,
        cascade: `${what} will also be deleted`,
        dangling: `${what} will point to a missing item`,
        nullify: group.far === null ? `${what} will lose ${one ? "its" : "their"} link` : `${what} will be removed`,
        "set-default": `${what} will be reset to a default value`
      }[group.outcome];
      return { key: `${group.outcome}|${group.collection}|${group.far}`, tone: TONES[group.outcome], collection: group.collection, text };
    });
}

export function impactHeadline(summary, label) {
  const name = `“${label}”`;
  if (summary.blocked) return { tone: "danger", icon: "block", text: `${name} can't be deleted yet` };
  if (summary.cascadeItems > 0 || summary.danglingItems > 0) return { tone: "warning", icon: "warning", text: `Deleting ${name} also changes other content` };
  if (summary.referencingItems > 0) return { tone: "info", icon: "info", text: `${name} can be deleted; some links will be cleared` };
  return { tone: "success", icon: "check_circle", text: `Nothing uses ${name} — it's safe to delete` };
}
