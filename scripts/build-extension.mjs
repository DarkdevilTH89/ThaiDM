#!/usr/bin/env node
/**
 * Validates the cross-browser MV3 extension in `extension/` for Chrome, Edge, Brave, and Firefox.
 * Optionally checks JS syntax and verifies all icons & scripts declared in manifest.json exist.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const extDir = path.join(rootDir, "extension");
const manifestPath = path.join(extDir, "manifest.json");

function fail(msg) {
  console.error(`[build-extension] ERROR: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  fail(`Missing manifest at ${manifestPath}`);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (err) {
  fail(`Invalid JSON in manifest.json: ${err.message}`);
}

if (manifest.manifest_version !== 3) {
  fail(`Expected manifest_version 3, got ${manifest.manifest_version}`);
}

// Verify dual Chromium + Firefox MV3 background declaration
if (manifest.background?.service_worker !== "background.js") {
  fail('manifest.background.service_worker must be "background.js"');
}
if (!Array.isArray(manifest.background?.scripts) || !manifest.background.scripts.includes("background.js")) {
  fail('manifest.background.scripts must include "background.js" for Firefox MV3 compatibility');
}

// Verify Firefox Gecko settings
const gecko = manifest.browser_specific_settings?.gecko;
if (!gecko?.id || !gecko?.strict_min_version || !gecko?.data_collection_permissions?.required) {
  fail("manifest.browser_specific_settings.gecko is incomplete");
}

// Verify required permissions
const requiredPerms = ["downloads", "contextMenus", "activeTab", "storage", "tabs"];
for (const perm of requiredPerms) {
  if (!manifest.permissions?.includes(perm)) {
    fail(`Missing required permission: ${perm}`);
  }
}

if (!manifest.host_permissions?.includes("http://127.0.0.1/*")) {
  fail('Missing host permission: "http://127.0.0.1/*"');
}

// Verify referenced files exist
const filesToCheck = [
  manifest.background.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.content_scripts || []).flatMap((cs) => cs.js || []),
  "popup.js",
].filter(Boolean);

for (const rel of new Set(filesToCheck)) {
  const full = path.join(extDir, rel);
  if (!fs.existsSync(full)) {
    fail(`Referenced file missing: extension/${rel}`);
  }
}

// Syntax-check all JS files with node --check
for (const jsFile of ["background.js", "content.js", "popup.js"]) {
  const full = path.join(extDir, jsFile);
  execFileSync(process.execPath, ["--check", full], { stdio: "inherit" });
}

console.log("[build-extension] OK: extension/manifest.json and all JS/icon assets validated for Chrome, Edge, Brave, and Firefox.");
