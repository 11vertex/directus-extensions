import { getPermissionActions } from "./validation.js";

const ADDITIVE_NOTE =
  "Directus policies are additive: multiple rules for the same collection/action combine to grant more access, they never revoke access granted by another policy.";

function getAdditivePoliciesNote() {
  return ADDITIVE_NOTE;
}

/**
 * Merge permission rules the same way Directus does for additive (`or`) policies:
 * fields are unioned, filters/validations are OR'd, presets are shallow-merged.
 */
function buildMergedRules(collection, rules) {
  const byAction = groupRulesByAction(rules);

  return getPermissionActions()
    .map((action) => {
      const actionRules = byAction.get(action) ?? [];
      if (actionRules.length === 0) return null;

      const sources = actionRules.map((rule) => savedSource(rule));
      const fields = mergeFieldsOr(actionRules.map((rule) => rule.fields));
      const permissions = mergeFiltersOr(
        actionRules.map((rule) => rule.authoredPermissions ?? rule.permissions)
      );
      const validation = mergeFiltersOr(
        actionRules.map((rule) => rule.authoredValidation ?? rule.validation)
      );
      const presets = mergePresets(
        actionRules.map((rule) => rule.authoredPresets ?? rule.presets)
      );
      const dynamicVariables = unique(
        actionRules.flatMap((rule) => rule.dynamicVariables ?? [])
      ).sort();

      return {
        action,
        collection,
        policyIds: unique(
          actionRules.map((rule) => (rule.policy ? String(rule.policy) : "unknown"))
        ),
        ruleCount: actionRules.length,
        fields,
        permissions,
        validation,
        presets,
        dynamicVariables,
        hasUnresolvedUserContext: actionRules.some(
          (rule) => rule.hasUnresolvedUserContext === true
        ),
        sources
      };
    })
    .filter(Boolean);
}

function detectPolicyConflicts(collection, rules) {
  const conflicts = [];
  const byAction = groupRulesByAction(rules);
  const mergedByAction = new Map(
    buildMergedRules(collection, rules).map((merged) => [merged.action, merged])
  );

  for (const [action, actionRules] of byAction) {
    if (actionRules.length < 2) continue;

    const policyIds = unique(
      actionRules.map((rule) => (rule.policy ? String(rule.policy) : "unknown"))
    );
    const merged = mergedByAction.get(action);
    const sources = actionRules.map((rule) => savedSource(rule));

    conflicts.push({
      severity: "info",
      kind: "overlapping_rules",
      collection,
      action,
      message: `${actionRules.length} overlapping ${action} rules apply to "${collection}". Access is merged additively.`,
      policyIds,
      details: { ruleCount: actionRules.length },
      saved: sources,
      merged: mergedSnapshot(merged)
    });

    const fieldSets = actionRules.map((rule) => normalizeFields(rule.fields));
    if (!allEqual(fieldSets.map((fields) => stableStringify(fields)))) {
      const hasWildcard = fieldSets.some((fields) => fields.includes("*"));
      conflicts.push({
        severity: hasWildcard ? "info" : "warning",
        kind: "divergent_fields",
        collection,
        action,
        message: hasWildcard
          ? `Field allowlists differ for ${action} on "${collection}", but at least one rule grants "*".`
          : `Field allowlists differ for ${action} on "${collection}". Effective access is the union of allowed fields.`,
        policyIds,
        fields: merged?.fields ?? unique(fieldSets.flat()),
        saved: sources.map((source) => ({
          policy: source.policy,
          fields: source.fields
        })),
        merged: {
          fields: merged?.fields ?? unique(fieldSets.flat())
        }
      });
    }

    const presetCollisions = findPresetCollisions(actionRules);
    if (presetCollisions.length > 0) {
      conflicts.push({
        severity: "warning",
        kind: "preset_collision",
        collection,
        action,
        message: `Conflicting preset values for ${action} on "${collection}": ${presetCollisions
          .map((item) => `${item.key} (${item.values.join(" vs ")})`)
          .join(", ")}. Later/merged presets may overwrite earlier ones.`,
        policyIds,
        details: { collisions: presetCollisions },
        saved: sources.map((source) => ({
          policy: source.policy,
          presets: source.presets
        })),
        merged: {
          presets: merged?.presets ?? null
        }
      });
    }

    const filters = actionRules.map((rule) =>
      stableStringify(rule.authoredPermissions ?? rule.permissions ?? {})
    );
    if (!allEqual(filters)) {
      conflicts.push({
        severity: "warning",
        kind: "differing_filters",
        collection,
        action,
        message: `Item filters differ across ${action} rules on "${collection}". An item is allowed if any applicable filter matches.`,
        policyIds,
        saved: sources.map((source) => ({
          policy: source.policy,
          permissions: source.permissions
        })),
        merged: {
          permissions: merged?.permissions ?? null
        }
      });
    }

    const validations = actionRules.map((rule) =>
      stableStringify(rule.authoredValidation ?? rule.validation ?? {})
    );
    if (!allEqual(validations)) {
      conflicts.push({
        severity: "warning",
        kind: "differing_validation",
        collection,
        action,
        message: `Validation rules differ across ${action} rules on "${collection}". All applicable validations are evaluated.`,
        policyIds,
        saved: sources.map((source) => ({
          policy: source.policy,
          validation: source.validation
        })),
        merged: {
          validation: merged?.validation ?? null
        }
      });
    }
  }

  return conflicts;
}

function groupRulesByAction(rules) {
  const byAction = /* @__PURE__ */ new Map();
  for (const rule of rules) {
    const action = String(rule.action);
    const list = byAction.get(action) ?? [];
    list.push(rule);
    byAction.set(action, list);
  }
  return byAction;
}

function savedSource(rule) {
  return {
    id: rule.id ?? null,
    policy: rule.policy ? String(rule.policy) : null,
    fields: normalizeFields(rule.fields),
    permissions: rule.authoredPermissions ?? rule.permissions ?? null,
    validation: rule.authoredValidation ?? rule.validation ?? null,
    presets: rule.authoredPresets ?? rule.presets ?? null,
    dynamicVariables: rule.dynamicVariables ?? [],
    hasUnresolvedUserContext: rule.hasUnresolvedUserContext === true
  };
}

function mergedSnapshot(merged) {
  if (!merged) return null;
  return {
    fields: merged.fields,
    permissions: merged.permissions,
    validation: merged.validation,
    presets: merged.presets
  };
}

function mergeFieldsOr(fieldLists) {
  let merged = [];
  for (const fields of fieldLists) {
    merged = mergeFieldsPair(merged, fields);
  }
  return normalizeFields(merged);
}

function mergeFieldsPair(fieldsA, fieldsB) {
  const a = fieldsA ?? [];
  const b = fieldsB ?? [];
  if (a.length === 0) return [...b];
  if (b.length === 0) return [...a];
  if (a.includes("*") || b.includes("*")) return ["*"];
  return unique([...a, ...b]);
}

function mergeFiltersOr(filters) {
  const defined = filters.filter((filter) => filter && typeof filter === "object");
  if (defined.length === 0) return null;
  // Empty object means unrestricted — OR with anything stays unrestricted.
  if (defined.some((filter) => Object.keys(filter).length === 0)) return {};
  if (defined.length === 1) return defined[0];
  return { _or: defined };
}

function mergePresets(presetList) {
  let merged = null;
  for (const presets of presetList) {
    if (!presets || typeof presets !== "object") continue;
    merged = { ...(merged ?? {}), ...presets };
  }
  return merged;
}

function buildAccessDiffs(left, right) {
  const collections = unique([
    ...Object.keys(left.collectionAccess),
    ...Object.keys(right.collectionAccess)
  ]).sort((a, b) => a.localeCompare(b));
  const diffs = [];
  for (const collection of collections) {
    for (const action of getPermissionActions()) {
      const leftAccess = left.collectionAccess[collection]?.[action]?.access ?? "none";
      const rightAccess = right.collectionAccess[collection]?.[action]?.access ?? "none";
      diffs.push({
        collection,
        action,
        left: leftAccess,
        right: rightAccess,
        change: classifyAccessChange(leftAccess, rightAccess)
      });
    }
  }
  return diffs;
}

function buildFieldDiffs(left, right) {
  if (!left.selectedCollection || left.selectedCollection !== right.selectedCollection) {
    return [];
  }
  const fieldNames = unique([
    ...left.fields.map((field) => field.field),
    ...right.fields.map((field) => field.field)
  ]).sort((a, b) => a.localeCompare(b));
  const leftMap = new Map(left.fields.map((field) => [field.field, field.actions]));
  const rightMap = new Map(right.fields.map((field) => [field.field, field.actions]));
  const diffs = [];
  for (const field of fieldNames) {
    for (const action of getPermissionActions()) {
      const leftAllowed = Boolean(leftMap.get(field)?.[action]);
      const rightAllowed = Boolean(rightMap.get(field)?.[action]);
      diffs.push({
        field,
        action,
        left: leftAllowed,
        right: rightAllowed,
        change: leftAllowed === rightAllowed ? "same" : rightAllowed ? "gained" : "lost"
      });
    }
  }
  return diffs;
}

function buildCompareSummary(accessDiffs, fieldDiffs, conflicts) {
  return {
    gained: accessDiffs.filter((diff) => diff.change === "gained").length,
    lost: accessDiffs.filter((diff) => diff.change === "lost").length,
    changed: accessDiffs.filter((diff) => diff.change === "changed").length,
    same: accessDiffs.filter((diff) => diff.change === "same").length,
    fieldGained: fieldDiffs.filter((diff) => diff.change === "gained").length,
    fieldLost: fieldDiffs.filter((diff) => diff.change === "lost").length,
    conflictCount: conflicts.length
  };
}

function classifyAccessChange(left, right) {
  if (left === right) return "same";
  const rank = { none: 0, partial: 1, full: 2 };
  if (rank[right] > rank[left]) return "gained";
  if (rank[right] < rank[left]) return "lost";
  return "changed";
}

function findPresetCollisions(rules) {
  const valuesByKey = /* @__PURE__ */ new Map();
  for (const rule of rules) {
    const presets = rule.authoredPresets ?? rule.presets;
    if (!presets) continue;
    for (const [key, value] of Object.entries(presets)) {
      const set = valuesByKey.get(key) ?? /* @__PURE__ */ new Set();
      set.add(stableStringify(value));
      valuesByKey.set(key, set);
    }
  }
  return [...valuesByKey.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([key, values]) => ({ key, values: [...values] }));
}

function normalizeFields(fields) {
  if (!fields || fields.length === 0) return [];
  if (fields.includes("*")) return ["*"];
  return unique(fields).sort((a, b) => a.localeCompare(b));
}

function unique(values) {
  return [...new Set(values)];
}

function allEqual(values) {
  return values.every((value) => value === values[0]);
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, nested]) => [key, sortValue(nested)]));
  }
  return value;
}

export {
  buildAccessDiffs,
  buildCompareSummary,
  buildFieldDiffs,
  buildMergedRules,
  detectPolicyConflicts,
  getAdditivePoliciesNote
};
