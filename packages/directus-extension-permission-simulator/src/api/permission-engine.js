import { loadInternals } from "./directus-internals.js";
import {
  buildAccessDiffs,
  buildCompareSummary,
  buildFieldDiffs,
  buildMergedRules,
  detectPolicyConflicts,
  getAdditivePoliciesNote
} from "./conflicts.js";
import { getPermissionActions, normalizeAccessLevel } from "./validation.js";
const DYNAMIC_VARIABLE_PATTERN = /\$CURRENT_(?:USER|ROLES|ROLE|POLICIES)(?:\.[A-Za-z0-9_]+)*/g;
function asFilterObject(value) {
  return value && typeof value === "object" ? value : null;
}
function collectDynamicVariables(...values) {
  const found = /* @__PURE__ */ new Set();
  for (const value of values) {
    if (!value) continue;
    for (const match of JSON.stringify(value).matchAll(DYNAMIC_VARIABLE_PATTERN)) {
      found.add(match[0]);
    }
  }
  return [...found].sort();
}
function matchRawPermission(permission, rawPermissions, index) {
  if (permission.id !== void 0 && permission.id !== null) {
    const byId = rawPermissions.find((raw) => raw.id === permission.id);
    if (byId) return byId;
  }
  const candidate = rawPermissions[index];
  if (candidate && candidate.action === permission.action && candidate.collection === permission.collection) {
    return candidate;
  }
  return null;
}
async function listUsers(context) {
  const schema = await context.getSchema();
  const usersService = new context.services.UsersService({
    schema,
    accountability: null,
    knex: context.database
  });
  const users = await usersService.readByQuery({
    fields: ["id", "first_name", "last_name", "email", "role"],
    sort: ["email"],
    limit: -1
  });
  return users.map((user) => {
    const firstName = typeof user.first_name === "string" ? user.first_name : "";
    const lastName = typeof user.last_name === "string" ? user.last_name : "";
    const fullName = `${firstName} ${lastName}`.trim();
    const email = typeof user.email === "string" ? user.email : null;
    return {
      id: String(user.id),
      name: fullName || email || String(user.id),
      email,
      role: user.role ? String(user.role) : null
    };
  });
}
async function listRoles(context) {
  const schema = await context.getSchema();
  const rolesService = new context.services.RolesService({
    schema,
    accountability: null,
    knex: context.database
  });
  const roles = await rolesService.readByQuery({
    fields: ["id", "name"],
    sort: ["name"],
    limit: -1
  });
  return roles.map((role) => ({
    id: String(role.id),
    name: typeof role.name === "string" ? role.name : String(role.id)
  }));
}
async function listCollections(context) {
  const schema = await context.getSchema();
  return Object.keys(schema.collections).sort((a, b) => a.localeCompare(b));
}
async function simulatePermissions(request, callerAccountability, context) {
  const {
    fetchAccountabilityCollectionAccess,
    fetchAccountabilityPolicyGlobals,
    fetchPolicies,
    fetchPermissions,
    fetchRawPermissions,
    validateAccess
  } = await loadInternals();
  const schema = await context.getSchema();
  const knex = context.database;
  const evaluationContext = { schema, knex };
  const { accountability, principal } = await buildTargetAccountability(
    request.mode,
    request.principalId,
    callerAccountability.ip ?? null,
    context,
    schema
  );
  const [collectionAccess, globals, policyIds] = await Promise.all([
    fetchAccountabilityCollectionAccess(accountability, evaluationContext),
    fetchAccountabilityPolicyGlobals(accountability, evaluationContext),
    fetchPolicies(accountability, evaluationContext)
  ]);
  const selectedCollection = request.collection ?? null;
  const actions = [];
  const fields = [];
  let rules = [];
  let mergedRules = [];
  let conflicts = [];
  if (selectedCollection) {
    if (!(selectedCollection in schema.collections)) {
      const error = new Error(`Collection "${selectedCollection}" does not exist.`);
      error.status = 404;
      throw error;
    }
    const [collectionPermissions, rawCollectionPermissions] = await Promise.all([
      fetchPermissions(
        {
          policies: policyIds,
          accountability,
          collections: [selectedCollection]
        },
        evaluationContext
      ),
      fetchRawPermissions(
        {
          policies: policyIds,
          accountability,
          collections: [selectedCollection],
          bypassMinimalAppPermissions: false
        },
        evaluationContext
      )
    ]);
    rules = collectionPermissions.map((permission, index) => {
      const raw = matchRawPermission(permission, rawCollectionPermissions, index);
      const authoredPermissions = asFilterObject(raw?.permissions);
      const authoredValidation = asFilterObject(raw?.validation);
      const authoredPresets = asFilterObject(raw?.presets);
      const dynamicVariables = collectDynamicVariables(
        authoredPermissions,
        authoredValidation,
        authoredPresets
      );
      return {
        id: permission.id ?? null,
        policy: permission.policy ? String(permission.policy) : null,
        action: permission.action,
        collection: permission.collection,
        fields: permission.fields ?? null,
        permissions: asFilterObject(permission.permissions),
        validation: asFilterObject(permission.validation),
        presets: asFilterObject(permission.presets),
        authoredPermissions,
        authoredValidation,
        authoredPresets,
        dynamicVariables,
        hasUnresolvedUserContext: accountability.user === null && dynamicVariables.some((variable) => variable.startsWith("$CURRENT_USER"))
      };
    });
    mergedRules = buildMergedRules(selectedCollection, rules);
    conflicts = detectPolicyConflicts(selectedCollection, rules);
    for (const action of getPermissionActions()) {
      const collectionAction = collectionAccess[selectedCollection]?.[action];
      const access = normalizeAccessLevel(collectionAction?.access);
      const allowed = access !== "none" || accountability.admin === true;
      let itemAllowed = null;
      let reason = null;
      if (request.primaryKey) {
        try {
          await validateAccess(
            {
              accountability,
              action,
              collection: selectedCollection,
              primaryKeys: [request.primaryKey],
              fields: request.fields
            },
            evaluationContext
          );
          itemAllowed = true;
        } catch (error) {
          itemAllowed = false;
          reason = error instanceof Error ? error.message : "Access denied for this record.";
        }
      } else if (!allowed) {
        reason = `No ${action} permission on collection "${selectedCollection}".`;
      } else if (access === "partial") {
        reason = `Partial ${action} access \u2014 item filters apply. Provide a record key to evaluate a specific item.`;
      }
      actions.push({
        action,
        access: accountability.admin ? "full" : access,
        allowed: accountability.admin ? true : allowed,
        fields: accountability.admin ? ["*"] : collectionAction?.fields ?? null,
        presets: collectionAction?.presets ?? null,
        itemAllowed,
        reason
      });
    }
    const schemaFields = Object.keys(schema.collections[selectedCollection]?.fields ?? {}).sort(
      (a, b) => a.localeCompare(b)
    );
    for (const field of schemaFields) {
      const fieldActions = {};
      for (const action of getPermissionActions()) {
        const actionFields = accountability.admin === true ? ["*"] : collectionAccess[selectedCollection]?.[action]?.fields ?? [];
        fieldActions[action] = accountability.admin === true || actionFields.includes("*") || actionFields.includes(field);
      }
      fields.push({ field, actions: fieldActions });
    }
  }
  return {
    mode: request.mode,
    principal,
    accountability: {
      user: accountability.user,
      role: accountability.role,
      roles: accountability.roles ?? [],
      admin: accountability.admin,
      app: accountability.app,
      ip: accountability.ip ?? null
    },
    globals,
    collectionAccess,
    selectedCollection,
    actions,
    fields,
    rules,
    mergedRules,
    conflicts,
    warnings: {
      roleOnlyMissingUserContext: request.mode === "role",
      ipUsedForPolicyFilter: callerAccountability.ip ?? null,
      additivePoliciesNote: getAdditivePoliciesNote()
    }
  };
}
async function comparePermissions(request, callerAccountability, context) {
  const [left, right] = await Promise.all([
    simulatePermissions(
      {
        mode: "role",
        principalId: request.leftRoleId,
        collection: request.collection,
        primaryKey: request.primaryKey,
        fields: request.fields
      },
      callerAccountability,
      context
    ),
    simulatePermissions(
      {
        mode: "role",
        principalId: request.rightRoleId,
        collection: request.collection,
        primaryKey: request.primaryKey,
        fields: request.fields
      },
      callerAccountability,
      context
    )
  ]);
  const accessDiffs = buildAccessDiffs(left, right);
  const fieldDiffs = buildFieldDiffs(left, right);
  const conflicts = [...left.conflicts, ...right.conflicts];
  return {
    left,
    right,
    accessDiffs,
    fieldDiffs,
    summary: buildCompareSummary(accessDiffs, fieldDiffs, conflicts),
    conflicts
  };
}
async function buildTargetAccountability(mode, principalId, ip, context, schema) {
  const { getAccountabilityForRole, fetchRolesTree, fetchGlobalAccess, createDefaultAccountability } =
    await loadInternals();
  if (mode === "role") {
    try {
      const accountability2 = await getAccountabilityForRole(principalId, {
        database: context.database,
        schema,
        accountability: { ip }
      });
      const rolesService = new context.services.RolesService({
        schema,
        accountability: null,
        knex: context.database
      });
      const role = await rolesService.readOne(principalId, { fields: ["id", "name"] });
      return {
        accountability: {
          ...accountability2,
          ip
        },
        principal: {
          id: principalId,
          label: typeof role.name === "string" ? role.name : principalId,
          roleId: principalId,
          admin: accountability2.admin,
          app: accountability2.app
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Role not found.";
      const wrapped = new Error(message);
      wrapped.status = 404;
      throw wrapped;
    }
  }
  const usersService = new context.services.UsersService({
    schema,
    accountability: null,
    knex: context.database
  });
  let user;
  try {
    user = await usersService.readOne(principalId, {
      fields: ["id", "first_name", "last_name", "email", "role"]
    });
  } catch {
    const error = new Error(`User "${principalId}" was not found.`);
    error.status = 404;
    throw error;
  }
  const roleId = user.role ? String(user.role) : null;
  const roles = roleId ? await fetchRolesTree(roleId, { knex: context.database }) : [];
  const globalAccess = await fetchGlobalAccess(
    {
      user: principalId,
      roles,
      ip
    },
    { knex: context.database }
  );
  const accountability = createDefaultAccountability({
    user: principalId,
    role: roleId,
    roles,
    admin: globalAccess.admin,
    app: globalAccess.app,
    ip
  });
  const firstName = typeof user.first_name === "string" ? user.first_name : "";
  const lastName = typeof user.last_name === "string" ? user.last_name : "";
  const fullName = `${firstName} ${lastName}`.trim();
  const email = typeof user.email === "string" ? user.email : null;
  return {
    accountability,
    principal: {
      id: principalId,
      label: fullName || email || principalId,
      roleId,
      admin: accountability.admin,
      app: accountability.app
    }
  };
}
export {
  comparePermissions,
  listCollections,
  listRoles,
  listUsers,
  simulatePermissions
};
