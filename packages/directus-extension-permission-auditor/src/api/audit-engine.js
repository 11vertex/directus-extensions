import { analyzePermissions } from "./analyzer.js";

export async function runAudit(context) {
  const schema = await context.getSchema();
  const read = (Service, fields) =>
    new Service({ schema, accountability: null, knex: context.database }).readByQuery({ fields, limit: -1 });

  const [policies, permissions, access, roles] = await Promise.all([
    read(context.services.PoliciesService, ["id", "name", "admin_access", "app_access", "enforce_tfa"]),
    read(context.services.PermissionsService, ["id", "policy", "collection", "action", "fields", "permissions", "validation"]),
    read(context.services.AccessService, ["id", "role", "user", "policy"]),
    read(context.services.RolesService, ["id", "name"])
  ]);

  return {
    generatedAt: new Date().toISOString(),
    ...analyzePermissions({ policies, permissions, access, roles })
  };
}
