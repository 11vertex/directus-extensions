const TRIGGER_LABELS = {
  event: "Event hook",
  webhook: "Webhook",
  schedule: "Schedule",
  operation: "Another flow",
  manual: "Manual run"
};

function relativeTime(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "unknown time";
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(time).toLocaleDateString();
}

function triggerLabel(trigger) {
  return TRIGGER_LABELS[trigger] ?? "System";
}

function stepLabel(step) {
  return step?.name || step?.key || "Unknown step";
}

function describeStepError(result) {
  if (typeof result === "string" && result.trim()) return result.trim();
  if (Array.isArray(result)) return describeStepError(result[0]);
  if (!result || typeof result !== "object") return "No error message was saved.";
  if (typeof result.message === "string" && result.message) return result.message;
  if (Array.isArray(result.errors)) return describeStepError(result.errors[0]);
  if (typeof result.error === "string" && result.error) return result.error;
  if (result.error && typeof result.error === "object") return describeStepError(result.error);
  if (result.status && result.statusText) return `${result.status} ${result.statusText}`;
  if (result.status) return `Request failed with status ${result.status}`;
  return "No error message was saved.";
}

function findFailedStep(detail) {
  const steps = detail?.steps ?? [];
  if (detail?.failedStepKey) {
    const match = steps.findLast((step) => step.key === detail.failedStepKey);
    if (match) return match;
  }
  return steps.findLast((step) => step.status === "reject") ?? null;
}

function findPreviousSuccessfulRun(run, candidates) {
  if (!run) return null;
  return (
    (candidates ?? [])
      .filter(
        (item) =>
          item.flowId === run.flowId &&
          item.finalStatus === "resolve" &&
          item.hasDetails &&
          item.id < run.id
      )
      .sort((left, right) => right.id - left.id)[0] ?? null
  );
}

function describeComparison(result) {
  if (!result) return [];
  const lines = [];
  const { baselineStatus, comparisonStatus } = result.summary ?? {};
  if (baselineStatus !== comparisonStatus) {
    lines.push({
      key: "status",
      tone: comparisonStatus === "reject" ? "danger" : "success",
      text:
        comparisonStatus === "reject"
          ? "This run failed, but the last successful run did not."
          : "This run succeeded where the other run did not."
    });
  }

  if (result.trigger?.changed) {
    lines.push({
      key: "trigger",
      tone: "warning",
      text: "The data that started the flow was different.",
      before: result.trigger.baseline,
      after: result.trigger.comparison
    });
  }

  for (const step of result.steps ?? []) {
    if (step.change === "same") continue;
    const name = stepLabel(step.comparison ?? step.baseline ?? { key: step.key });
    lines.push({
      key: `step-${step.key}`,
      tone: step.change === "status_changed" ? "danger" : "warning",
      text: stepChangeText(step, name),
      before: step.baseline?.result,
      after: step.comparison?.result
    });
  }

  return lines;
}

function stepChangeText(step, name) {
  if (step.change === "added") return `‘${name}’ ran this time, but not in the successful run.`;
  if (step.change === "removed") return `‘${name}’ ran in the successful run, but not this time.`;
  if (step.change === "status_changed") {
    return step.comparison?.status === "reject"
      ? `‘${name}’ failed this time, but worked before.`
      : `‘${name}’ worked this time, but failed before.`;
  }
  return `‘${name}’ produced different data.`;
}

export {
  describeComparison,
  describeStepError,
  findFailedStep,
  findPreviousSuccessfulRun,
  relativeTime,
  stepLabel,
  triggerLabel
};
