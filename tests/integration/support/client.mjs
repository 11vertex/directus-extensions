import { readFileSync } from "node:fs";

export function loadState() {
  const path = process.env.DX_STATE_FILE;
  if (!path) throw new Error("DX_STATE_FILE is not set. Run the suite with `pnpm test:integration`.");
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Small REST client for the throwaway Directus instance. */
export function createClient(baseUrl, token) {
  async function request(method, path, body) {
    const isForm = body instanceof FormData;
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body && !isForm ? { "content-type": "application/json" } : {})
      },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data };
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    patch: (path, body) => request("PATCH", path, body),
    delete: (path) => request("DELETE", path),
    /** Like request(), but throws unless the status is 2xx; returns `data.data` when present. */
    async ok(method, path, body) {
      const result = await request(method, path, body);
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`${method} ${path} -> ${result.status}: ${JSON.stringify(result.data)}`);
      }
      return result.data?.data ?? result.data;
    }
  };
}

export function clients() {
  const state = loadState();
  return {
    state,
    admin: createClient(state.baseUrl, state.adminToken),
    editor: createClient(state.baseUrl, state.editorToken),
    anonymous: createClient(state.baseUrl, null)
  };
}

export async function capturedRequests(state) {
  const response = await fetch(`${state.captureUrl}/requests`);
  return response.json();
}

export async function waitFor(check, { timeout = 15000, interval = 250, message = "condition" } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timed out waiting for ${message}`);
}
