const CODES = {
  400: "INVALID_QUERY",
  403: "FORBIDDEN",
  404: "NOT_FOUND"
};

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function errorCode(status) {
  return CODES[status] ?? "INTERNAL_SERVER_ERROR";
}
