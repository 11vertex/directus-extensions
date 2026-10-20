import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clients } from "./support/client.mjs";

const { state, admin, editor, anonymous } = clients();

const EXTENSIONS = [
  "@11vertex/directus-extension-activity-cleanup-manager",
  "@11vertex/directus-extension-content-dependency-graph",
  "@11vertex/directus-extension-discord-operation",
  "@11vertex/directus-extension-flow-debugger",
  "@11vertex/directus-extension-flow-version-history",
  "@11vertex/directus-extension-media-usage-analyzer",
  "@11vertex/directus-extension-permission-auditor",
  "@11vertex/directus-extension-permission-simulator",
  "@11vertex/directus-extension-slack-operation",
  "@11vertex/directus-extension-teams-operation"
];

const ADMIN_ENDPOINTS = [
  ["GET", "/permission-simulator/meta"],
  ["POST", "/permission-simulator/simulate"],
  ["GET", "/permission-auditor/audit"],
  ["GET", "/flow-debugger/meta"],
  ["GET", "/flow-debugger/executions"],
  ["GET", "/flow-version-history/meta"],
  ["GET", "/media-usage-analyzer/scan"],
  ["POST", "/media-usage-analyzer/delete"],
  ["GET", "/content-dependency-graph/graph"],
  ["GET", "/activity-cleanup-manager/overview"],
  ["POST", "/activity-cleanup-manager/purge"]
];

describe("all extensions", () => {
  it("are installed and enabled", async () => {
    const extensions = await admin.ok("GET", "/extensions");
    const names = extensions.map((extension) => extension.schema?.name ?? extension.name);
    for (const name of EXTENSIONS) {
      assert.ok(names.includes(name), `${name} is not loaded (loaded: ${names.join(", ")})`);
    }
    for (const extension of extensions.filter((entry) => EXTENSIONS.includes(entry.schema?.name))) {
      assert.notEqual(extension.meta?.enabled, false, `${extension.schema.name} is disabled`);
    }
  });

  it("ship their app code to the Data Studio", async () => {
    const response = await fetch(`${state.baseUrl}/extensions/sources/index.js`, {
      headers: { authorization: `Bearer ${state.adminToken}` }
    });
    assert.equal(response.status, 200);
    const source = await response.text();
    for (const id of [
      "permission-simulator",
      "permission-auditor",
      "flow-debugger",
      "flow-version-history",
      "media-usage-analyzer",
      "content-dependency-graph",
      "activity-cleanup-manager"
    ]) {
      assert.ok(source.includes(id), `module "${id}" missing from the app bundle`);
    }
    for (const operation of ["discord", "slack", "teams"]) {
      assert.ok(source.includes(`"${operation}"`), `operation "${operation}" missing from the app bundle`);
    }
  });

  for (const [method, path] of ADMIN_ENDPOINTS) {
    it(`${method} ${path} rejects non-admins`, async () => {
      for (const client of [editor, anonymous]) {
        const response = method === "GET" ? await client.get(path) : await client.post(path, {});
        assert.equal(response.status, 403, `${path} returned ${response.status} for a non-admin`);
      }
    });
  }
});
