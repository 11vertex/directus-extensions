import {
  assertAdmin,
  parseActivityId,
  parseCompareQuery,
  parseGraphQuery,
  parseHistoryQuery
} from "./validation.js";

function registerRoutes(router, engineContext, engine) {
  router.get("/meta", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      res.json({
        flows: await engine.listFlows(engineContext),
        caveats: [
          "This extension reads native activity/revisions and creates no tables.",
          "Flow and operation edits are stored as separate events.",
          "Delete activity has no revision snapshot in Directus.",
          "Graph cards reconstruct history; edges may be incomplete.",
          "Restore is intentionally not supported."
        ]
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/history", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const query = parseHistoryQuery(req.query);
      res.json(await engine.listHistory(query, engineContext));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/graph", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const query = parseGraphQuery(req.query);
      res.json(await engine.getFlowGraph(query, engineContext));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/compare", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const request = parseCompareQuery(req.query);
      res.json(await engine.compareHistory(request, engineContext));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/history/:id", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const id = parseActivityId(req.params?.id);
      res.json(await engine.getHistoryDetail(id, engineContext));
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
        extensions: { code: errorCode(status) }
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

export { registerRoutes, sendError };
