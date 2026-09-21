"use strict";

const { spawnSync } = require("node:child_process");
const { readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const root = join(__dirname, "..");
const roots = ["js", "templates", "tests"];
const files = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(?:js|cjs|mjs)$/.test(name)) files.push(path);
  }
}

for (const directory of roots) walk(join(root, directory));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(`Syntax check failed: ${relative(root, file)}\n${result.stderr}`);
    process.exit(result.status || 1);
  }
}

process.stdout.write(`Syntax checked ${files.length} JavaScript files.\n`);
