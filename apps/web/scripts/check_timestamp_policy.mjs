#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC_DIR = path.join(ROOT, "src");

const EXCLUDED_SUFFIXES = [
  path.join("src", "utils", "timestamp.ts"),
  path.join("src", "utils", "timestamp.test.ts"),
];

const FORBIDDEN_PATTERNS = [
  {
    regex: /\bnew Date\(\)\.toISOString\(\)/g,
    description: "Use getNow()/toUTCISOString() from src/utils/timestamp.ts",
  },
  {
    regex: /\btoLocaleDateString\(/g,
    description: "Use formatToDisplay() from src/utils/timestamp.ts",
  },
  {
    regex: /\btoLocaleTimeString\(/g,
    description: "Use formatToDisplay() from src/utils/timestamp.ts",
  },
  {
    regex: /\b(?:timestamp|created_at|updated_at|createdAt|updatedAt|lastUpdated)\s*:\s*Date\.now\(\)/g,
    description: "Do not store epoch for timestamp fields; use UTC ISO string helpers",
  },
];

function shouldSkip(filePath) {
  const normalized = filePath.split(path.sep).join(path.posix.sep);
  return EXCLUDED_SUFFIXES.some((suffix) => normalized.endsWith(suffix.split(path.sep).join(path.posix.sep)));
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

const violations = [];
for (const filePath of walk(SRC_DIR)) {
  if (shouldSkip(filePath)) continue;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rule of FORBIDDEN_PATTERNS) {
    for (const match of content.matchAll(rule.regex)) {
      violations.push({
        filePath,
        line: lineNumber(content, match.index ?? 0),
        description: rule.description,
        token: match[0],
      });
    }
  }
}

if (violations.length > 0) {
  console.error("Frontend timestamp policy violations found:");
  for (const violation of violations) {
    const rel = path.relative(ROOT, violation.filePath);
    console.error(`  - ${rel}:${violation.line} (${violation.token}) ${violation.description}`);
  }
  process.exit(1);
}

console.log("Frontend timestamp policy check passed.");
