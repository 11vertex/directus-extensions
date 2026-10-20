const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key|token|webhook|private[_-]?key)/i;

function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!isPlainObject(value)) return value;

  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    if (typeof nested === "string" && looksLikeSecret(nested)) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = redactValue(nested);
  }
  return result;
}

function looksLikeSecret(value) {
  if (/https?:\/\/discord(?:app)?\.com\/api\/webhooks\//i.test(value)) return true;
  if (/Bearer\s+\S+/i.test(value)) return true;
  return false;
}

function stripRelationalFields(value, collection) {
  if (!isPlainObject(value)) return value;
  const omit =
    collection === "directus_flows"
      ? ["operation", "operations", "user_created"]
      : ["flow", "resolve", "reject", "user_created"];
  const result = { ...value };
  for (const key of omit) delete result[key];
  return result;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export { redactValue, stripRelationalFields };
