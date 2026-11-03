// Starts a throwaway Directus (SQLite, temp folder, random port) with every extension in
// packages/ loaded, seeds it, and shares the details with the test files
// through a JSON state file. The project's own .env and Postgres database are never used.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, waitFor } from "./support/client.mjs";
import { SEED, seed } from "./support/seed.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Resolved like any dependency, so it works both in this repo and when the folder sits inside a
// larger workspace whose node_modules is a level up.
const CLI = join(dirname(createRequire(join(ROOT, "package.json")).resolve("directus/package.json")), "cli.js");
const ADMIN = { email: "admin@example.com", password: "admin-password-123" };

let directus;
let captureServer;
let workDir;

function startCaptureServer() {
  const requests = [];
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/capture") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push(JSON.parse(body));
        res.end("ok");
      });
      return;
    }
    if (req.url === "/requests") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(requests));
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolvePromise) => server.listen(0, "127.0.0.1", () => resolvePromise(server)));
}

function freePort() {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePromise(port));
    });
  });
}

async function login(baseUrl, email, password) {
  const client = createClient(baseUrl, null);
  const data = await client.ok("POST", "/auth/login", { email, password });
  return data.access_token;
}

export async function globalSetup() {
  workDir = mkdtempSync(join(tmpdir(), "directus-ext-it-"));
  mkdirSync(join(workDir, "uploads"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  captureServer = await startCaptureServer();
  const captureUrl = `http://127.0.0.1:${captureServer.address().port}`;

  const envFile = join(workDir, ".env");
  writeFileSync(
    envFile,
    [
      "HOST=127.0.0.1",
      `PORT=${port}`,
      `PUBLIC_URL=${baseUrl}`,
      "DB_CLIENT=sqlite3",
      `DB_FILENAME=${join(workDir, "data.db")}`,
      "KEY=integration-key-0123456789abcdef0123456789",
      "SECRET=integration-secret-0123456789abcdef0123456789",
      `ADMIN_EMAIL=${ADMIN.email}`,
      `ADMIN_PASSWORD=${ADMIN.password}`,
      "STORAGE_LOCATIONS=local",
      `STORAGE_LOCAL_ROOT=${join(workDir, "uploads")}`,
      `EXTENSIONS_PATH=${join(ROOT, "packages")}`,
      "EXTENSIONS_AUTO_RELOAD=false",
      "TELEMETRY=false",
      "RATE_LIMITER_ENABLED=false",
      "ACCESS_TOKEN_TTL=2h",
      "LOG_LEVEL=warn"
    ].join("\n")
  );
  // Directus resolves package extensions from the working directory's package.json.
  writeFileSync(join(workDir, "package.json"), JSON.stringify({ name: "directus-ext-it", private: true }));

  const env = {
    ...process.env,
    CONFIG_PATH: envFile,
    DX_CAPTURE_URL: `${captureUrl}/capture`,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${join(ROOT, "tests/integration/support/capture-preload.mjs")}`.trim()
  };

  const bootstrap = spawnSync(process.execPath, [CLI, "bootstrap"], { cwd: workDir, env, encoding: "utf8" });
  if (bootstrap.status !== 0) throw new Error(`directus bootstrap failed:\n${bootstrap.stdout}\n${bootstrap.stderr}`);

  let log = "";
  directus = spawn(process.execPath, [CLI, "start"], { cwd: workDir, env });
  directus.stdout.on("data", (chunk) => (log += chunk));
  directus.stderr.on("data", (chunk) => (log += chunk));

  try {
    await waitFor(
      async () => {
        if (directus.exitCode !== null) throw new Error(`Directus exited early:\n${log}`);
        const response = await fetch(`${baseUrl}/server/ping`).catch(() => null);
        return response?.ok;
      },
      { timeout: 60000, message: "Directus to start" }
    );

    const adminToken = await login(baseUrl, ADMIN.email, ADMIN.password);
    const seeded = await seed(baseUrl, adminToken);
    const editorToken = await login(baseUrl, SEED.editorEmail, SEED.editorPassword);

    const stateFile = join(workDir, "state.json");
    writeFileSync(stateFile, JSON.stringify({ baseUrl, captureUrl, adminToken, editorToken, seed: SEED, ...seeded }, null, 2));
    process.env.DX_STATE_FILE = stateFile;
  } catch (error) {
    await globalTeardown();
    throw new Error(`${error.message}\n--- Directus log ---\n${log.slice(-4000)}`);
  }
}

export async function globalTeardown() {
  if (directus && directus.exitCode === null) {
    directus.kill("SIGTERM");
    await new Promise((resolvePromise) => directus.once("exit", resolvePromise));
  }
  await new Promise((resolvePromise) => (captureServer ? captureServer.close(resolvePromise) : resolvePromise()));
  if (workDir && !process.env.DX_KEEP_TMP) rmSync(workDir, { recursive: true, force: true });
}
