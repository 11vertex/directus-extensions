import { assertAdmin, parseCompareRequest, parseSimulateRequest } from "./validation.js";
function registerRoutes(router, engineContext, engine) {
  router.get("/meta", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const [users, roles, collections] = await Promise.all([
        engine.listUsers(engineContext),
        engine.listRoles(engineContext),
        engine.listCollections(engineContext)
      ]);
      res.json({ users, roles, collections });
    } catch (error) {
      sendError(res, error);
    }
  });
  router.post("/simulate", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const request = parseSimulateRequest(req.body);
      const result = await engine.simulatePermissions(
        request,
        req.accountability,
        engineContext
      );
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });
  router.post("/compare", async (req, res) => {
    try {
      assertAdmin(req.accountability);
      const request = parseCompareRequest(req.body);
      const result = await engine.comparePermissions(
        request,
        req.accountability,
        engineContext
      );
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });
}
function sendError(res, error) {
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 500;
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
