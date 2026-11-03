import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { loadInternals, resetInternals, resolveServerApiDir } from "./directus-internals.js";

describe("directus internals loader", () => {
  beforeEach(() => resetInternals());

  it("returns null when the server entry cannot be resolved", () => {
    assert.equal(resolveServerApiDir(null), null);
    assert.equal(resolveServerApiDir("/definitely/missing/cli.js"), null);
  });

  it("falls back to bare @directus/api specifiers without a server entry", async () => {
    const seen = [];
    const internals = await loadInternals({
      entry: null,
      importModule: async (specifier) => {
        seen.push(specifier);
        return new Proxy({}, { get: (_, name) => `fn:${String(name)}` });
      }
    });
    assert.ok(seen.every((specifier) => specifier.startsWith("@directus/api/")));
    assert.equal(internals.fetchPolicies, "fn:fetchPolicies");
    assert.equal(Object.keys(internals).length, 10);
  });

  it("loads once and retries after a failure", async () => {
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("nope");
    };
    await assert.rejects(loadInternals({ entry: null, importModule: failing }));
    const ok = await loadInternals({ entry: null, importModule: async () => ({ fetchPolicies: 1 }) });
    assert.ok(calls > 0);
    assert.ok("fetchPolicies" in ok);
  });
});
