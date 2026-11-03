import { formatBytes } from "../shared/format.js";
import { normalizeId } from "./content-references.js";

export const LIMITS = {
  unused: 1000,
  largest: 50,
  duplicateGroups: 200,
  duplicateFilesPerGroup: 20,
  broken: 500,
  largestImages: 20,
  largeImages: 200,
  missingDimensions: 200
};

export const LARGE_FILE_BYTES = 10 * 1024 * 1024;
export const LARGE_IMAGE_PIXELS = 4000;

const HEURISTICS = {
  checksum: "Same checksum",
  "size-name-type": "Same file size, download name and MIME type (Directus stores no checksum, so this is a heuristic)"
};

/**
 * Builds the full media report from raw rows.
 * @param {object} input
 * @param {object[]} input.files rows from directus_files
 * @param {object[]} [input.folders] rows from directus_folders
 * @param {object[]} [input.sources] reference sources, each with `references: Map<fileId, count>`
 * @param {string|null} [input.checksumField] checksum column when one exists
 * @param {boolean} [input.contentScanned] whether `/assets/<uuid>` content links were scanned
 * @param {string[]} [input.warnings] non-fatal scan problems
 */
export function analyzeMedia({ files = [], folders = [], sources = [], checksumField = null, contentScanned = false, warnings = [] }) {
  const normalized = files.map((file) => normalizeFile(file, checksumField));
  const fileIds = new Set(normalized.map((file) => file.id));
  const folderNames = new Map(folders.map((folder) => [normalizeId(folder.id), folder.name ?? String(folder.id)]));

  const referenceCounts = new Map();
  const referencedBy = new Map();
  const usage = [];
  const broken = [];

  for (const source of sources) {
    let references = 0;
    let distinct = 0;
    let brokenCount = 0;
    let brokenDistinct = 0;

    for (const [rawId, rawCount] of source.references ?? new Map()) {
      const id = normalizeId(rawId);
      const count = Number(rawCount) || 0;
      references += count;
      distinct += 1;

      if (!fileIds.has(id)) {
        brokenCount += count;
        brokenDistinct += 1;
        broken.push({
          fileId: id,
          count,
          source: source.id,
          label: source.label,
          collection: source.collection,
          field: source.field,
          kind: source.kind,
          usageCollection: source.usageCollection ?? source.collection,
          usageField: source.usageField ?? source.field
        });
        continue;
      }

      referenceCounts.set(id, (referenceCounts.get(id) ?? 0) + count);
      const labels = referencedBy.get(id) ?? new Set();
      labels.add(source.label);
      referencedBy.set(id, labels);
    }

    usage.push({
      source: source.id,
      label: source.label,
      collection: source.collection,
      usageCollection: source.usageCollection ?? source.collection,
      field: source.field,
      kind: source.kind,
      system: Boolean(source.system),
      references,
      distinctFiles: distinct - brokenDistinct,
      broken: brokenCount,
      truncated: Boolean(source.truncated)
    });
  }

  const unused = normalized.filter((file) => !referenceCounts.has(file.id)).sort(bySizeDesc);
  const totalBytes = sum(normalized, (file) => file.filesize);
  const unusedBytes = sum(unused, (file) => file.filesize);
  const duplicates = findDuplicates(normalized, checksumField);
  const images = analyzeImages(normalized);
  const largeFiles = normalized.filter((file) => file.filesize >= LARGE_FILE_BYTES);

  const storage = {
    byStorage: aggregate(normalized, (file) => file.storage ?? "unknown"),
    byFolder: aggregate(normalized, (file) => file.folder ?? "").map((entry) => ({
      ...entry,
      name: entry.key ? folderNames.get(entry.key) ?? entry.key : "Root (no folder)"
    })),
    byType: aggregate(normalized, (file) => file.type ?? "unknown"),
    byCategory: aggregate(normalized, (file) => categoryOf(file.type))
  };

  const usageByCollection = aggregateUsage(usage);

  const report = {
    summary: {
      files: normalized.length,
      totalBytes,
      usedFiles: normalized.length - unused.length,
      unusedFiles: unused.length,
      unusedBytes,
      duplicateGroups: duplicates.groupCount,
      duplicateFiles: duplicates.fileCount,
      duplicateWastedBytes: duplicates.wastedBytes,
      brokenReferences: sum(broken, (entry) => entry.count),
      brokenFileIds: new Set(broken.map((entry) => entry.fileId)).size,
      largeFiles: largeFiles.length,
      largeFilesBytes: sum(largeFiles, (file) => file.filesize),
      images: images.total,
      imagesMissingDimensions: images.missingCount,
      oversizedImages: images.oversizedCount,
      largeImages: images.large.length,
      largeImagesBytes: sum(images.large, (file) => file.filesize),
      sources: sources.length,
      contentScanned,
      incomplete: warnings.length > 0
    },
    storage,
    largestFiles: [...normalized].sort(bySizeDesc).slice(0, LIMITS.largest),
    unusedFiles: unused.slice(0, LIMITS.unused),
    unusedTruncated: unused.length > LIMITS.unused,
    duplicates: {
      heuristic: duplicates.heuristic,
      label: HEURISTICS[duplicates.heuristic],
      groups: duplicates.groups.slice(0, LIMITS.duplicateGroups),
      truncated: duplicates.groups.length > LIMITS.duplicateGroups
    },
    broken: broken.sort((a, b) => b.count - a.count).slice(0, LIMITS.broken),
    brokenTruncated: broken.length > LIMITS.broken,
    images: {
      total: images.total,
      withDimensions: images.withDimensions,
      missingCount: images.missingCount,
      oversizedCount: images.oversizedCount,
      largest: images.largest,
      large: images.large.slice(0, LIMITS.largeImages),
      largeTruncated: images.large.length > LIMITS.largeImages,
      missingDimensions: images.missing.slice(0, LIMITS.missingDimensions)
    },
    usage: usage.sort((a, b) => b.references - a.references),
    usageByCollection,
    warnings
  };

  report.recommendations = buildRecommendations(report);
  return report;
}

export function normalizeFile(file, checksumField = null) {
  return {
    id: normalizeId(file.id),
    filename_download: file.filename_download ?? null,
    title: file.title ?? null,
    type: file.type ?? null,
    filesize: Number(file.filesize) || 0,
    width: toDimension(file.width),
    height: toDimension(file.height),
    folder: normalizeId(file.folder),
    uploaded_on: file.uploaded_on ?? null,
    storage: file.storage ?? null,
    checksum: (checksumField ? file[checksumField] : file.checksum) ?? null
  };
}

export function categoryOf(type) {
  if (!type) return "unknown";
  if (type === "application/pdf") return "document";
  const [major] = type.split("/");
  if (["image", "video", "audio", "text", "font"].includes(major)) return major;
  if (/word|excel|spreadsheet|presentation|powerpoint|opendocument|rtf/.test(type)) return "document";
  if (/zip|tar|gzip|rar|7z|compressed/.test(type)) return "archive";
  return "other";
}

export function findDuplicates(files, checksumField = null) {
  const hasChecksum = Boolean(checksumField) && files.some((file) => file.checksum);
  const heuristic = hasChecksum ? "checksum" : "size-name-type";
  const keyOf = hasChecksum
    ? (file) => (file.checksum ? `checksum:${file.checksum}` : null)
    : (file) => (file.filesize > 0 && file.filename_download
      ? `${file.filesize}|${file.filename_download.toLowerCase()}|${file.type ?? ""}`
      : null);

  const buckets = new Map();
  for (const file of files) {
    const key = keyOf(file);
    if (!key) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(file);
    buckets.set(key, bucket);
  }

  const groups = [...buckets.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([key, bucket]) => {
      const sorted = [...bucket].sort((a, b) => String(a.uploaded_on ?? "").localeCompare(String(b.uploaded_on ?? "")));
      return {
        key,
        filename: sorted[0].filename_download,
        type: sorted[0].type,
        filesize: sorted[0].filesize,
        count: bucket.length,
        wastedBytes: sorted[0].filesize * (bucket.length - 1),
        files: sorted.slice(0, LIMITS.duplicateFilesPerGroup)
      };
    })
    .sort((a, b) => b.wastedBytes - a.wastedBytes);

  return {
    heuristic,
    groups,
    groupCount: groups.length,
    fileCount: sum(groups, (group) => group.count),
    wastedBytes: sum(groups, (group) => group.wastedBytes)
  };
}

export function analyzeImages(files) {
  const images = files.filter((file) => file.type?.startsWith("image/"));
  // SVGs are vector images; Directus often leaves their dimensions empty, so they are not "missing" metadata.
  const raster = images.filter((file) => file.type !== "image/svg+xml");
  const missing = raster.filter((file) => !file.width || !file.height).sort(bySizeDesc);
  const measured = images.filter((file) => file.width && file.height);
  const oversized = measured.filter(isOversized);
  // "Large" images: wider or taller than LARGE_IMAGE_PIXELS, or heavier than LARGE_FILE_BYTES.
  const large = images.filter((file) => isOversized(file) || file.filesize >= LARGE_FILE_BYTES).sort(bySizeDesc);

  return {
    total: images.length,
    withDimensions: measured.length,
    missing,
    missingCount: missing.length,
    oversizedCount: oversized.length,
    large,
    largest: [...measured]
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .slice(0, LIMITS.largestImages)
      .map((file) => ({ ...file, megapixels: Math.round((file.width * file.height) / 10_000) / 100 }))
  };
}

export function buildRecommendations(report) {
  const { summary } = report;
  const items = [];
  const add = (level, text) => items.push({ level, text });

  if (summary.incomplete) {
    add("warning", "Some sources could not be scanned (see warnings). Treat unused-file results as incomplete and fix the warnings before deleting anything.");
  }

  if (summary.unusedFiles > 0) {
    add(summary.contentScanned ? "action" : "warning", summary.contentScanned
      ? `${summary.unusedFiles} files (${formatBytes(summary.unusedBytes)}) are not referenced by any file field or content link. Review them, then remove them with the batch delete preview.`
      : `${summary.unusedFiles} files (${formatBytes(summary.unusedBytes)}) are not referenced by any file field. Content links were not scanned, so re-run with "Scan content" before deleting — WYSIWYG/markdown fields may embed them.`);
  }

  if (summary.duplicateGroups > 0) {
    add("action", `${summary.duplicateGroups} groups of likely duplicate uploads waste about ${formatBytes(summary.duplicateWastedBytes)}. Point references at one copy, then delete the others once they show up as unused.`);
  }

  if (summary.brokenReferences > 0) {
    add("action", `${summary.brokenReferences} references point to ${summary.brokenFileIds} file ids that no longer exist. Clear or re-link those values in the listed fields.`);
  }

  if (summary.largeFiles > 0) {
    add("info", `${summary.largeFiles} files are larger than ${formatBytes(LARGE_FILE_BYTES)} (${formatBytes(summary.largeFilesBytes)} in total). Consider compressing them or serving resized versions through asset transformations.`);
  }

  if (summary.oversizedImages > 0) {
    add("info", `${summary.oversizedImages} images exceed ${LARGE_IMAGE_PIXELS}px on one side. Use transformation presets or downscale the originals.`);
  }

  if (summary.imagesMissingDimensions > 0) {
    add("info", `${summary.imagesMissingDimensions} raster images have no width/height metadata. Re-upload them or check that image metadata extraction is working.`);
  }

  if (items.length === 0) add("success", "No cleanup needed — every file is referenced and no duplicates or broken references were found.");

  add("info", "Files can also be used outside Directus fields (external sites hot-linking /assets URLs, flows, presets, dashboards or custom code). Check before deleting anything you are unsure about.");
  return items;
}

function aggregate(files, keyOf) {
  const groups = new Map();
  for (const file of files) {
    const key = keyOf(file);
    const entry = groups.get(key) ?? { key, files: 0, bytes: 0 };
    entry.files += 1;
    entry.bytes += file.filesize;
    groups.set(key, entry);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes || b.files - a.files);
}

function aggregateUsage(usage) {
  const groups = new Map();
  for (const entry of usage) {
    const group = groups.get(entry.usageCollection) ?? { collection: entry.usageCollection, fields: 0, references: 0, broken: 0, system: entry.system };
    group.fields += 1;
    group.references += entry.references;
    group.broken += entry.broken;
    groups.set(entry.usageCollection, group);
  }
  return [...groups.values()].sort((a, b) => b.references - a.references);
}

function isOversized(file) {
  return Boolean(file.width && file.height) && Math.max(file.width, file.height) > LARGE_IMAGE_PIXELS;
}

function toDimension(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function bySizeDesc(a, b) {
  return b.filesize - a.filesize;
}

function sum(items, valueOf) {
  return items.reduce((total, item) => total + (Number(valueOf(item)) || 0), 0);
}
