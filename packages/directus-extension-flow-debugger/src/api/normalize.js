const RESERVED_KEYS = new Set(["$trigger", "$last", "$accountability", "$env"]);

function normalizeExecutionSummary(activity, flowMap = /* @__PURE__ */ new Map()) {
  const flowId = activity.item ? String(activity.item) : null;
  const flow = flowId ? flowMap.get(flowId) ?? null : null;
  const revision = firstRevision(activity.revisions);
  const revisionData = asObject(revision?.data);
  const steps = Array.isArray(revisionData?.steps) ? revisionData.steps : [];
  const hasDetails = steps.length > 0 || Boolean(revisionData?.data);
  const finalStatus = deriveFinalStatus(steps);

  return {
    id: Number(activity.id),
    flowId,
    flowName: flow?.name ?? null,
    flowAccountability: flow?.accountability ?? null,
    completedAt: activity.timestamp ?? null,
    userId: activity.user ? String(activity.user) : null,
    ip: activity.ip ?? null,
    origin: activity.origin ?? null,
    userAgent: activity.user_agent ?? null,
    revisionId: revision?.id ?? null,
    hasDetails,
    finalStatus,
    stepCount: steps.length,
    failedStepKey: findFailedStepKey(steps)
  };
}

function normalizeExecutionDetail(activity, flowMap = /* @__PURE__ */ new Map(), operationsMap = /* @__PURE__ */ new Map()) {
  const summary = normalizeExecutionSummary(activity, flowMap);
  const revision = firstRevision(activity.revisions);
  const revisionData = asObject(revision?.data);
  const rawSteps = Array.isArray(revisionData?.steps) ? revisionData.steps : [];
  const keyedData = asObject(revisionData?.data) ?? {};

  const steps = rawSteps.map((step, index) => {
    const key = typeof step?.key === "string" ? step.key : `step_${index}`;
    const operationId = step?.operation ? String(step.operation) : null;
    const operation = operationId ? operationsMap.get(operationId) ?? null : null;
    const status = normalizeStepStatus(step?.status);
    const result = Object.prototype.hasOwnProperty.call(keyedData, key) ? keyedData[key] : null;

    return {
      index,
      operationId,
      key,
      status,
      type: operation?.type ?? null,
      name: operation?.name ?? null,
      options: step?.options ?? null,
      result,
      isError: status === "reject"
    };
  });

  const variables = {};
  for (const [key, value] of Object.entries(keyedData)) {
    if (RESERVED_KEYS.has(key)) continue;
    variables[key] = value;
  }

  return {
    ...summary,
    trigger: Object.prototype.hasOwnProperty.call(keyedData, "$trigger") ? keyedData.$trigger : null,
    last: Object.prototype.hasOwnProperty.call(keyedData, "$last") ? keyedData.$last : null,
    accountability: Object.prototype.hasOwnProperty.call(keyedData, "$accountability")
      ? keyedData.$accountability
      : null,
    env: Object.prototype.hasOwnProperty.call(keyedData, "$env") ? keyedData.$env : null,
    variables,
    steps,
    warnings: buildWarnings(summary, revisionData)
  };
}

function compareExecutionDetails(baseline, comparison) {
  const baselineSteps = new Map((baseline.steps ?? []).map((step) => [step.key, step]));
  const comparisonSteps = new Map((comparison.steps ?? []).map((step) => [step.key, step]));
  const stepKeys = unique([
    ...(baseline.steps ?? []).map((step) => step.key),
    ...(comparison.steps ?? []).map((step) => step.key)
  ]);

  const steps = stepKeys.map((key) => {
    const left = baselineSteps.get(key) ?? null;
    const right = comparisonSteps.get(key) ?? null;
    let change = "same";

    if (!left) change = "added";
    else if (!right) change = "removed";
    else if (left.status !== right.status) change = "status_changed";
    else if (!isEqual(left.options, right.options) || !isEqual(left.result, right.result)) {
      change = "data_changed";
    }

    return {
      key,
      change,
      baseline: left,
      comparison: right
    };
  });

  const variableKeys = unique([
    ...Object.keys(baseline.variables ?? {}),
    ...Object.keys(comparison.variables ?? {})
  ]).sort((a, b) => a.localeCompare(b));
  const variables = variableKeys.map((key) => {
    const leftExists = Object.prototype.hasOwnProperty.call(baseline.variables ?? {}, key);
    const rightExists = Object.prototype.hasOwnProperty.call(comparison.variables ?? {}, key);
    const left = leftExists ? baseline.variables[key] : null;
    const right = rightExists ? comparison.variables[key] : null;
    return {
      key,
      change: !leftExists ? "added" : !rightExists ? "removed" : isEqual(left, right) ? "same" : "changed",
      baseline: left,
      comparison: right
    };
  });

  const changedSteps = steps.filter((step) => step.change !== "same");
  const changedVariables = variables.filter((variable) => variable.change !== "same");

  return {
    flowId: baseline.flowId,
    flowName: baseline.flowName ?? comparison.flowName ?? null,
    baseline: executionIdentity(baseline),
    comparison: executionIdentity(comparison),
    summary: {
      baselineStatus: baseline.finalStatus,
      comparisonStatus: comparison.finalStatus,
      statusChanged: baseline.finalStatus !== comparison.finalStatus,
      firstDivergenceKey: changedSteps[0]?.key ?? null,
      changedSteps: changedSteps.length,
      addedSteps: steps.filter((step) => step.change === "added").length,
      removedSteps: steps.filter((step) => step.change === "removed").length,
      changedVariables: changedVariables.length,
      triggerChanged: !isEqual(baseline.trigger, comparison.trigger)
    },
    trigger: {
      changed: !isEqual(baseline.trigger, comparison.trigger),
      baseline: baseline.trigger,
      comparison: comparison.trigger
    },
    steps,
    variables
  };
}

function executionIdentity(detail) {
  return {
    id: detail.id,
    finalStatus: detail.finalStatus,
    completedAt: detail.completedAt,
    userId: detail.userId,
    stepCount: detail.stepCount,
    failedStepKey: detail.failedStepKey
  };
}

function isEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)])
    );
  }
  return value;
}

function unique(values) {
  return [...new Set(values)];
}

function deriveFinalStatus(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return "unknown";
  return normalizeStepStatus(steps[steps.length - 1]?.status);
}

function findFailedStepKey(steps) {
  if (!Array.isArray(steps)) return null;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (normalizeStepStatus(steps[i]?.status) === "reject") {
      return typeof steps[i]?.key === "string" ? steps[i].key : null;
    }
  }
  return null;
}

function normalizeStepStatus(status) {
  if (status === "resolve" || status === "reject") return status;
  return "unknown";
}

function firstRevision(revisions) {
  if (!Array.isArray(revisions) || revisions.length === 0) return null;
  return revisions[0] ?? null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function buildWarnings(summary, revisionData) {
  const warnings = [];
  if (!summary.hasDetails) {
    if (summary.flowAccountability === "activity") {
      warnings.push(
        'This flow is set to accountability "activity", so Directus stored a run timestamp but no step payload.'
      );
    } else if (summary.flowAccountability === null) {
      warnings.push("This flow has accountability disabled, so Directus does not persist step details.");
    } else {
      warnings.push(
        "No revision payload was found for this run. The process may have crashed before logging finished, or retention removed the detail."
      );
    }
  }
  if (revisionData && summary.flowAccountability === "all" && (!revisionData.steps || revisionData.steps.length === 0)) {
    warnings.push("Revision data exists but contains no steps.");
  }
  return warnings;
}

export {
  compareExecutionDetails,
  deriveFinalStatus,
  findFailedStepKey,
  normalizeExecutionDetail,
  normalizeExecutionSummary,
  normalizeStepStatus
};
