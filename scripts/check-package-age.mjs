#!/usr/bin/env node
/**
 * Supply-chain quarantine for npm.
 *
 * Blocks installs that would pull a dependency whose resolved version was
 * published less than MIN_RELEASE_AGE_DAYS days ago. This enforces the
 * quarantine that `min-release-age` in .npmrc declares (pnpm respects that
 * key; npm doesn't — hence this script).
 *
 * Runs as a `preinstall` script and walks the current lockfile if present.
 * If there is no lockfile (first install), the script exits 0 — the check
 * fires on the *next* install once the lockfile exists.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DAYS = Number(process.env.MIN_RELEASE_AGE_DAYS ?? 7);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const fetchPackument = async (name) => {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    return null;
  }
  return response.json();
};

const readLockfile = async () => {
  const path = resolve(process.cwd(), "package-lock.json");
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const main = async () => {
  if (process.env.SKIP_SUPPLY_CHAIN_CHECK === "1") {
    return;
  }
  const lock = await readLockfile();
  if (!lock || !lock.packages) {
    return;
  }

  const cutoff = Date.now() - DAYS * MS_PER_DAY;
  const toCheck = new Map();
  for (const [key, value] of Object.entries(lock.packages)) {
    if (!key || key === "" || !value?.version || value.link) {
      continue;
    }
    // Strip node_modules/ prefix to get the package name.
    const idx = key.lastIndexOf("node_modules/");
    const name = idx >= 0 ? key.slice(idx + "node_modules/".length) : key;
    if (!name) {
      continue;
    }
    if (!toCheck.has(name) || toCheck.get(name) !== value.version) {
      toCheck.set(name, value.version);
    }
  }

  const violations = [];
  // Sequential to avoid hammering the registry — this is a preinstall, not
  // a hot path. Limit to 200 checks to keep first install bounded.
  let checked = 0;
  for (const [name, version] of toCheck) {
    if (checked >= 200) {
      break;
    }
    checked += 1;
    try {
      const packument = await fetchPackument(name);
      const publishedAt = packument?.time?.[version];
      if (!publishedAt) {
        continue;
      }
      const publishedMs = Date.parse(publishedAt);
      if (!Number.isFinite(publishedMs)) {
        continue;
      }
      if (publishedMs > cutoff) {
        const ageDays = ((Date.now() - publishedMs) / MS_PER_DAY).toFixed(1);
        violations.push(`${name}@${version} (${ageDays} days old; quarantine=${DAYS})`);
      }
    } catch {
      // Network hiccup on a supply-chain check should not crash install.
    }
  }

  if (violations.length > 0) {
    console.error("");
    console.error(`❌ auto-claw supply-chain quarantine: ${violations.length} package(s) younger than ${DAYS} days`);
    for (const v of violations) {
      console.error(`   - ${v}`);
    }
    console.error("Override with SKIP_SUPPLY_CHAIN_CHECK=1 (only if you understand the risk).");
    console.error("");
    process.exit(1);
  }
};

main().catch((error) => {
  console.warn(`supply-chain check skipped: ${String(error)}`);
});
