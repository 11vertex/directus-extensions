// Publishes every package in packages/ whose current version is not on npm yet.
//
//   node scripts/publish.mjs            # from your machine (after `npm login`; npm asks for your 2FA code)
//   node scripts/publish.mjs --ci       # from GitHub Actions with npm trusted publishing (adds provenance)
//   node scripts/publish.mjs --dry-run  # show what would be published
//
// In --ci mode it also creates a `<name>@<version>` git tag for every published version that has
// none yet, so versions first published from a machine get their tag on the public repo too.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ci = process.argv.includes("--ci");
const dryRun = process.argv.includes("--dry-run");

function isPublished(name, version) {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() === version;
}

const packages = readdirSync("packages", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join("packages", entry.name))
  .map((dir) => ({ dir, ...JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) }))
  .filter((pkg) => !pkg.private);

const pending = packages.filter((pkg) => !isPublished(pkg.name, pkg.version));
if (pending.length === 0) console.log("Every package version is already on npm.");

for (const pkg of pending) {
  const id = `${pkg.name}@${pkg.version}`;
  if (dryRun) {
    console.log(`would publish ${id}`);
    continue;
  }
  console.log(`publishing ${id}`);
  const args = ["publish", "--access", "public", ...(ci ? ["--provenance"] : [])];
  execFileSync("npm", args, { cwd: pkg.dir, stdio: "inherit" });
}

if (ci && !dryRun) {
  const existing = new Set(execFileSync("git", ["tag", "--list"], { encoding: "utf8" }).split("\n"));
  for (const pkg of packages) {
    const tag = `${pkg.name}@${pkg.version}`;
    if (!existing.has(tag) && isPublished(pkg.name, pkg.version)) {
      execFileSync("git", ["tag", tag], { stdio: "inherit" });
      console.log(`tagged ${tag}`);
    }
  }
}
