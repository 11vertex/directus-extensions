import { defineEndpoint } from "@directus/extensions-sdk";
import { getOverview, getRetention, purge } from "./cleanup-engine.js";
import { registerRoutes } from "./routes.js";

export default defineEndpoint((router, context) => {
  registerRoutes(
    router,
    {
      database: context.database,
      getSchema: context.getSchema,
      // Endpoint context exposes the resolved useEnv() object; process.env is the fallback.
      env: context.env,
      logger: context.logger
    },
    { getOverview, getRetention, purge }
  );
});
