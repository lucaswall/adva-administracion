# Changelog Guidelines

This is a **product changelog** — every entry must describe something a user of the system would notice or care about. Think "what changed in how documents are processed?" not "what code was written."

## INCLUDE

- New document types supported
- Changes to extraction accuracy or matching behavior
- New API endpoints or changed API behavior
- Bug fixes that affected document processing or data accuracy
- Performance improvements that affect processing speed or reliability

## Key Principle: Net Effect from Production

The changelog describes the **net difference between current production and the new release** — NOT a commit-by-commit replay of the development cycle. Always compare against the last release tag when deciding what to include.

**Development-internal churn gets zero entries.** Examples:

- Bug introduced in commit A, fixed in commit B -> neither appears (production never had the bug)
- Feature implemented, then reworked or redesigned before release -> one entry describing the final version, not the journey
- Code added then removed within the same cycle -> zero entries
- Fix for a regression that only existed in development -> zero entries

When in doubt, ask: "Would this change affect how documents are processed or how the API behaves in production?" If not, skip it.

## EXCLUDE — never add entries for

- Development-internal fixes (bugs that only existed in development, never in production)
- Changes that cancel each other out within the release cycle
- Rework/iteration on features introduced in the same cycle (only describe the final result)
- Internal service/utility refactoring (describe what the user-facing effect is, not the code change)
- Skill, tooling, or Claude Code changes
- Infrastructure changes (Railway config, env vars, internal architecture)
- Internal implementation details (code cleanup, defensive checks, logging improvements)
- Linear issue numbers (e.g., ADVA-224) — meaningless to end users

## Writing Style

- Describe from the operational perspective: "Bank statement matching now supports USD accounts" not "Added USD support to cascade-matcher.ts"
- Never expose file names, function names, or route paths
- One commit can map to zero entries (if purely internal) or one entry
- Multiple commits can be grouped into a single entry
