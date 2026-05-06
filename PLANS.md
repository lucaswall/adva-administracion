# Implementation Plan

**Created:** 2026-05-06
**Status:** COMPLETE
**Source:** Inline request: Fix all findings in REVIEW.md (production audit before Q1 closing) + sync Node 24 enforcement with adva-facturador (Railway pinning, .nvmrc) + update all dependencies to latest.
**Linear Issues:** [ADV-181](https://linear.app/lw-claude/issue/ADV-181), [ADV-182](https://linear.app/lw-claude/issue/ADV-182), [ADV-183](https://linear.app/lw-claude/issue/ADV-183), [ADV-184](https://linear.app/lw-claude/issue/ADV-184), [ADV-185](https://linear.app/lw-claude/issue/ADV-185), [ADV-186](https://linear.app/lw-claude/issue/ADV-186), [ADV-187](https://linear.app/lw-claude/issue/ADV-187), [ADV-188](https://linear.app/lw-claude/issue/ADV-188)
**Branch:** fix/q1-cleanup

## Context Gathered

### Codebase Analysis

- **REVIEW.md findings target these files:**
  - `src/utils/exchange-rate.ts:346` — log spam root cause (warn fires per factura×pago combo when negative API responses aren't cached).
  - `src/processing/storage/resumen-store.ts` — `storeResumen*` returns `{stored: false}` on duplicate detection without making it visible enough; scanner records `success` instead of `duplicate`.
  - `src/processing/matching/recibo-pago-matcher.ts:105` — cascade infers `hasCuitMatch` from confidence='HIGH' instead of reading the recibo's actual flag.
  - `src/gemini/prompts.ts` — Credicoop `resumen_bancario` extraction returns 2-7 day window instead of full month period (suspected proximate cause of missing rows).
- **Existing test files (TDD baselines):**
  - `src/utils/exchange-rate.test.ts` (752 lines)
  - `src/processing/storage/resumen-store.test.ts` (507 lines)
  - `src/processing/matching/recibo-pago-matcher.test.ts` (313 lines)
  - `src/gemini/parser.test.ts` (for resumen extraction validation)
- **Existing patterns to follow:**
  - `Result<T, E>` pattern across `src/utils/*` (exchange-rate already uses it).
  - Memory cache with TTL (`memoryCache: Map<string, CacheEntry>` in exchange-rate.ts) — reuse for negative entries.
  - Pino structured logging with `module`/`phase`/`correlationId` fields.
  - `ScanContext`/`duplicateCache` pattern in `resumen-store.ts` — duplicate-cache thread-through.
- **Node toolchain comparison with adva-facturador:**
  - facturador: `.nvmrc=24`, `.node-version=24`, `engines.node=">=24"`, `nixpacks.toml` explicitly pins `nodejs_24` with `nixpkgsArchive` (because Nixpacks default is nodejs_18 and the bundled archive doesn't carry nodejs_24).
  - adva: `.node-version=24` only (no `.nvmrc`), `engines.node=">=24.0.0"`, `nixpacks.toml` does NOT pin `nodejs_24` → Railway is silently falling back to whatever Nixpacks default Node is.
- **Dependency drift vs facturador:**
  - `@types/node ^25.0.9` in adva (mismatched with Node 24 engine; should be `^24.x`).
  - `vitest ^4.0.17` in adva (facturador is on `^3.2.4` — adva is ahead).
  - `typescript ^5.7.3` in adva (facturador is on `^6.0.3` — adva is behind).
  - `pino ^10.2.0` (facturador has `^10.3.1`).
  - All other deps are slightly behind latest patch/minor.

### MCP Context

- **Linear MCP:** team "ADVA Administracion" verified; states Backlog → Todo → In Progress → Review → Merge → Done.
- **Railway MCP (read-only):** confirmed production (release branch) hits log rate limit on `exchange-rate cache miss` warns — direct evidence the spam is current.
- **Gemini MCP:** will be used during Task 4 to iterate on Credicoop prompt before committing.
- **Drive/Sheets MCP:** not needed during implementation (operational steps live in `/data-ops`).

## Tasks

### Task 1: Negative-cache exchange rate API misses; demote per-attempt cache-miss log

**Linear Issue:** [ADV-181](https://linear.app/lw-claude/issue/ADV-181)

**Files:**
- `src/utils/exchange-rate.ts` (modify)
- `src/utils/exchange-rate.test.ts` (modify)

**Steps:**
1. Write tests in `src/utils/exchange-rate.test.ts`:
   - When `prefetchExchangeRates` is called for a date the API returns no data for (HTTP error or invalid response), a negative cache entry is recorded under the same `cacheKey`.
   - Subsequent calls to `getExchangeRateSync` for that date return `{ ok: false, error: <cache miss>, cacheMiss: true }` WITHOUT triggering another `fetch` call (assert via mocked fetch call count).
   - Negative cache entries expire on a shorter TTL than positive entries (e.g., 1 hour for negatives vs 24 hours for positives).
   - `amountsMatchCrossCurrency` no longer calls `warn(...)` when `getExchangeRateSync` returns a cache miss — only `debug(...)`.
   - `prefetchExchangeRates` itself still emits exactly one `warn` per failed-prefetch date (so failures are visible at warn level, just not amplified by the per-pago attempt loop).
2. Run verifier `"exchange-rate"` (expect fail).
3. Implement:
   - Extend cache entry to optionally store a negative marker.
   - Update `prefetchExchangeRates` to write negative entries when `getExchangeRate` returns `{ ok: false }`.
   - Demote the `warn(...)` at `exchange-rate.ts:346` to `debug(...)`.
4. Run verifier `"exchange-rate"` (expect pass).

**Notes:**
- Cross-cutting: Gemini/HTTP timeouts already handled by existing `EXCHANGE_RATE_TIMEOUT_MS` + AbortController in `getExchangeRate`; do not regress.
- Follow the pattern of `setCachedValue`/`getCachedValue` already present.

### Task 2: Make resumen storage skip-on-duplicate visible (info log + scanner records 'duplicate' status)

**Linear Issue:** [ADV-182](https://linear.app/lw-claude/issue/ADV-182)

**Files:**
- `src/processing/storage/resumen-store.ts` (modify)
- `src/processing/storage/resumen-store.test.ts` (modify)
- `src/processing/scanner.ts` (modify — duplicate-routing for resumen paths)
- `src/processing/storage/index.ts` (verify return-type plumbing)

**Steps:**
1. Write tests:
   - `storeResumenBancario`, `storeResumenTarjeta`, `storeResumenBroker` log at `info` level (not `warn`) when `isDuplicate=true`, including `existingFileId` and the new file's `fileId` for traceability.
   - When any `storeResumen*` returns `{ stored: false, existingFileId }`, the scanner records the file in `Archivos Procesados` with `status='duplicate'` and `originalFileId=<existingFileId>` (NOT `status='success'`). Mirror the existing pattern used elsewhere in scanner.ts for non-resumen duplicates (Row 655 of production tracker is an example of correct routing).
   - When `storeResumen*` returns `{ stored: true }`, scanner records `status='success'` (regression guard).
2. Run verifier `"resumen-store"` (expect fail) and `"scanner"` for the routing test.
3. Implement:
   - Change `warn(...)` → `info(...)` on the three duplicate-detected log calls in `resumen-store.ts`.
   - Trace `storeResumen*` results through scanner.ts at the call sites near lines 1585 (bancario), 1808 (tarjeta), 2019 (broker) — ensure `{ stored: false, existingFileId }` triggers `updateFileStatus(..., 'duplicate', { originalFileId })`, not `'success'`.
4. Run verifier (expect pass).

**Notes:**
- Together with Task 1, this restores observability for silent skips without code-level invariant changes.
- Background context: the proximate cause of the BBVA Visa Mar / Credicoop Feb missing rows is uncertain, but this change ensures any future occurrence is visible in `Archivos Procesados` (status='duplicate' instead of 'success') and in logs (info level, not warn).

### Task 3: Fix recibo-pago cascade hasCuitMatch asymmetry

**Linear Issue:** [ADV-183](https://linear.app/lw-claude/issue/ADV-183)

**Files:**
- `src/processing/matching/recibo-pago-matcher.ts` (modify)
- `src/processing/matching/recibo-pago-matcher.test.ts` (modify)

**Steps:**
1. Write test in `recibo-pago-matcher.test.ts`:
   - When an existing recibo match has `confidence='MANUAL'` (which implies CUIT may or may not be present), the cascade displacement reads `hasCuitMatch` from the recibo's actual flag — not from `existingMatchConfidence === 'HIGH'`.
   - Construct a scenario where a MANUAL-locked recibo with `hasCuitMatch=true` is being evaluated; assert the existing-quality `hasCuitMatch` is `true`, not `false`.
2. Run verifier `"recibo-pago"` (expect fail).
3. Implement: change `recibo-pago-matcher.ts:105` from `hasCuitMatch: bestMatch.existingMatchConfidence === 'HIGH'` to read directly from the recibo (mirroring `factura-pago-matcher.ts:104` pattern: `bestMatch.factura.hasCuitMatch || false`).
4. Run verifier (expect pass).

**Notes:**
- Low-impact correctness fix. Affects displacement decisions involving MANUAL-locked recibos.

### Task 4: Fix Credicoop `resumen_bancario` narrow-date extraction in Gemini prompt

**Linear Issue:** [ADV-184](https://linear.app/lw-claude/issue/ADV-184)

**Files:**
- `src/gemini/prompts.ts` (modify)
- `src/gemini/parser.test.ts` (modify — add fixture-based test)

**Steps:**
1. Read the production Credicoop February 2026 PDF (`gdrive_get_pdf` of `1SSpS0d23EJPKrUX2v_CjDhjiRalxx88L`) and the January / March / April variants for comparison.
2. Use `mcp__gemini__gemini_analyze_pdf` to test current `resumen_bancario` prompt against the Credicoop PDFs and capture the bug: `fechaDesde`/`fechaHasta` come back as a 2-7 day window (footer "Fecha del saldo" range) rather than the full statement period.
3. Iterate on prompt language in `src/gemini/prompts.ts` (resumen_bancario) so it explicitly anchors `fechaDesde`/`fechaHasta` to the statement-period header (e.g., "Del 2026-02-01 Al 2026-02-28") and rejects footer/saldo dates as the period.
4. Write parser test:
   - Given a Credicoop-style fixture (mock JSON output reflecting the new prompt's expected shape), parser returns full-month `fechaDesde`/`fechaHasta`.
   - Add a regression assertion: parser rejects (or flags `needsReview`) any `resumen_bancario` whose `fechaHasta - fechaDesde < 14 days` AND whose period doesn't span at least the majority of a month.
5. Run verifier `"parser"` (expect fail).
6. Update prompt + parser; verify with Gemini MCP across all four Credicoop 2026 statements (Jan / Feb / Mar / Apr) and confirm full-period extraction.
7. Run verifier (expect pass).

**Notes:**
- Cross-cutting: Gemini call timeout already enforced by existing client; reuse, don't override.
- Migration note: existing Credicoop rows in `Control de Resumenes` (Jan / Mar / Apr 2026) carry the buggy narrow dates. The closing report relies on `periodo` (YYYY-MM) which is correct. The narrow `fechaDesde`/`fechaHasta` are mostly cosmetic but could mislead manual review. Re-extracting these is operational cleanup via `/data-ops` after Task 4 lands; not required for code correctness.

### Task 5: Pin Node 24 on Railway via nixpacks.toml + add `.nvmrc`

**Linear Issue:** [ADV-185](https://linear.app/lw-claude/issue/ADV-185)

**Files:**
- `nixpacks.toml` (modify)
- `.nvmrc` (create)
- `package.json` (verify `engines.node` reads `>=24` cleanly)

**Steps:**
1. Create `.nvmrc` at repo root with content `24` (matches existing `.node-version`).
2. Update `nixpacks.toml`: add `[phases.setup]` block with `nixPkgs = ["nodejs_24"]` and a pinned `nixpkgsArchive` matching `adva-facturador/nixpacks.toml` exactly (`ac62194c3917d5f474c1a844b6fd6da2db95077d`). Preserve existing install/build/start phases.
3. Smoke verification:
   - `npm install` locally still succeeds on Node 24.
   - Run verifier (full mode) — all tests pass.
   - After PR merge, confirm Railway staging deploy logs show `node --version` → 24.x. (Operational; not part of TDD pass.)

**Notes:**
- This is a config task — no unit test. The implementer should ensure no other infra files (Dockerfile, CI workflows) need updating to match.
- **Migration note:** Production currently runs whatever Node version Nixpacks picks by default (likely 18). Pinning to 24 is a runtime-version change. Plan: deploy to staging first, verify boot + smoke endpoints, then promote to release. The implementer should NOT push directly to release.

### Task 6: Sync `@types/node` to Node 24 major

**Linear Issue:** [ADV-186](https://linear.app/lw-claude/issue/ADV-186)

**Files:**
- `package.json` (modify)
- `package-lock.json` (regenerate)

**Steps:**
1. Write nothing new; ensure existing test suite passes as baseline.
2. Update `@types/node` from `^25.0.9` to `^24.x` (latest in the 24 line).
3. Run `npm install`.
4. Run verifier (full mode) — fix any type-only breakages caused by the type-package downgrade.
5. Confirm zero typecheck warnings (project policy).

**Notes:**
- Should be functionally invisible because Node runtime is already 24.

### Task 7: Update all dependencies to latest versions

**Linear Issue:** [ADV-187](https://linear.app/lw-claude/issue/ADV-187)

**Files:**
- `package.json` (modify)
- `package-lock.json` (regenerate)
- Possibly `tsconfig.json`, `vitest.config.*`, source files (for breaking-change adjustments)

**Steps:**
1. Pre-condition: existing test suite passes after Task 6 (baseline).
2. Use `npx npm-check-updates -u` (or equivalent) to update every entry to latest. Capture the diff for review before installing.
3. Run `npm install`. Note: TypeScript will likely jump from `^5.7.3` → `^6.x`. Vitest is already on `^4.0.17`. `googleapis`, `fastify`, `pino`, `@google/clasp`, `esbuild` may have minor/patch bumps.
4. Run verifier (full mode):
   - If TypeScript 6 introduces type errors, fix them in source (do not pin TypeScript back unless the breakage is too large; if pinning, document the reason in the commit message).
   - If any dependency major bump breaks at runtime, narrow the pinning per-package — don't roll the whole upgrade back.
5. Confirm zero warnings in build and tests.

**Notes:**
- This task may require multiple verifier cycles. The implementer should commit incremental progress (one dependency major at a time if breakage occurs) so each commit is bisectable.
- **Cross-cutting:** none of these dependencies are external API clients with new auth requirements; existing timeout/error-handling specs in CLAUDE.md remain authoritative.
- Migration note: none of the upgrades change persistent data formats (no spreadsheet schema, no env-var rename, no folder structure). Safe to ship without migration logic.

### Task 8: Audit USD same-currency tolerance default usage

**Linear Issue:** [ADV-188](https://linear.app/lw-claude/issue/ADV-188)

**Files:**
- `src/utils/exchange-rate.ts` (audit)
- `src/utils/exchange-rate.test.ts` (add regression test)
- Caller sites (audit)

**Steps:**
1. Audit every call site of `amountsMatchCrossCurrency` (`grep -rn "amountsMatchCrossCurrency"` in `src/`). Confirm each caller passes `USD_SAME_CURRENCY_TOLERANCE` from `config.ts` rather than relying on the function's default of `1`.
2. Write a regression test asserting that a USD/USD pair within `USD_SAME_CURRENCY_TOLERANCE` but greater than `1` matches at every caller site (or at least at the matcher entry point).
3. Run verifier `"exchange-rate"` (expect either pass — no actual bug — or fail if a caller is silently using the default of 1).
4. If a caller is silently relying on the default, fix it to pass the config value explicitly.

**Notes:**
- Low-impact audit task. May yield no code change. Leave the function default as `1` (defensive; only larger tolerance via explicit caller parameter).

## Post-Implementation Checklist

1. Run `bug-hunter` agent — review git changes for bugs.
2. Run `verifier` agent (full mode) — verify all tests pass with zero warnings, zero typecheck errors.
3. (Operational, post-merge, via `/data-ops`):
   - Re-upload BBVA Visa March 2026 PDF (delete current `1AwN55RaavyIGDksL7ZFR7DNS8YEVyfH0`, push new file with new fileId; row should now land in `Control de Resumenes`).
   - Re-upload Credicoop February 2026 PDF (delete current `1SSpS0d23EJPKrUX2v_CjDhjiRalxx88L`, push new file). Verify Task 4's prompt fix produces correct full-month dates.
   - Triage `Sin Procesar` (8 stuck 2025 files) and `Entrada` (10 pending files, mostly 2025).
   - Manually match the PURPLE TREE 85k cobro on BBVA ARS 2026-01-28 movimiento.

---

## Plan Summary

**Objective:** Fix the production audit findings (log spam, silent resumen storage skips, recibo cascade asymmetry, Credicoop narrow-date extraction) AND lock Node 24 enforcement on Railway + update all dependencies to latest, matching adva-facturador's tooling baseline.

**Linear Issues:** ADV-181, ADV-182, ADV-183, ADV-184, ADV-185, ADV-186, ADV-187, ADV-188

**Approach:** Eight task-level work units, mostly TDD code fixes (Tasks 1–4, 8) plus three tooling/dependency tasks (Tasks 5–7). Tasks 5–7 form a logical sub-batch for an upgrade-foundation worker; Tasks 1–4, 8 partition cleanly across reviewer/implementer workers since they touch separate files. Task 4 (Credicoop prompt) requires Gemini MCP iteration during implementation. After plan-implement and plan-review, operational follow-ups (re-upload missing resumenes, triage Sin Procesar/Entrada) happen via `/data-ops`.

**Scope:** 8 tasks, ~9 source files modified, ~5 test files modified or extended, 1 new file (`.nvmrc`), 0 deletions in source. REVIEW.md is removed at plan-publish time (per request) since the plan now supersedes it.

**Key Decisions:**
- Don't introduce a "force reprocess" feature in this plan — flagged for a follow-up plan or `/data-ops` skill update; out of scope here.
- Fix the resumen-storage observability gap (logs to info, scanner records `duplicate`) without trying to invent a deeper invariant — the proximate cause for the two specific missing rows is uncertain, and instrumentation makes future occurrences visible.
- Match adva-facturador's exact `nixpacksArchive` pin so Railway behavior converges with the sibling project.
- Accept TypeScript 6 jump as part of the bulk-update if it doesn't blow up; pin back per-package only if necessary.

**Risks:**
- Task 7 (bulk dep update) may introduce TS 6 / library breakage that requires fix-up commits. Mitigation: incremental commits, single-package rollback on stubborn breakage.
- Task 5 (Node pinning) changes the runtime version on Railway. Mitigation: ship to staging first, smoke-test before promoting to release.
- Task 4 (Credicoop prompt) is the highest-judgment task — Gemini MCP iteration may surface that the prompt fix interacts with other resumen formats. Mitigation: regression-test against all currently-stored Credicoop / BBVA / Banco Ciudad statements.

---

## Iteration 1

**Implemented:** 2026-05-06
**Method:** Agent team (4 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1 (ADV-181): Negative-cache exchange rate API misses + demote per-attempt warn (worker-1)
- Task 2 (ADV-182): Resumen storage observability — info logs + scanner records 'duplicate' status (worker-2)
- Task 3 (ADV-183): Fix recibo-pago cascade hasCuitMatch asymmetry (worker-2)
- Task 4 (ADV-184): Credicoop resumen_bancario prompt anchor + parser narrow-window flag (worker-3)
- Task 5 (ADV-185): Pin Node 24 on Railway via nixpacks.toml + add .nvmrc (worker-4)
- Task 6 (ADV-186): Sync @types/node to Node 24 major (worker-4)
- Task 7 (ADV-187): Bulk dependency update incl. TypeScript 6 (worker-4)
- Task 8 (ADV-188): USD same-currency tolerance audit — no caller bug found, regression test added (worker-1)

### Files Modified
- `.nvmrc` (new) — content `24`
- `nixpacks.toml` — `[phases.setup]` with `nodejs_24` + `nixpkgsArchive` matching adva-facturador
- `package.json`, `package-lock.json` — TypeScript 6, vitest 4.1.5, @types/node 24, fastify 5.8.5, googleapis 171.4, p-queue 9.2, pino 10.3.1, esbuild 0.28, tsx 4.21, dotenv 17.4.2, @google/clasp 3.3, @vitest/coverage-v8 4.1.5
- `src/utils/exchange-rate.ts` — negative-cache helpers (`isNegativelyCached`, `setCachedNegative`), 1h TTL for negative entries (vs 24h positive), `prefetchExchangeRates` writes negative entries on failure with race-safe positive-cache check, `amountsMatchCrossCurrency` warn→debug for per-attempt cache miss
- `src/utils/exchange-rate.test.ts` — 10 new tests (negative cache, USD tolerance regression)
- `src/processing/storage/resumen-store.ts` — 3 warn→info for duplicate detection
- `src/processing/storage/resumen-store.test.ts` — 7 new tests
- `src/processing/scanner.test.ts` (new) — 4 regression tests for duplicate routing
- `src/processing/matching/recibo-pago-matcher.ts` — `bestMatch.recibo.hasCuitMatch ?? (existingMatchConfidence === 'HIGH')` at 2 sites (in-memory flag wins; HIGH proxy fallback for sheet-loaded recibos pending ADV-189)
- `src/processing/matching/recibo-pago-matcher.test.ts` — 3 new tests
- `src/types/index.ts` — `hasCuitMatch?: boolean` added to `Recibo` interface
- `src/gemini/prompts.ts` — strengthened `getResumenBancarioPrompt` with explicit period-header anchor and footer/saldo rejection
- `src/gemini/parser.ts` — narrow-window flag (`needsReview=true` when `0 < diffDays < 14`)
- `src/gemini/parser.test.ts` — 8 new tests covering Credicoop bug cases and threshold boundaries

### Linear Updates
- ADV-181, ADV-182, ADV-183, ADV-184, ADV-185, ADV-186, ADV-187, ADV-188: Todo → In Progress → Review
- ADV-189 (new, Backlog): Persist recibo `hasCuitMatch` to Recibos sheet (column S) — created from bug-hunter finding

### Pre-commit Verification
- bug-hunter: Found 4 issues (1 HIGH, 2 MEDIUM, 1 LOW). HIGH (recibo hasCuitMatch persistence gap) and one MEDIUM (negative-cache race) fixed in lead's post-merge pass; remaining MEDIUM (narrow-window false-positive on legitimate short-period statements) accepted per bug-hunter's own assessment as soft-flag-only; LOW (TypeScript 6 ^ range) left as-is — verifier passed clean.
- verifier: 1978 tests pass across 63 files, typecheck clean, build clean, zero warnings.

### Work Partition
- Worker 1: Tasks 1, 8 (utils — exchange rate)
- Worker 2: Tasks 2, 3 (services + matching — resumen storage, recibo cascade, types)
- Worker 3: Task 4 (gemini layer — prompts + parser)
- Worker 4: Tasks 5, 6, 7 (toolchain + deps — Node 24, dep upgrades)

### Merge Summary
- Worker 4 (toolchain): fast-forward
- Worker 2 (types + services): merged with `ort` strategy, no conflicts
- Worker 1 (utils): merged with `ort` strategy, no conflicts
- Worker 3 (gemini): merged with `ort` strategy, no conflicts

### Lead Post-merge Fixes
- `recibo-pago-matcher.ts:105/411` — added HIGH-confidence proxy fallback for `bestMatch.recibo.hasCuitMatch` to avoid regressing periodic re-match (Recibos sheet has no `hasCuitMatch` column; full persistence tracked in ADV-189).
- `exchange-rate.ts:350` — wrapped `setCachedNegative` in `if (!getCachedValue(cacheKey))` to prevent a concurrent failed prefetch from clobbering a positive entry.

### Continuation Status
All tasks completed.

### Review Findings

**Reviewed:** 2026-05-06
**Method:** Agent team (3 domain reviewers — security, reliability, quality)
**Files reviewed:** 14 (13 source/test + 3 toolchain configs)

**Issues found and fixed inline (1):**
1. [HIGH][convention] `src/gemini/prompts.ts:400-402` — Three TypeScript-style `// ADV-184:` comments were embedded INSIDE the template literal returned by `getResumenBancarioPrompt`, sending them verbatim to the Gemini API as part of the prompt body. Fixed inline (S-size, ≤3 fixes threshold met). Tracked as ADV-190 in Merge state.

**Discarded findings (5):**
1. [MEDIUM][test] `src/gemini/parser.test.ts:~1914` — Test name says "2-day window" but dates produce 1-day span. **Discard reason:** Style-only — cosmetic test naming, no correctness impact (the assertion correctly verifies 1 day < 14 flags).
2. [LOW][type] `src/processing/matching/recibo-pago-matcher.ts:107,413` — `hasCuitMatch` not persisted to Recibos sheet; sheet-loaded recibos fall back to `existingMatchConfidence === 'HIGH'` proxy. **Discard reason:** Already tracked as ADV-189 (Backlog) — explicitly created during this iteration's bug-hunter pass as a known follow-up. Not a missed bug.
3. [LOW][resource] `src/utils/exchange-rate.ts:61` — `memoryCache` Map has no maximum size cap. **Discard reason:** Reviewer themselves notes "in practice this is bounded by the date range of processed documents (a few thousand entries, ~KB range)". Theoretical concern, not a real resource leak. Pre-existing for positive entries; this PR adds negative entries to the same already-bounded Map.
4. [LOW][edge-case] `src/gemini/parser.ts:1182` — Inverted date range (`fechaHasta < fechaDesde`) doesn't trigger `needsReview`. **Discard reason:** Misdiagnosed — the narrow-window flag was intentionally scoped to positive narrow windows, the documented Credicoop failure mode (Jan/Mar/Apr 2026 production evidence all show positive narrow windows). Inverted ranges are speculative; the `diffDays > 0` guard intentionally excludes the documented SIN MOVIMIENTOS same-day case. Detection scope expansion is feature work, not a missed bug.
5. [LOW][convention] `src/gemini/parser.test.ts:~1870` — Test name says "28 days" but Feb statement actually spans 27 days. **Discard reason:** Style-only — cosmetic test naming, the assertion correctly verifies 27 days does NOT flag.

**Security review:** No findings. New transitive deps (Rolldown bundler backend) verified legitimate. No SSRF, no leaked secrets.
**Reliability review:** All iteration-specific concerns checked (negative-cache race guard, three-subtype duplicate routing, `??` semantics for `hasCuitMatch`, narrow-window threshold). All passed.

### Linear Updates
- ADV-181, ADV-182, ADV-183, ADV-184, ADV-185, ADV-186, ADV-187, ADV-188: Review → Merge
- ADV-190 (new, Merge): Strip TS-style comments from getResumenBancarioPrompt template literal — created from inline fix for traceability

### Inline Fix Verification
- vitest: 1979 tests passing, including new regression test `'should not leak TypeScript-style source comments into the prompt body'`
- typecheck: clean
- build: clean, zero warnings
- bug-hunter: no issues found in the inline fix

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
