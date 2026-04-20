import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

describe("Task 0 scaffold", () => {
  it("defines the standalone package scripts and metadata", async () => {
    const packageJsonPath = resolve(repoRoot, "package.json");
    const packageJsonRaw = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonRaw) as {
      name?: string;
      scripts?: Record<string, string>;
    };

    expect(packageJson.name).toBe("@inceptionstack/auto-claw-plugin");
    expect(packageJson.scripts).toMatchObject({
      build: "rm -rf dist && tsc -p tsconfig.build.json",
      test: "vitest run",
      "test:watch": "vitest",
      typecheck: "tsc --noEmit -p tsconfig.json",
      lint: "tsc --noEmit -p tsconfig.json",
    });
  });

  it("ships the plugin manifest and shared type definitions", async () => {
    const manifestPath = resolve(repoRoot, "openclaw.plugin.json");
    const typesPath = resolve(repoRoot, "src/types.ts");

    const [manifestRaw, typesRaw] = await Promise.all([
      readFile(manifestPath, "utf8"),
      readFile(typesPath, "utf8"),
    ]);

    const manifest = JSON.parse(manifestRaw) as { id?: string; entry?: string };

    expect(manifest).toMatchObject({
      id: "auto-claw",
      entry: "./dist/plugin-entry.js",
    });
    expect(typesRaw).toContain("export type RollupKey = string;");
    expect(typesRaw).toContain("export type LoopOutcome = {");
  });
});
