import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = mkdtempSync(join(tmpdir(), "pi-chain-skills-prompts-pack-"));

try {
  const packOutput = execFileSync(
    npmCommand,
    ["pack", "--ignore-scripts", "--json", "--pack-destination", tempRoot],
    {
      cwd: packageRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  const packResult = JSON.parse(packOutput);
  assert.equal(packResult.length, 1, "npm pack should produce exactly one tarball");

  const packedFiles = packResult[0].files.map((file) => file.path);
  for (const required of [
    "index.ts",
    "logic.ts",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES",
    "package.json",
  ]) {
    assert.ok(packedFiles.includes(required), `packed file missing: ${required}`);
  }
  for (const forbidden of ["index.test.ts", "logic.test.ts", "scripts/smoke-packed.mjs"]) {
    assert.equal(packedFiles.includes(forbidden), false, `development file was packed: ${forbidden}`);
  }
  assert.equal(
    packedFiles.some((file) => file.includes("pi-skill-chain")),
    false,
    "legacy pi-skill-chain files must not be packed",
  );

  const extractRoot = join(tempRoot, "extract");
  mkdirSync(extractRoot, { recursive: true });
  execFileSync("tar", ["-xzf", packResult[0].filename, "-C", "extract"], {
    cwd: tempRoot,
    stdio: "pipe",
  });

  const packedRoot = join(extractRoot, "package");
  const manifest = JSON.parse(readFileSync(join(packedRoot, "package.json"), "utf8"));
  assert.deepEqual(
    manifest.pi?.extensions,
    ["./index.ts"],
    "package must expose exactly the new combine entry",
  );

  const globalRoot = execFileSync(npmCommand, ["root", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  }).trim();
  const packageNodeModules = join(packageRoot, "node_modules");
  const executableNodeModules = join(dirname(process.execPath), "node_modules");
  const piPackageDir = [packageNodeModules, executableNodeModules, globalRoot]
    .map((root) => join(root, "@earendil-works", "pi-coding-agent"))
    .find(existsSync);
  assert.ok(piPackageDir, "@earendil-works/pi-coding-agent is required for the smoke test");

  // The smoke harness uses Pi's loader only for verification; it is excluded from the tarball.
  const loaderPath = join(piPackageDir, "dist", "core", "extensions", "loader.js");
  const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
  const loaded = await loadExtensions([join(packedRoot, "index.ts")], packedRoot);

  assert.deepEqual(loaded.errors, [], "Pi loader reported extension errors");
  assert.equal(loaded.extensions.length, 1, "Pi must load exactly one packed extension");

  const packedExtension = loaded.extensions[0];
  assert.equal(
    packedExtension.handlers.get("input")?.length ?? 0,
    1,
    "packed extension must register exactly one input transform handler",
  );
  assert.equal(
    packedExtension.handlers.get("session_start")?.length ?? 0,
    1,
    "packed extension must register exactly one autocomplete setup handler",
  );

  let autocompleteRegistrations = 0;
  const sessionStart = packedExtension.handlers.get("session_start")?.[0];
  assert.ok(sessionStart, "session_start handler is required");
  await sessionStart(
    { reason: "startup" },
    {
      ui: {
        addAutocompleteProvider() {
          autocompleteRegistrations += 1;
        },
      },
    },
  );
  assert.equal(
    autocompleteRegistrations,
    1,
    "packed extension must register exactly one autocomplete provider",
  );

  console.log("Packed pi-chain-skills-prompts loaded once through Pi with one transform and autocomplete path.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
