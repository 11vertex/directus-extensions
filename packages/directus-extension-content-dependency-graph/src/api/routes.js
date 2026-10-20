import { errorCode } from "./errors.js";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export function assertAdmin(accountability) {
  if (!accountability?.admin) {
    const error = new Error("Administrator access is required to use Content Dependency Graph.");
    error.status = 403;
    throw error;
  }
}

export function parseLimit(value, fallback = DEFAULT_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_LIMIT);
}

function queryString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function registerRoutes(router, engineContext, engine) {
  const route = (path, handler) => {
    router.get(path, async (req, res) => {
      try {
        assertAdmin(req.accountability);
        res.json(await handler(req));
      } catch (error) {
        sendError(res, error);
      }
    });
  };

  route("/graph", () => engine.getGraph(engineContext));

  route("/browse/:collection", (req) =>
    engine.browseRecords(engineContext, {
      collection: req.params.collection,
      search: queryString(req.query?.search),
      limit: parseLimit(req.query?.limit)
    })
  );

  route("/records/:collection/:pk", (req) =>
    engine.exploreRecord(engineContext, {
      collection: req.params.collection,
      pk: req.params.pk,
      limit: parseLimit(req.query?.limit)
    })
  );

  route("/impact/:collection/:pk", (req) =>
    engine.analyzeImpact(engineContext, { collection: req.params.collection, pk: req.params.pk })
  );

  route("/orphans/:collection", (req) =>
    engine.findOrphans(engineContext, { collection: req.params.collection, limit: parseLimit(req.query?.limit) })
  );
}

export function sendError(res, error) {
  const status = typeof error?.status === "number" ? error.status : 500;
  res.status(status).json({
    errors: [
      {
        message: error instanceof Error ? error.message : "Unexpected error.",
        extensions: { code: errorCode(status) }
      }
    ]
  });
}
