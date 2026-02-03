# Implementation Plan

**Created:** 2026-02-03
**Source:** Linear Backlog issues
**Linear Issues:** [ADV-52](https://linear.app/adva-administracion/issue/ADV-52/update-all-dependencies-to-latest-versions)

## Context Gathered

### Codebase Analysis

**Current outdated packages (`npm outdated`):**

| Package | Current | Wanted | Latest | Type |
|---------|---------|--------|--------|------|
| fastify | 5.7.1 | 5.7.4 | 5.7.4 | semver-compatible (patch) |
| pino | 10.2.0 | 10.3.0 | 10.3.0 | semver-compatible (minor) |
| @types/node | 25.0.9 | 25.2.0 | 25.2.0 | semver-compatible (minor) |
| vitest | 4.0.17 | 4.0.18 | 4.0.18 | semver-compatible (patch) |
| @vitest/coverage-v8 | 4.0.17 | 4.0.18 | 4.0.18 | semver-compatible (patch) |
| googleapis | 170.1.0 | 170.1.0 | 171.1.0 | **major bump** (needs ^170→^171) |
| @google/clasp | 2.5.0 | 2.5.0 | 3.2.0 | **major bump** (needs ^2→^3) |

**Fastify security context:**
- Two known vulnerabilities in 5.7.1: high-severity Content-Type header body validation bypass (patched 5.7.2) and low-severity DoS via sendWebStream (patched 5.7.3)
- Used in: `src/server.ts` (init with logger), routes (`src/routes/scan.ts`, `src/routes/status.ts`, `src/routes/webhooks.ts`), middleware (`src/middleware/auth.ts`)
- Features used: route type generics, onRequest hooks, logger transport, plugin registration
- Update is semver-compatible (^5.2.1 allows 5.7.4), no code changes expected

**googleapis usage:**
- `src/services/google-auth.ts` - `google.auth.GoogleAuth` constructor
- `src/services/drive.ts` - `google.drive()`, `drive_v3.Drive` type, file operations (list, get, create, update, watch)
- `src/services/sheets.ts` - `google.sheets()`, `sheets_v4.Sheets` type, `sheets_v4.Schema$Request`, `sheets_v4.Schema$CellData`
- `support/upload-samples.js` - utility script
- Update from 170→171 is a major bump; need to check for breaking changes in drive_v3 and sheets_v4 APIs

**@google/clasp usage:**
- CLI tool only, invoked via `npm run deploy:script` → `clasp push`
- Config: `apps-script/.clasp.json`
- Major bump 2→3; may change CLI behavior

**pino usage:**
- `src/utils/logger.ts` - pino constructor with transport config (pino-pretty)
- `src/server.ts` - Fastify logger transport config
- Minor bump 10.2→10.3, low risk

**Existing test conventions:**
- 1541 tests passing as of last plan
- Test files co-located as `*.test.ts`
- No new tests needed for dependency updates; existing suite validates compatibility

### Dependabot Context
- 6 alerts: 2 for fastify (real), 4 for hono (false positives — hono not used)
- Hono alerts need to be dismissed on GitHub

## Original Plan

### Task 1: Update semver-compatible dependencies
**Linear Issue:** [ADV-52](https://linear.app/adva-administracion/issue/ADV-52/update-all-dependencies-to-latest-versions)

This task has no new tests to write — the existing test suite (1541 tests) validates that updates don't break anything.

1. Run `npm update` to update all semver-compatible packages:
   - fastify 5.7.1 → 5.7.4 (security fix)
   - pino 10.2.0 → 10.3.0
   - @types/node 25.0.9 → 25.2.0
   - vitest 4.0.17 → 4.0.18
   - @vitest/coverage-v8 4.0.17 → 4.0.18
2. Run verifier — all tests must pass, zero warnings

### Task 2: Evaluate and update googleapis to v171
**Linear Issue:** [ADV-52](https://linear.app/adva-administracion/issue/ADV-52/update-all-dependencies-to-latest-versions)

1. Check googleapis v171 changelog/release notes for breaking changes in:
   - `drive_v3` API (files.list, files.get, files.create, files.update, files.watch, channels.stop)
   - `sheets_v4` API (spreadsheets.values.get, values.update, values.append, values.batchUpdate, spreadsheets.get, spreadsheets.batchUpdate, values.clear)
   - `Auth.GoogleAuth` constructor
   - `Schema$Request` and `Schema$CellData` types
2. If no breaking changes affect the used APIs:
   - Update `package.json`: change `"googleapis": "^170.1.0"` to `"googleapis": "^171.1.0"`
   - Run `npm install`
3. If breaking changes exist:
   - Apply necessary code changes in affected files (`src/services/google-auth.ts`, `src/services/drive.ts`, `src/services/sheets.ts`)
4. Run verifier — all tests must pass, zero warnings

### Task 3: Evaluate and update @google/clasp to v3
**Linear Issue:** [ADV-52](https://linear.app/adva-administracion/issue/ADV-52/update-all-dependencies-to-latest-versions)

1. Check @google/clasp v3 changelog for breaking changes in:
   - `clasp push` command behavior
   - `.clasp.json` config format
   - Authentication flow
2. If no breaking changes:
   - Update `package.json`: change `"@google/clasp": "^2.4.2"` to `"@google/clasp": "^3.2.0"`
   - Run `npm install`
3. If breaking changes exist:
   - Apply necessary changes to `apps-script/.clasp.json` and/or `apps-script/build.js`
   - Update `package.json` deploy:script command if needed
4. Run verifier — all tests must pass, zero warnings
5. Verify `npm run build:script` still works (clasp push requires auth so can't test fully, but build step should succeed)

### Task 4: Dismiss false-positive Dependabot alerts
**Linear Issue:** [ADV-52](https://linear.app/adva-administracion/issue/ADV-52/update-all-dependencies-to-latest-versions)

1. Use `gh` CLI to dismiss the 4 hono Dependabot alerts as "not applicable"
   - Run `gh api repos/{owner}/{repo}/dependabot/alerts` to list alerts
   - Dismiss hono-related alerts with reason "not_used"

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Update all npm dependencies to latest versions, fixing two known Fastify security vulnerabilities and bringing all packages up to date.

**Linear Issues:** ADV-52

**Approach:**
- First update all semver-compatible packages via `npm update` (low risk, includes critical Fastify security patches)
- Then evaluate and update the two major-version bumps (googleapis 170→171, @google/clasp 2→3) after checking changelogs for breaking changes
- Finally dismiss false-positive Dependabot alerts for hono

**Scope:**
- Tasks: 4
- Files affected: 1-3 (package.json always; possibly service files if googleapis has breaking changes; possibly clasp config)
- New tests: no (existing 1541 tests validate compatibility)

**Key Decisions:**
- Update semver-compatible packages first as they're low risk and include the security fix
- Evaluate major bumps separately with changelog review before updating
- googleapis and clasp get individual tasks since they need breaking change assessment

**Dependencies/Prerequisites:**
- Task 1 must complete first (establishes baseline)
- Tasks 2 and 3 are independent of each other
- Task 4 is independent and can run anytime
