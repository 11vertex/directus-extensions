const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), UNITS.length - 1);
  const scaled = value / 1024 ** exponent;
  return `${scaled.toFixed(scaled >= 100 ? 0 : 1)} ${UNITS[exponent]}`;
}

export function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

const TIME_STEPS = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60]
];

/** "5 minutes ago", "last month"… or "—" for empty/invalid values. */
export function timeAgo(value, now = Date.now()) {
  if (!value) return "—";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "—";
  const seconds = Math.round((now - time) / 1000);
  if (Math.abs(seconds) < 60) return "just now";
  const [unit, size] = TIME_STEPS.find(([, step]) => Math.abs(seconds) >= step);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-Math.round(seconds / size), unit);
}

const MAJOR_TYPES = { image: "Image", video: "Video", audio: "Audio", text: "Text", font: "Font" };

/** Short, readable file type such as "Image · JPEG" or "PDF document". */
export function typeLabel(type) {
  if (!type) return "File";
  if (type === "application/pdf") return "PDF document";
  const [major, minor = ""] = type.split("/");
  const format = minor.split("+")[0].split(".").pop().replace(/^x-/, "").toUpperCase();
  if (MAJOR_TYPES[major]) return format ? `${MAJOR_TYPES[major]} · ${format}` : MAJOR_TYPES[major];
  return format || "File";
}
