---
name: push-to-production
description: Release to production by pushing to main and release branches, verifying Railway auto-deploy, creating a GitHub Release, and transitioning Linear issues. Use when user says "push to production", "release", "deploy to production", or "ship it". Bumps version, updates changelog, pushes to main + release, verifies Railway deployment, creates GitHub Release, and moves Linear issues to Released.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Task, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__get_issue, mcp__linear__list_issue_statuses, mcp__Railway__get-logs, mcp__Railway__list-deployments
argument-hint: [version]
disable-model-invocation: true
---

Release to production. Two Railway environments auto-deploy from different branches:
- **Staging** auto-deploys from `main`
- **Production** auto-deploys from `release`

Both branches must be pushed. The Railway MCP is linked to **staging** — always specify `environment: "production"` when checking production deployments.

## Phase 1: Pre-flight Checks

### 1.1 Verify Linear MCP

**ALWAYS call `mcp__linear__list_issues` with `team: "ADVA Administracion"`, `state: "Done"` directly.** Do NOT try to determine MCP availability by inspecting the tool list, checking settings, or reasoning about it — you MUST actually invoke the tool and check the result. If the call fails or returns an error, **warn** but do not stop — Linear state transitions are cosmetic, the release can proceed without them.

Record any Done issues for Phase 5.

### 1.2 Git State

```bash
git branch --show-current
git status --porcelain
```

**Requirements:**
- Must be on `main` branch
- Working tree must be clean (no uncommitted changes)
- Must be up to date with remote: `git fetch origin && git rev-list --count HEAD..origin/main` must be `0`

If any check fails, **STOP** and tell the user what to fix.

### 1.3 Check for Pending PLANS.md

Read `PLANS.md` from project root (if it exists). If it contains incomplete tasks (tasks not marked as done), **STOP**: "There are incomplete tasks in PLANS.md. Finish implementation first or clear the plan before releasing."

If PLANS.md doesn't exist or has no incomplete tasks, continue.

### 1.4 Build & Tests

Run the `verifier` agent (full mode) to confirm unit tests, lint, and build pass:

```
Use Task tool with subagent_type "verifier"
```

If verifier reports failures, **STOP**. Do not proceed with a broken build.

### 1.5 Diff Assessment

Check what's being released by examining commits since the last tag:

```bash
git describe --tags --abbrev=0
git log <last-tag>..HEAD --oneline
git diff <last-tag>..HEAD --stat
```

**First release (no prior tags):** If `git describe --tags` fails, this is the first tagged release. Use the full commit history and treat the current `package.json` version as the starting version. Show the user the recent commit list (last ~20 commits).

If there are no commits since the last tag, **STOP**: "Nothing to release. No commits since last release."

**IMPORTANT:** Show the user the commit list and file diff summary. Wait for acknowledgment before proceeding to Phase 2.

## Phase 2: Version & Changelog

### 2.1 Determine Version

Follows [Semantic Versioning 2.0.0](https://semver.org/):

1. Read `CHANGELOG.md` and extract the current version from the first `## [x.y.z]` header. If `CHANGELOG.md` doesn't exist, this is the first release.
2. If `$ARGUMENTS` contains a version (e.g., `2.0.0`):
   - Validate it's valid semver (X.Y.Z)
   - Validate it's strictly higher than current version
   - If invalid, **STOP**: "Invalid version. Must be higher than current [current]."
3. If no argument, **deduce the bump from the commits being released** (from Phase 1.5):
   - **MAJOR** (`x+1.0.0`): Incompatible/breaking changes — removed or renamed API routes, changed API response shapes, removed features
   - **MINOR** (`x.y+1.0`): Backward-compatible new functionality — new document types, new API endpoints, new processing features, significant operational improvements
   - **PATCH** (`x.y.z+1`): Backward-compatible bug fixes — bug fixes, extraction accuracy improvements, refactoring, performance improvements, dependency updates
   - When commits span multiple categories, use the **highest** bump level (MAJOR > MINOR > PATCH)
   - **First release:** Use the version already in `package.json` (e.g., `1.0.0`)
   - Show the user which version was chosen and why, so they can override if they disagree

### 2.2 Write Changelog Entry

Follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).

See [references/changelog-guidelines.md](references/changelog-guidelines.md) for full INCLUDE/EXCLUDE criteria and writing style rules.

**Process:**

1. Review the commit list from Phase 1.5
2. **Determine the net effect against production** — use `git diff <last-tag>..HEAD --stat` (not the commit list) as the source of truth for what actually changed. Commits that introduce and fix the same issue within the cycle, or that rework/remove staging-only code, produce zero changelog entries. The commit list helps understand intent; the diff shows what's actually shipping.
3. Filter out purely internal changes (they get zero entries)
4. Move any items from the `## [Unreleased]` section into the new version entry
5. Write a `## [version] - YYYY-MM-DD` entry, grouping changes under these section headers (omit empty sections):
   - `### Added` — new features, new document types, new API endpoints
   - `### Changed` — changes to existing functionality, extraction improvements
   - `### Deprecated` — features that will be removed in a future release
   - `### Removed` — removed features
   - `### Fixed` — bug fixes, extraction accuracy fixes
   - `### Security` — security-related changes, vulnerability fixes
6. Group minor fixes into single items (e.g., "Minor bug fixes" or "Minor extraction accuracy improvements")
7. Keep each section concise — aim for 3-8 items total across all sections
8. Insert the new entry between `## [Unreleased]` and the previous version (keep Unreleased section empty)
9. Update the comparison links at the bottom of the file:
   - Discover the repository URL from git remote or CLAUDE.md
   - `[Unreleased]` link: compare new version tag to HEAD
   - New version link: compare previous version tag to new version tag
   - Format: `[Unreleased]: https://github.com/<owner>/<repo>/compare/vNEW...HEAD`
   - Format: `[NEW]: https://github.com/<owner>/<repo>/compare/vOLD...vNEW`
   - **First release:** Use `[NEW]: https://github.com/<owner>/<repo>/commits/vNEW` (no previous tag to compare against)

### 2.3 Update package.json

Edit `package.json` to set `"version"` to the new version string. Skip if version already matches.

## Phase 3: Commit, Tag & Push

### 3.1 Commit Release Files

Stage and commit all release housekeeping files:

```bash
git add CHANGELOG.md package.json
git commit -m "release: v<version>"
```

### 3.2 Tag Release

Create an annotated git tag:

```bash
git tag -a "v<version>" -m "v<version>"
```

### 3.3 Push to Main and Release

Push the commit and tag to both branches:

```bash
git push origin main --follow-tags
git push origin main:release
```

The first push triggers **staging** auto-deploy. The second push triggers **production** auto-deploy.

If either push fails, **STOP**: "Push failed. Check remote access and try again."

## Phase 4: Verify Deployment

### 4.1 Wait for Production Deployment

Wait briefly (30 seconds) then check **production** deployment status:

```
Use mcp__Railway__list-deployments with environment: "production"
```

Look for a deployment that started after the push. Check its status.

### 4.2 Check Production Deployment Logs

Use Railway MCP to verify the **production** deployment succeeded:

```
Use mcp__Railway__get-logs with environment: "production"
```

Look for:
- Successful build completion
- Server startup message (Fastify listening)
- No crash loops or error patterns

If the deployment appears to have failed:
- Show the user the relevant log lines
- **Do NOT stop** — the git tag and GitHub Release can still proceed. The deployment issue needs separate investigation.
- Note the failure in the Phase 6 report

### 4.3 Create GitHub Release

Create a GitHub Release from the tag pushed in Phase 3.2. The release notes come from the changelog entry written in Phase 2.2.

**Extract release notes** from `CHANGELOG.md` — the content between the new `## [version]` header and the next `## [` header (excluding both headers). This is the same section written in Phase 2.2.

**Create the release:**

First, write the release notes to a temporary file to avoid multi-line Bash command issues:

```
Use the Write tool to create release-notes.md with the extracted changelog content
```

Then create the release using `--notes-file` (avoids multi-line `--notes` strings that break Bash permission patterns):

```bash
gh release create "v<version>" --title "v<version>" --notes-file release-notes.md --verify-tag
```

Clean up the temp file after:

```bash
rm -f release-notes.md
```

**Flags reference:**
- `--verify-tag` — Abort if the tag doesn't exist on the remote (safety check)
- `--title` — Release title (use the tag name, e.g., `v1.12.0`)
- `--notes-file` — Read release notes from file (preferred over `--notes` to avoid multi-line Bash issues)
- Do NOT use `--latest` — let GitHub auto-detect based on semver (default behavior is correct)
- Do NOT use `--draft` or `--prerelease` — all releases from this skill are production releases

**Error handling:** If `gh release create` fails, **do NOT stop the release**. Log a warning in the Phase 6 report:
```
**Warning:** GitHub Release creation failed: [error message]. Create manually with:
gh release create "v<version>" --title "v<version>" --notes-file release-notes.md --verify-tag
```

The git tag and deploy already succeeded — the GitHub Release is cosmetic and can be created manually later.

## Phase 5: Linear State Transitions

### 5.1 Move Done Issues to Released

Transition all Linear issues in "Done" to "Released" now that the code is live in production.

1. Use the Done issues already fetched in Phase 1.1. If that call failed, try again now:
   ```
   mcp__linear__list_issues with team: "ADVA Administracion", state: "Done"
   ```

2. Look up the Released state UUID using `mcp__linear__list_issue_statuses` with team "ADVA Administracion". Find the status with `name: "Released"`.

3. For each issue found, transition to Released using the **state UUID** (both Done and Released are `type: completed` — passing by name could silently no-op):
   ```
   mcp__linear__update_issue with id: <issue-id>, state: "<released-state-uuid>"
   ```

4. **Batch efficiently:** Call up to 10 `update_issue` calls in parallel. If there are more than 30 issues, update the first 30 and note the remainder in the report for manual transition.

5. Collect the list of moved issues (identifier + title) for the report.

If no issues are in Done, that's fine — skip silently.

### 5.2 Move Merge Issues to Done then Released

Check for any issues stuck in "Merge" state (PR was merged but Linear automation didn't fire):

```
mcp__linear__list_issues with team: "ADVA Administracion", state: "Merge"
```

For each Merge issue, transition to Released using the Released state UUID (skip the Done intermediate step — the code is already deployed).

If the Linear MCP is unavailable (tools fail), **do not STOP** — log a warning in the report and continue. The release itself succeeded; issue state is cosmetic.

## Phase 6: Report

```
## Release Complete

**Version:** X.Y.Z
**Commits:** N commits
**Staging:** Railway auto-deploy from main [triggered | check logs]
**Production:** Railway auto-deploy from release [triggered | check logs]
**GitHub Release:** [Created | Failed (see warning above)]

### Issues Released
[List of ADVA-xxx: title moved to Released, or "None"]

### Deployment Verification
- Production deployment status: [status]
- Production server startup: [confirmed | check logs]

### Next Steps
- Monitor Railway production logs for any issues
- Verify API health at production endpoint
```

## Error Handling

| Situation | Action |
|-----------|--------|
| Not on `main` | STOP — switch to main first |
| Dirty working tree | STOP — commit or stash |
| Behind remote | STOP — pull latest |
| Build/tests fail | STOP — fix before releasing |
| No commits to release | STOP — nothing to do |
| Incomplete PLANS.md | STOP — finish implementation first |
| Push to main fails | STOP — check remote access |
| Push to release fails | STOP — check remote access |
| Railway deploy fails | Warn in report — investigate separately |
| Invalid/lower version argument | STOP — must be valid semver higher than current |
| GitHub Release creation fails | Warn in report — release succeeded, create manually later |
| Linear MCP unavailable | Warn in report — issue states are cosmetic |
| Merge conflicts | STOP — user resolves manually |
| No prior tags (first release) | Use package.json version, show full commit history |

## Rules

- **No co-author attribution** — Commit messages must NOT include `Co-Authored-By` tags
- **Never force-push** — Use normal push only
- **Semantic Versioning 2.0.0** — Version bumps follow semver rules: MAJOR for breaking changes, MINOR for new features, PATCH for bug fixes. Every release gets a CHANGELOG.md entry and matching package.json version
- **Net-effect changelog** — Changelog describes what changed from production's perspective, not a commit-by-commit replay
- **Two-branch deploy** — Push to `main` (staging) AND `main:release` (production). Both must succeed.
- **Verify production** — Always specify `environment: "production"` when checking Railway deployment. The MCP defaults to staging.
- **Linear is cosmetic** — Issue state transitions are nice-to-have. Never block a release because Linear MCP is down.
- **Stop on any pre-flight failure** — Better to abort than ship broken code
