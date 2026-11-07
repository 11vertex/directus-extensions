import { redactValue } from "./redact.js";

// The flow as it is now, as cards the page can draw: the trigger plus one card per step, with the
// steps each one leads to. A run is drawn on top of this, so steps removed since then are not drawn.
function buildGraph(flow, operations, ranAt = null) {
  if (!flow) return null;
  // Steps added after the run did not exist then, so they are left out of its picture.
  const ranTime = Date.parse(ranAt);
  const existed = (operation) => {
    const created = Date.parse(operation.dateCreated);
    return !Number.isFinite(ranTime) || !Number.isFinite(created) || created <= ranTime;
  };
  const addedSince = operations.filter((operation) => !existed(operation)).length;
  operations = operations.filter(existed);
  const panels = [
    {
      id: "$trigger",
      kind: "trigger",
      name: flow.name ?? "Trigger",
      type: flow.trigger ?? "unknown",
      status: flow.status ?? null,
      options: redactValue(flow.options ?? {}),
      x: 1,
      y: 1,
      resolve: flow.operation ? String(flow.operation) : null,
      reject: null
    }
  ];

  let fallbackX = 16;
  let fallbackY = 1;
  for (const operation of operations) {
    const x = Number(operation.position_x);
    const y = Number(operation.position_y);
    const placed = Number.isFinite(x) && Number.isFinite(y);
    panels.push({
      id: String(operation.id),
      kind: "operation",
      name: operation.name || operation.key || String(operation.id),
      key: operation.key ?? null,
      type: operation.type ?? "unknown",
      options: redactValue(operation.options ?? {}),
      x: placed ? x : fallbackX,
      y: placed ? y : fallbackY,
      resolve: operation.resolve ? String(operation.resolve) : null,
      reject: operation.reject ? String(operation.reject) : null
    });
    if (!placed) {
      fallbackY += 16;
      if (fallbackY > 60) {
        fallbackY = 1;
        fallbackX += 16;
      }
    }
  }

  return { flowId: String(flow.id), panels, addedSince };
}

export { buildGraph };
