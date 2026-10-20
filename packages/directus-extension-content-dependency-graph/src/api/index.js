import { defineEndpoint } from "@directus/extensions-sdk";
import { analyzeImpact, browseRecords, exploreRecord, findOrphans, getGraph } from "./graph-engine.js";
import { registerRoutes } from "./routes.js";

export default defineEndpoint((router, context) => {
  registerRoutes(
    router,
    { services: context.services, database: context.database, getSchema: context.getSchema },
    { getGraph, browseRecords, exploreRecord, analyzeImpact, findOrphans }
  );
});
