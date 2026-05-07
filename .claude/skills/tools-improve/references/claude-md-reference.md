# CLAUDE.md Best Practices

Source: [Anthropic official docs](https://code.claude.com/docs/en/best-practices) and [memory docs](https://code.claude.com/docs/en/memory).

## Core Principle

CLAUDE.md is loaded into **every session**. It consumes context that Claude needs for actual work. Every line must earn its place. The official guidance is to keep each CLAUDE.md **under ~200 lines**.

> "For each line, ask: 'Would removing this cause Claude to make mistakes?' If not, cut it."
> "Bloated CLAUDE.md files cause Claude to ignore your actual instructions!"

**Maintainer-only notes:** block-level HTML comments in CLAUDE.md are stripped before context injection — useful for "do not load this" notes that you still want to see in source.

## What to Include

| Category | Examples |
|---|---|
| Bash commands Claude can't guess | Build, test, lint commands with non-standard flags |
| Code style rules **that differ from defaults** | `@/` path aliases, unconventional patterns |
| Testing instructions | Preferred runners, test file conventions |
| Repository etiquette | Branch naming, PR conventions, commit rules |
| Architectural decisions | Non-obvious design choices specific to the project |
| Developer environment quirks | Required env vars, special setup steps |
| Common gotchas | Non-obvious behaviors that cause repeated mistakes |

## What to Exclude

| Category | Why | Alternative |
|---|---|---|
| File-by-file codebase descriptions | Claude discovers files via Glob/Grep | Directory-level overview only |
| Anything Claude can infer from code | Wastes context on redundant info | Let Claude read the code |
| Standard language conventions | Claude already knows them | Only document deviations |
| Detailed API documentation | Changes frequently, large | Link to source files or docs |
| Information that changes frequently | Goes stale, misleads Claude | Use `@imports` or let Claude read source |
| Long explanations or tutorials | Bloats context | Move to skills or reference files |
| Self-evident practices | "Write clean code" adds nothing | Delete |

## `@import` Syntax

Reference external files from CLAUDE.md to keep it concise:
```markdown
See @README.md for project overview and @package.json for available npm commands.
@docs/git-instructions.md
@~/.claude/my-project-instructions.md
```
- Files are loaded inline when Claude reads CLAUDE.md
- Up to 5 levels of nesting
- Works with relative paths, absolute paths, and `~` home directory

## Modular Organization

For larger projects, use `.claude/rules/*.md` for topic-specific instructions:
- Each file covers one topic (e.g., `testing.md`, `api-design.md`)
- Supports path-scoping via YAML `paths` frontmatter (glob patterns like `src/**/*.{ts,tsx}`)
- Rules without `paths` load unconditionally; with `paths` load only when matching files are touched
- All loaded automatically as project memory
- Subdirectories supported (discovered recursively)
- User-level rules at `~/.claude/rules/` also supported

## Memory Locations

| Path | Scope | Notes |
|------|-------|-------|
| `./CLAUDE.md` | Project, shared | Checked into VCS |
| `./CLAUDE.local.md` | Project, personal | `.gitignore`d |
| `~/.claude/CLAUDE.md` | User | Loads in every project |
| `~/.claude/rules/*.md` | User, path-scoped | With `paths:` frontmatter |
| `.claude/rules/*.md` | Project, path-scoped | Discovered recursively |
| `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS) | Managed (org policy) | Cannot be excluded |
| `/etc/claude-code/CLAUDE.md` (Linux) | Managed | Cannot be excluded |
| `C:\Program Files\ClaudeCode\CLAUDE.md` (Windows) | Managed | Cannot be excluded |

**Settings that govern memory loading:**
- `claudeMdExcludes` — skip ancestor CLAUDE.md files in monorepos (managed-policy CLAUDE.md is exempt and cannot be excluded)
- `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` — also load CLAUDE.md from `--add-dir` paths
- `CLAUDE_CODE_NEW_INIT=1` — enables the multi-phase interactive `/init` flow

**`AGENTS.md`** is **not** auto-read. Use `@AGENTS.md` inside CLAUDE.md to import it.

## Auto Memory (v2.1.59+)

Separate from your hand-written CLAUDE.md, Claude curates `~/.claude/projects/<project>/memory/MEMORY.md` itself across conversations. The first 200 lines / 25 KB of `MEMORY.md` plus the index of topic files are loaded each session; topic files (`debugging.md`, `feedback.md`, etc.) load on demand.

Toggle via:
- `/memory` slash command
- `autoMemoryEnabled` setting
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`
- `autoMemoryDirectory` (user/managed settings only — not project-level, for security)

## Debugging What Loads

Configure an `InstructionsLoaded` hook in settings.json to log every CLAUDE.md / `.claude/rules/` file the harness pulls in. Useful for monorepos where it isn't obvious which CLAUDE.md is winning.

## When Reviewing CLAUDE.md

Apply this checklist:

1. **File-by-file structure tree?** → Replace with directory-level overview or remove entirely
2. **Style rules Claude already knows?** → Remove (camelCase for JS, PascalCase for components, etc.)
3. **Full API endpoint table?** → Replace with pointer to route files, keep only non-obvious formats
4. **Full env var listing?** → Replace with pointer to `.env.sample`, keep only gotchas
5. **Detailed config sections?** → If Claude can read the config file, just point to it
6. **Domain knowledge only relevant sometimes?** → Move to a skill
7. **Stale content?** → Cross-check tables/lists against actual files (agents, DB tables, components)
8. **Emphasis on critical rules?** → Use "IMPORTANT" or "YOU MUST" for rules that must not be ignored
9. **Checked into git?** → CLAUDE.md should be in version control for team sharing
10. **Test by subtraction** → For each line, remove it and ask: "Would Claude make mistakes without this?" If not, cut it. Instruction-following quality degrades as instruction count increases.

## When Adding to CLAUDE.md

Before adding a new line, ask:
1. Would Claude make mistakes without this? If no → don't add
2. Can Claude figure this out by reading code? If yes → don't add
3. Is this relevant to every session? If no → put it in a skill or `.claude/rules/`
4. Is this a standard convention? If yes → don't add (only document deviations)
5. Will this go stale? If yes → point to the source file instead

## CLAUDE.md vs Skills vs Rules

| Content | Where |
|---|---|
| Project-wide conventions (every session) | CLAUDE.md |
| Path-specific rules (e.g., API files only) | `.claude/rules/` with `paths` frontmatter |
| Domain workflows (invoked on demand) | `.claude/skills/` |
| Background knowledge (auto-loaded when relevant) | Skill with `user-invocable: false` |
| Personal preferences (not shared) | `CLAUDE.local.md` or `~/.claude/CLAUDE.md` |
| Notes Claude curates over time | Auto Memory (`MEMORY.md`) |
