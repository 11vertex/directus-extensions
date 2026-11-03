import { defineEndpoint } from "@directus/extensions-sdk";
import { runAudit } from "./audit-engine.js";
import { registerRoutes } from "./routes.js";

export default defineEndpoint((router, context) => {
  registerRoutes(
    router,
    { services: context.services, database: context.database, getSchema: context.getSchema },
    { runAudit }
  );
});
