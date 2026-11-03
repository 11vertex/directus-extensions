import { runAudit } from "./audit-engine.js";
import { registerRoutes } from "./routes.js";

// Endpoints are plain functions; the SDK helper is a no-op that would pull a large validator into the bundle.
export default (router, context) => {
  registerRoutes(
    router,
    { services: context.services, database: context.database, getSchema: context.getSchema },
    { runAudit }
  );
};
