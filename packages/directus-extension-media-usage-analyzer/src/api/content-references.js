const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ASSET_PATTERN = new RegExp(`/assets/(${UUID})`, "gi");
const UUID_PATTERN = new RegExp(`^${UUID}$`, "i");

export const ASSET_MARKER = "/assets/";

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeId(value) {
  return value === null || value === undefined ? null : String(value).toLowerCase();
}

/** Unique, lower-cased file ids embedded as `/assets/<uuid>` links in a string or JSON value. */
export function extractAssetIds(value) {
  if (value === null || value === undefined) return [];
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text || !text.includes(ASSET_MARKER)) return [];
  return [...new Set([...text.matchAll(ASSET_PATTERN)].map((match) => match[1].toLowerCase()))];
}
