"use strict";

const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const htmlFiles = readdirSync(root).filter(name => name.endsWith(".html"));

for (const filename of htmlFiles) {
  const html = readFileSync(join(root, filename), "utf8");
  const counts = new Map();
  for (const match of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  const duplicates = Array.from(counts).filter(([, count]) => count > 1);
  if (duplicates.length) {
    process.stderr.write(`${filename} contains duplicate IDs: ${duplicates.map(([id, count]) => `${id} (${count})`).join(", ")}\n`);
    process.exit(1);
  }
}

process.stdout.write(`Checked ${htmlFiles.length} HTML files for duplicate IDs.\n`);
