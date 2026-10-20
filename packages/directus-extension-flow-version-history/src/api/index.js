import { defineEndpoint } from "@directus/extensions-sdk";
import {
  compareHistory,
  getFlowGraph,
  getHistoryDetail,
  listFlows,
  listHistory
} from "./history-engine.js";
import { registerRoutes } from "./routes.js";

export default defineEndpoint((router, context) => {
  const engineContext = {
    services: context.services,
    database: context.database,
    getSchema: context.getSchema
  };
  registerRoutes(router, engineContext, {
    listFlows,
    listHistory,
    getHistoryDetail,
    getFlowGraph,
    compareHistory
  });
});
