import { defineEndpoint } from "@directus/extensions-sdk";
import {
  compareExecutions,
  getExecution,
  listExecutions,
  listFlows
} from "./flow-engine.js";
import { registerRoutes } from "./routes.js";

export default defineEndpoint((router, context) => {
  const engineContext = {
    services: context.services,
    database: context.database,
    getSchema: context.getSchema
  };

  registerRoutes(router, engineContext, {
    listFlows,
    listExecutions,
    getExecution,
    compareExecutions
  });
});
