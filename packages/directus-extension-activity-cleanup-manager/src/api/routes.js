import { parsePurgeRequest } from "./validation.js";

const ERROR_CODES = { 400: "INVALID_PAYLOAD", 403: "FORBIDDEN", 409: "CONFLICT" };

export function assertAdmin(accountability) {
  if (!accountability?.admin) {
    const error = new Error("Administrator access is required to use Activity & Revisions Cleanup Manager.");
    error.status = 403;
    throw error;
  }
}

export function registerRoutes(router, engineContext, engine) {
  router.get("/overview", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      res.json(await engine.getOverview(engineContext));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/retention", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      res.json(engine.getRetention(engineContext));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/purge", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const retention = engine.getRetention(engineContext);
      const request = parsePurgeRequest(req.body, { defaultBatchSize: retention.batch ?? undefined });
      res.json(await engine.purge(engineContext, request));
    } catch (error) {
      sendError(res, error);
    }
  });
}

export function sendError(res, error) {
  const status = typeof error?.status === "number" ? error.status : 500;
  res.status(status).json({
    errors: [
      {
        message: error instanceof Error ? error.message : "Unexpected error.",
        extensions: { code: ERROR_CODES[status] ?? "INTERNAL_SERVER_ERROR" }
      }
    ]
  });
}
