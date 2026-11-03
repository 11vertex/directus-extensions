export function assertAdmin(accountability) {
  if (!accountability?.admin) {
    const error = new Error("Administrator access is required to use Permission Auditor.");
    error.status = 403;
    throw error;
  }
}

export function registerRoutes(router, engineContext, engine) {
  router.get("/audit", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      res.json(await engine.runAudit(engineContext));
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
        extensions: { code: status === 403 ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR" }
      }
    ]
  });
}
