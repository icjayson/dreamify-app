import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(repositoryRoot, "docs/test-migration-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const expectedTotal = 817;
const allowedServices = new Set(["web", "api", "morpheus"]);
const allowedSuiteServices = new Set(["web", "api", "workflow", "sandbox"]);
const allowedClassifications = new Set([
  "migrated_unchanged",
  "equivalent_replaced",
  "intentionally_excluded",
]);
const allowedEvidence = new Set(Object.keys(manifest.evidence_modes ?? {}));
const allowedVerification = new Set(Object.keys(manifest.verification_states ?? {}));
const sourcePaths = new Set();
const referencedSuites = [];
const serviceTotals = { web: 0, api: 0, morpheus: 0 };
const classificationTotals = {
  migrated_unchanged: 0,
  equivalent_replaced: 0,
  intentionally_excluded: 0,
};
const serviceClassificationTotals = Object.fromEntries(
  [...allowedServices].map((service) => [
    service,
    {
      migrated_unchanged: 0,
      equivalent_replaced: 0,
      intentionally_excluded: 0,
    },
  ]),
);
const errors = [];
const warnings = [];
const sourceRefs = {
  web: {
    ref: "source/frontend/dev-2026-08-03",
    path: (source) => source.replace("dreamify-frontend/frontend/", "apps/web/frontend/"),
  },
  api: {
    ref: "source/api/dev-2026-08-03",
    path: (source) => source.replace("dreamify-backend/", "services/api/"),
  },
  morpheus: {
    ref: "source/morpheus/dev-2026-08-03",
    path: (source) => source.replace("dreamify-morpheus/", "services/morpheus-sandbox/"),
  },
};

function requireFile(relativePath, context) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    errors.push(`${context}: target path must be a non-empty string`);
    return;
  }
  const absolutePath = resolve(repositoryRoot, relativePath);
  try {
    if (!statSync(absolutePath).isFile()) {
      errors.push(`${context}: not a file: ${relativePath}`);
    }
  } catch {
    errors.push(`${context}: missing file: ${relativePath}`);
  }
}

function validatePathList(paths, field, context) {
  if (!Array.isArray(paths) || paths.length === 0) {
    errors.push(`${context}: ${field} must contain at least one file`);
    return;
  }
  const uniquePaths = new Set();
  for (const path of paths) {
    if (uniquePaths.has(path)) errors.push(`${context}: duplicate ${field} path: ${path}`);
    uniquePaths.add(path);
    requireFile(path, context);
  }
}

function validateReason(reason, context) {
  if (typeof reason !== "string" || reason.length < 20) {
    errors.push(`${context}: needs a specific reason of at least 20 characters`);
  }
}

function dispositionsFor(entry, context) {
  if (!Array.isArray(entry.case_dispositions)) return [entry];
  if (entry.case_dispositions.length < 2) {
    errors.push(`${context}: case_dispositions must contain at least two dispositions`);
  }
  for (const ambiguousField of [
    "classification",
    "verification",
    "target",
    "replacement_targets",
    "guard_targets",
    "validation_suites",
    "reason",
  ]) {
    if (entry[ambiguousField] !== undefined) {
      errors.push(`${context}: split entry must define ${ambiguousField} only inside dispositions`);
    }
  }

  let dispositionCases = 0;
  const caseIds = new Set();
  for (const [index, disposition] of entry.case_dispositions.entries()) {
    const dispositionContext = `${context}, disposition ${index + 1}`;
    if (typeof disposition.label !== "string" || disposition.label.length < 5) {
      errors.push(`${dispositionContext}: label must identify the behavior group`);
    }
    if (!Number.isInteger(disposition.cases) || disposition.cases <= 0) {
      errors.push(`${dispositionContext}: cases must be a positive integer`);
      continue;
    }
    dispositionCases += disposition.cases;
    if (!Array.isArray(disposition.case_ids) || disposition.case_ids.length !== disposition.cases) {
      errors.push(`${dispositionContext}: case_ids must enumerate exactly ${disposition.cases} cases`);
      continue;
    }
    for (const caseId of disposition.case_ids) {
      if (typeof caseId !== "string" || caseId.length === 0) {
        errors.push(`${dispositionContext}: case_ids must be non-empty strings`);
      } else if (caseIds.has(caseId)) {
        errors.push(`${dispositionContext}: duplicate case id ${caseId}`);
      }
      caseIds.add(caseId);
    }
  }
  if (dispositionCases !== entry.cases) {
    errors.push(
      `${context}: case_dispositions total ${dispositionCases} does not equal entry cases ${entry.cases}`,
    );
  }
  return entry.case_dispositions;
}

function validateValidationSuites(suiteIds, service, context) {
  if (!Array.isArray(suiteIds) || suiteIds.length === 0) {
    errors.push(`${context}: locally-passed behavior needs at least one validation_suites entry`);
    return;
  }
  const uniqueIds = new Set();
  for (const suiteId of suiteIds) {
    if (typeof suiteId !== "string" || suiteId.length === 0) {
      errors.push(`${context}: validation suite identifiers must be non-empty strings`);
      continue;
    }
    if (uniqueIds.has(suiteId)) errors.push(`${context}: duplicate validation suite ${suiteId}`);
    uniqueIds.add(suiteId);
    referencedSuites.push({ suiteId, sourceService: service, context });
  }
}

function compareUnchangedTarget(entry, disposition, context) {
  if (Array.isArray(entry.case_dispositions)) {
    errors.push(`${context}: migrated_unchanged cannot be used for only part of a source file`);
    return;
  }
  const sourceRef = sourceRefs[entry.service];
  try {
    const baseline = execFileSync(
      "git",
      ["show", `${sourceRef.ref}:${sourceRef.path(entry.source)}`],
      { cwd: repositoryRoot, maxBuffer: 10 * 1024 * 1024 },
    );
    const target = readFileSync(resolve(repositoryRoot, disposition.target));
    if (!baseline.equals(target)) {
      const hasValidatedAdditions =
        disposition.allow_additive_cases === true &&
        target.length > baseline.length &&
        target.subarray(0, baseline.length).equals(baseline);
      if (!hasValidatedAdditions) {
        errors.push(`${context}: target is not byte-for-byte identical to the sanitized source tag`);
      } else {
        validateReason(disposition.addition_reason, `${context}, additive cases`);
      }
    } else if (disposition.allow_additive_cases) {
      errors.push(`${context}: allow_additive_cases is set but the target has no additions`);
    }
  } catch (error) {
    errors.push(`${context}: could not read sanitized source tag (${error.message})`);
  }
}

function validateDisposition(entry, disposition, context) {
  if (!Number.isInteger(disposition.cases) || disposition.cases <= 0) {
    errors.push(`${context}: cases must be a positive integer`);
    return;
  }
  if (!allowedClassifications.has(disposition.classification)) {
    errors.push(`${context}: unknown classification ${disposition.classification}`);
    return;
  }
  if (!allowedVerification.has(disposition.verification)) {
    errors.push(`${context}: unknown verification ${disposition.verification}`);
  }

  classificationTotals[disposition.classification] += disposition.cases;
  serviceClassificationTotals[entry.service][disposition.classification] += disposition.cases;

  if (disposition.classification === "migrated_unchanged") {
    if (disposition.verification !== "target_locally_passed") {
      errors.push(`${context}: unchanged target must have target_locally_passed verification`);
    }
    if (!disposition.target) errors.push(`${context}: unchanged entry needs a target`);
    else {
      requireFile(disposition.target, context);
      compareUnchangedTarget(entry, disposition, context);
    }
    if (disposition.replacement_targets || disposition.guard_targets) {
      errors.push(`${context}: unchanged entry cannot declare replacement or guard targets`);
    }
    validateValidationSuites(disposition.validation_suites ?? [entry.service], entry.service, context);
    return;
  }

  if (disposition.classification === "equivalent_replaced") {
    if (disposition.verification !== "target_locally_passed") {
      errors.push(`${context}: equivalent replacement must have target_locally_passed verification`);
    }
    if (disposition.target) {
      errors.push(`${context}: equivalent replacement must use replacement_targets, not target`);
    }
    validateReason(disposition.reason, context);
    validatePathList(disposition.replacement_targets, "replacement_targets", context);
    validateValidationSuites(disposition.validation_suites, entry.service, context);
    if (disposition.guard_targets) {
      errors.push(`${context}: equivalent replacement cannot declare guard_targets`);
    }
    return;
  }

  if (disposition.verification !== "exclusion_guard_ci_configured") {
    errors.push(`${context}: excluded behavior must have exclusion_guard_ci_configured verification`);
  }
  validateReason(disposition.reason, context);
  validatePathList(disposition.guard_targets, "guard_targets", context);
  if (disposition.target || disposition.replacement_targets) {
    errors.push(`${context}: excluded behavior cannot declare retained or replacement targets`);
  }
}

if (manifest.schema_version !== 2) {
  errors.push(`schema_version must be 2, got ${manifest.schema_version}`);
}

for (const [index, entry] of manifest.entries.entries()) {
  const context = `entry ${index + 1} (${entry.source ?? "missing source"})`;
  if (!allowedServices.has(entry.service)) {
    errors.push(`${context}: unknown service ${entry.service}`);
    continue;
  }
  if (!Number.isInteger(entry.cases) || entry.cases <= 0) {
    errors.push(`${context}: cases must be a positive integer`);
  }
  if (!allowedEvidence.has(entry.evidence)) {
    errors.push(`${context}: unknown evidence ${entry.evidence}`);
  }
  if (typeof entry.source !== "string" || entry.source.length === 0) {
    errors.push(`${context}: source must be a non-empty string`);
  } else if (sourcePaths.has(entry.source)) {
    errors.push(`${context}: duplicate source path`);
  }
  sourcePaths.add(entry.source);
  serviceTotals[entry.service] += entry.cases;

  const dispositions = dispositionsFor(entry, context);
  for (const [dispositionIndex, disposition] of dispositions.entries()) {
    const dispositionContext = Array.isArray(entry.case_dispositions)
      ? `${context}, disposition ${dispositionIndex + 1}`
      : context;
    validateDisposition(entry, disposition, dispositionContext);
  }
}

const total = Object.values(serviceTotals).reduce((sum, value) => sum + value, 0);
if (manifest.baseline.total_cases !== expectedTotal || total !== expectedTotal) {
  errors.push(
    `baseline total mismatch: declared=${manifest.baseline.total_cases}, computed=${total}, expected=${expectedTotal}`,
  );
}

for (const [service, totalCases] of Object.entries(serviceTotals)) {
  const declared = manifest.baseline.sources[service]?.cases;
  if (totalCases !== declared) {
    errors.push(`${service} total mismatch: declared=${declared}, computed=${totalCases}`);
  }
}

for (const [classification, totalCases] of Object.entries(classificationTotals)) {
  const declared = manifest.classification_totals[classification];
  if (totalCases !== declared) {
    errors.push(
      `${classification} total mismatch: declared=${declared}, computed=${totalCases}`,
    );
  }
}

const latest = manifest.latest_local_validation;
if (!latest || Number.isNaN(Date.parse(latest.observed_at))) {
  errors.push("latest_local_validation must include a valid observed_at timestamp");
}
const suites = latest?.suites;
if (!suites || typeof suites !== "object" || Array.isArray(suites)) {
  errors.push("latest_local_validation.suites must be an object");
} else {
  for (const [suiteId, suite] of Object.entries(suites)) {
    const context = `validation suite ${suiteId}`;
    if (!allowedSuiteServices.has(suite.service)) {
      errors.push(`${context}: unknown service ${suite.service}`);
    }
    if (typeof suite.command !== "string" || suite.command.length < 10) {
      errors.push(`${context}: command must record the executed or pending command`);
    }
    if (
      !Array.isArray(suite.covers_source_services) ||
      suite.covers_source_services.length === 0 ||
      suite.covers_source_services.some((service) => !allowedServices.has(service))
    ) {
      errors.push(`${context}: covers_source_services must name one or more source services`);
    }
    if (suite.status === "passed") {
      if (Number.isNaN(Date.parse(suite.observed_at))) {
        errors.push(`${context}: passed suite needs a valid observed_at timestamp`);
      }
      if (!Number.isInteger(suite.passed) || suite.passed < 0 || suite.failed !== 0) {
        errors.push(`${context}: passed suite must record an integer pass count and zero failures`);
      }
    } else if (suite.status === "pending_final_rerun") {
      validateReason(suite.reason, context);
      const previous = suite.last_passing_run;
      if (
        !previous ||
        Number.isNaN(Date.parse(previous.observed_at)) ||
        !Number.isInteger(previous.passed) ||
        previous.passed < 0 ||
        previous.failed !== 0
      ) {
        errors.push(`${context}: pending suite needs a valid zero-failure last_passing_run`);
      } else {
        warnings.push(
          `${context}: final rerun is pending; last full evidence is ${previous.passed} passed at ${previous.observed_at}`,
        );
      }
    } else {
      errors.push(`${context}: unknown status ${suite.status}`);
    }
  }
}

for (const { suiteId, sourceService, context } of referencedSuites) {
  const suite = suites?.[suiteId];
  if (!suite) {
    errors.push(`${context}: references unknown validation suite ${suiteId}`);
  } else if (!suite.covers_source_services.includes(sourceService)) {
    errors.push(
      `${context}: validation suite ${suiteId} does not cover source service ${sourceService}`,
    );
  }
}

if (latest?.npm_audit?.vulnerabilities !== 0) {
  errors.push("latest npm audit must record zero known vulnerabilities");
}
if (latest?.python_direct_dependency_audit?.vulnerabilities !== 0) {
  errors.push("latest direct Python dependency audit must record zero known vulnerabilities");
}

if (errors.length > 0) {
  console.error("Test migration ledger is invalid:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  `Test migration ledger valid: ${total} baseline cases across ${manifest.entries.length} files ` +
    `(web=${serviceTotals.web}, api=${serviceTotals.api}, morpheus=${serviceTotals.morpheus}).`,
);
console.log(
  `Classifications: migrated unchanged=${classificationTotals.migrated_unchanged}, ` +
    `equivalent/replaced=${classificationTotals.equivalent_replaced}, ` +
    `intentionally excluded=${classificationTotals.intentionally_excluded}.`,
);
for (const service of allowedServices) {
  const totals = serviceClassificationTotals[service];
  console.log(
    `${service}: unchanged=${totals.migrated_unchanged}, replaced=${totals.equivalent_replaced}, ` +
      `excluded=${totals.intentionally_excluded}.`,
  );
}
for (const warning of warnings) console.warn(`Warning: ${warning}`);
