# Baseline test migration ledger

This ledger accounts for all 817 cases in the three locked source baselines. It deliberately separates inventory evidence from execution evidence: **a retained test is not a passing test unless a recorded command actually selected and ran it**.

The exhaustive mapping is [`test-migration-manifest.json`](./test-migration-manifest.json). Every case in a source file inherits that entry's classification unless the entry contains explicit, exhaustive `case_dispositions`. CI validates totals, unique source paths and split-case IDs, replacement and guard files, reasons, and service-aware validation evidence with `node scripts/check-test-migration-ledger.mjs`.

Entries classified as migrated unchanged are compared byte-for-byte against the sanitized source tags. One web file uses an explicit additive-case exception: its five baseline cases remain a byte-identical prefix and two new migration tests are appended after them. The validator checks that prefix and does not count the appended cases toward the 817 baseline.

## What “817” means

| Source | Baseline | Runtime-collected | Static inventory | Evidence |
|---|---:|---:|---:|---|
| Web | 190 | 190 | 0 | Vitest 4.1.10 collected and passed 190 cases from a secret-free `git archive` of `d3f484ca` using a minimal audit config (23 files). |
| API | 497 | 439 | 58 | Pytest 8.4.2 on Python 3.9.6 collected 439 cases from a secret-free `git archive` of `1f0e8d0e`. Eight files could not import without the ignored `config/config.yaml`; their 58 non-parametrized `test_*` functions were counted statically. |
| Morpheus | 130 | 43 | 87 | Pytest 8.4.2 on Python 3.9.6 collected 43 cases from a secret-free `git archive` of `2ec92c73`. Four files could not import without the ignored `config/config.yaml`; their 87 non-parametrized `test_*` functions were counted statically. |
| **Total** | **817** | **672** | **145** | The total is a complete file/function inventory, but only 672 cases have exact runtime collection evidence. |

The manual `dreamify-morpheus/test.py` harness is preserved at `services/morpheus-sandbox/test.py`, but it defines no pytest case and was never part of the stated 130.

No `.env` or ignored YAML credential file was read to obtain these numbers. This is why the API and Morpheus totals are explicitly labeled as hybrid runtime/static evidence instead of a full successful baseline collection.

## Classification

| Classification | Cases | Meaning |
|---|---:|---|
| Migrated unchanged | 157 | Byte-identical web baseline cases, including one validated byte-identical prefix with migration-only tests appended. |
| Equivalent/replaced | 250 | 33 web cases, 87 API cases, and all 130 Morpheus cases map to explicit CI-selected replacement tests. |
| Intentionally excluded | 410 | 270 uncertified connector/chat-platform cases, 102 legacy schedule cases, 10 billing/credit cases, 24 retired Python chart-renderer cases, three automatic project-renaming cases, and one implicit project-wide asset-forwarding case. |
| **Total** | **817** | Every baseline case is represented once in the manifest. |

Per source service, the disposition is:

| Source | Migrated unchanged | Equivalent/replaced | Intentionally excluded | Total |
|---|---:|---:|---:|---:|
| Web | 157 | 33 | 0 | 190 |
| API | 0 | 87 | 410 | 497 |
| Morpheus | 0 | 130 | 0 | 130 |
| **Total** | **157** | **250** | **410** | **817** |

The API total includes 78 replacement cases and 28 exclusions from the formerly unresolved 106-case set, plus nine operator-brief replacements. The 13-case `test_theme_focus_flow.py` entry is split explicitly: 12 presentation/clarification cases map to the durable chat tests, while `test_text_only_chat_defaults_to_no_asset_selection_and_forwards_project_assets` is excluded because hobby_demo requires explicit asset attachment. The 34 warehouse cases remain part of the connector exclusion count; their secret-bearing source file was removed from sanitized history.

## Current acceptance state

This ledger closes the **817-case inventory and disposition** requirement; it does not by itself close hosted acceptance.

- The final web suite passed **298** tests across 40 files, including stream reconnect, capability-gated connector redirects, local-versus-hosted upload transport, and empty pre-dispatch event handling.
- The deployable API replacement suite passed **141** tests with zero failures.
- The TypeScript Workflow replacement suite passed **55** tests with zero failures.
- The bounded Sandbox runner passed **32** tests with zero failures.
- Every replacement disposition names the exact test files that protect it. Test-suite pass counts are evidence that those targets ran; they are not arithmetically compared with baseline case counts because one replacement scenario can cover several legacy assertions and one legacy behavior can cross API, Workflow, and Sandbox boundaries.
- Scheduling, billing/credits, uncertified connectors, the Python renderer, automatic LLM project naming, and implicit project-wide asset forwarding have specific fail-closed guard targets rather than placeholder retained tests.

### Latest local evidence — 2026-08-03

| Check | Result |
|---|---|
| Web Vitest | 40 files, **298 passed**, 0 failed. |
| API platform pytest | **141 passed**, 0 failed. |
| Workflow Vitest | **55 passed**, 0 failed. |
| Sandbox runner pytest | **32 passed**, 0 failed. |
| npm audit | 0 known vulnerabilities at all severities. |
| Python direct pinned-package audit | 0 known vulnerabilities for API constraints and Sandbox dev requirements; full transitive resolution remains a CI check. |
| Ledger validator | Passed: 817 cases across 66 source files; **157 unchanged / 250 replaced / 410 excluded**. |

The local suite gate is complete. Web, Workflow/Sandbox, API, Governance, and
Security also pass in GitHub Actions on the pushed code. Hosted acceptance
remains separate from both mapping and CI success.

## Reproduce the inventory safely

Use disposable `git archive` directories so ignored `.env` and YAML credential files cannot be present:

```bash
# Web: run Vitest against the archived frontend and record JSON output.
# API: APP_ENV=test python -m pytest --collect-only -q tests.
# Morpheus: APP_ENV=test python -m pytest --collect-only -q 'test_*.py'.
```

When source collection stops on missing `config/config.yaml`, keep the failure as evidence and statically count only non-parametrized `test_*` functions in those failed files. Do not restore or inspect the ignored configuration to make collection pass.

## CI gate coverage

| Required gate | Workflow | Status |
|---|---|---|
| Web lint, strict typecheck, Vitest, Next production build | `web.yml` | GitHub Actions passed: 298 tests and production build. |
| API import/lint, format, platform pytest, OpenAPI drift, route uniqueness/access policy, migration + idempotent seed | `api.yml` | GitHub Actions passed; local deployable replacement suite is 141/141. |
| Workflow typecheck/tests, contract drift, bounded Sandbox runner tests | `sandbox.yml` | GitHub Actions passed; Workflow is 55/55 and the local runner is 32/32. Hosted Vercel Sandbox smoke remains an external acceptance gate. |
| Full-history secret scan | `security.yml` | GitHub Actions passed with full-depth Gitleaks checkout. |
| JavaScript and Python dependency audit | `security.yml` | GitHub Actions passed for npm and both Python requirement graphs. |
| Baseline ledger integrity | `governance.yml` | GitHub Actions passed. |

There are no `retained_not_executed` dispositions left. The original evidence limitation remains: 58 API and 87 Morpheus cases were statically inventoried because immutable source archives require ignored YAML configuration. The replacement mapping does not retroactively turn that original static inventory into runtime collection. Remaining acceptance gaps include hosted Clerk/Neon/Blob/Workflow/Sandbox smoke tests, hosted visual parity, and hosted browser deep-link/auth flows.
