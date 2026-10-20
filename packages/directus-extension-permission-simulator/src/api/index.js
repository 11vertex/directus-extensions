import { defineEndpoint } from "@directus/extensions-sdk";
import {
  comparePermissions,
  listCollections,
  listRoles,
  listUsers,
  simulatePermissions
} from "./permission-engine.js";
import { registerRoutes } from "./routes.js";
var index_default = defineEndpoint((router, context) => {
  const engineContext = {
    services: context.services,
    database: context.database,
    getSchema: context.getSchema
  };
  registerRoutes(router, engineContext, {
    listUsers,
    listRoles,
    listCollections,
    simulatePermissions,
    comparePermissions
  });
});
export {
  index_default as default
};
