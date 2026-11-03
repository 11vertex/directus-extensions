import { getOverview, getRetention, purge } from "./cleanup-engine.js";
import { registerRoutes } from "./routes.js";

// Endpoints are plain functions; the SDK helper is a no-op that would pull a large validator into the bundle.
export default (router, context) => {
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
};
