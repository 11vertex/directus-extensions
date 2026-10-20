import { formatBytes, formatNumber } from "./format.js";

const KIND_LABELS = { image: "Images", video: "Video", document: "Documents" };

/** Folds the per-category storage breakdown into Images / Video / Documents / Other. */
export function storageByKind(byCategory = []) {
  const totals = new Map(["Images", "Video", "Documents", "Other"].map((label) => [label, { label, files: 0, bytes: 0 }]));
  for (const entry of byCategory) {
    const target = totals.get(KIND_LABELS[entry.key] ?? "Other");
    target.files += Number(entry.files) || 0;
    target.bytes += Number(entry.bytes) || 0;
  }
  return [...totals.values()].filter((entry) => entry.files > 0).sort((a, b) => b.bytes - a.bytes);
}

/** The summary card most worth acting on, or null when nothing needs attention. */
export function focusCard(summary) {
  if (summary.unusedFiles > 0 || summary.duplicateGroups > 0) {
    return summary.duplicateWastedBytes > summary.unusedBytes ? "duplicates" : "unused";
  }
  if (summary.brokenReferences > 0) return "broken";
  if (summary.largeImages > 0) return "large";
  return null;
}

const SKIP_REASONS = {
  in_use: ["it is now used", "they are now used"],
  not_found: ["it was already deleted", "they were already deleted"],
  unverified: ["it could not be checked", "they could not be checked"],
  invalid: ["its id is invalid", "their ids are invalid"],
  error: ["deleting it failed", "deleting them failed"]
};

/**
 * One plain sentence for a delete run, e.g. "12 deleted, 1 skipped because it is now used".
 * Combines the dry-run preview (skipped before deleting) with the real run.
 */
export function deletionResultText(preview, deletion) {
  const counts = {};
  const add = (summary = {}) => {
    for (const [status, count] of Object.entries(summary)) counts[status] = (counts[status] ?? 0) + count;
  };
  add(preview?.summary);
  add(deletion?.summary);
  delete counts.would_delete;

  const parts = [`${formatNumber(counts.deleted ?? 0)} deleted`];
  for (const [status, [one, many]] of Object.entries(SKIP_REASONS)) {
    const count = counts[status];
    if (count) parts.push(`${formatNumber(count)} skipped because ${count === 1 ? one : many}`);
  }
  return parts.join(", ");
}

export function filesLabel(count, bytes) {
  return `${formatNumber(count)} ${count === 1 ? "file" : "files"} (${formatBytes(bytes)})`;
}
