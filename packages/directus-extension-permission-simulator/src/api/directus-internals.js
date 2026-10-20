import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Internal permission helpers, keyed by export name -> path inside @directus/api/dist.
const MODULES = {
  createDefaultAccountability: "permissions/utils/create-default-accountability",
  fetchRolesTree: "permissions/lib/fetch-roles-tree",
  fetchPolicies: "permissions/lib/fetch-policies",
  fetchPermissions: "permissions/lib/fetch-permissions",
  fetchRawPermissions: "permissions/utils/fetch-raw-permissions",
  fetchGlobalAccess: "permissions/modules/fetch-global-access/fetch-global-access",
  fetchAccountabilityCollectionAccess:
    "permissions/modules/fetch-accountability-collection-access/fetch-accountability-collection-access",
  fetchAccountabilityPolicyGlobals:
    "permissions/modules/fetch-accountability-policy-globals/fetch-accountability-policy-globals",
  validateAccess: "permissions/modules/validate-access/validate-access",
  getAccountabilityForRole: "utils/get-accountability-for-role"
};

let internals;

/**
 * Load the helpers from the @directus/api copy the running server uses.
 *
 * The extension can resolve a different copy of @directus/api (e.g. under pnpm), which has
 * its own in-memory system cache. Directus only clears its own cache when policies or
 * permissions change, so a separate copy would keep returning stale access forever.
 */
export function loadInternals({ entry = process.argv[1], importModule = (specifier) => import(specifier) } = {}) {
  internals ??= (async () => {
    const serverApiDir = resolveServerApiDir(entry);
    const loaded = await Promise.all(
      Object.entries(MODULES).map(async ([name, path]) => {
        const specifier = serverApiDir
          ? pathToFileURL(join(serverApiDir, "dist", `${path}.js`)).href
          : `@directus/api/${path}`;
        const module = await importModule(specifier);
        return [name, module[name]];
      })
    );
    return Object.fromEntries(loaded);
  })();

  internals.catch(() => {
    internals = undefined;
  });

  return internals;
}

export function resolveServerApiDir(entry) {
  if (!entry) return null;
  try {
    const require = createRequire(realpathSync(entry));
    return dirname(require.resolve("@directus/api/package.json"));
  } catch {
    return null;
  }
}

export function resetInternals() {
  internals = undefined;
}
