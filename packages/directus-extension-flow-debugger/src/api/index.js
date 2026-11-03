import {
  compareExecutions,
  getExecution,
  listExecutions,
  listFlows
} from "./flow-engine.js";
import { registerRoutes } from "./routes.js";

// Endpoints are plain functions; the SDK helper is a no-op that would pull a large validator into the bundle.
export default (router, context) => {
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
};
