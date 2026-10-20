import {
  assertAdmin,
  parseCompareQuery,
  parseExecutionId,
  parseExecutionsQuery
} from "./validation.js";

function registerRoutes(router, engineContext, engine) {
  router.get("/meta", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const flows = await engine.listFlows(engineContext);
      res.json({
        flows,
        caveats: [
          "Only completed runs are stored by Directus.",
          'Set flow accountability to "All" to capture step inputs, outputs, and errors.',
          "Secrets and sensitive headers are redacted by Directus before storage.",
          "Retry, live monitoring, and per-step timing are not part of this read-only MVP."
        ]
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/executions", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const query = parseExecutionsQuery(req.query);
      const result = await engine.listExecutions(query, engineContext);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/compare", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const request = parseCompareQuery(req.query);
      const result = await engine.compareExecutions(request, engineContext);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/executions/:id", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const id = parseExecutionId(req.params?.id);
      const result = await engine.getExecution(id, engineContext);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });
}

function sendError(res, error) {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : 500;
  const message = error instanceof Error ? error.message : "Unexpected error.";
  res.status(status).json({
    errors: [
      {
        message,
        extensions: {
          code: errorCode(status)
        }
      }
    ]
  });
}

function errorCode(status) {
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 400) return "INVALID_PAYLOAD";
  return "INTERNAL_SERVER_ERROR";
}

export {
  registerRoutes,
  sendError
};
