import { validateDeleteRequest } from "./cleanup.js";

const ERROR_CODES = { 400: "INVALID_PAYLOAD", 403: "FORBIDDEN" };

export function assertAdmin(accountability) {
  if (!accountability?.admin) {
    const error = new Error("Administrator access is required to use Media Usage Analyzer.");
    error.status = 403;
    throw error;
  }
}

export function registerRoutes(router, engineContext, engine) {
  router.get("/scan", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const content = ["true", "1"].includes(String(req.query?.content ?? "").toLowerCase());
      res.json(await engine.runScan(engineContext, { content }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/delete", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const { ids, dryRun } = validateDeleteRequest(req.body);
      res.json(await engine.deleteUnusedFiles(engineContext, { ids, dryRun, accountability: req.accountability }));
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
