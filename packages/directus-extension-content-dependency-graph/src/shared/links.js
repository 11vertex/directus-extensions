// App routes (relative to /admin) for opening collections and items in Directus.

const SYSTEM_ITEM_ROUTES = {
  directus_users: "/users",
  directus_files: "/files",
  directus_roles: "/settings/roles",
  directus_policies: "/settings/policies",
  directus_flows: "/settings/flows",
  directus_dashboards: "/insights"
};

const SYSTEM_COLLECTION_ROUTES = {
  directus_users: "/users",
  directus_files: "/files",
  directus_roles: "/settings/roles",
  directus_policies: "/settings/policies",
  directus_flows: "/settings/flows",
  directus_dashboards: "/insights",
  directus_activity: "/activity"
};

export function itemRoute(collection, pk, { singleton = false } = {}) {
  if (pk === null || pk === undefined || pk === "") return null;
  const key = encodeURIComponent(String(pk));
  if (SYSTEM_ITEM_ROUTES[collection]) return `${SYSTEM_ITEM_ROUTES[collection]}/${key}`;
  if (collection.startsWith("directus_")) return null;
  if (singleton) return `/content/${encodeURIComponent(collection)}`;
  return `/content/${encodeURIComponent(collection)}/${key}`;
}

export function collectionRoute(collection) {
  if (SYSTEM_COLLECTION_ROUTES[collection]) return SYSTEM_COLLECTION_ROUTES[collection];
  if (collection.startsWith("directus_")) return null;
  return `/content/${encodeURIComponent(collection)}`;
}

export function dataModelRoute(collection) {
  if (collection.startsWith("directus_")) return null;
  return `/settings/data-model/${encodeURIComponent(collection)}`;
}
