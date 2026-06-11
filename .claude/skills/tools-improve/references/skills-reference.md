# Skills Quick Reference

## Progressive Disclosure (3-Layer Model)

Skills load information in stages to optimize context window usage:

| Level | When Loaded | Limits | Content |
|-------|------------|--------|---------|
| **1. Metadata** | Always (at startup) | description capped at **1,536 chars** per entry; `/skills` listing truncates each to 250 chars | `name` + `description` from YAML frontmatter |
| **2. Instructions** | When skill is triggered | After auto-compaction, retains the first **5,000 tokens** within a combined **25,000-token** budget across all triggered skills | SKILL.md body |
| **3. Resources** | As needed | Effectively unlimited | Supporting files (scripts, references, templates) |

**Design implication:** Keep SKILL.md focused on instructions. Put large reference docs, API specs, and examples in supporting files and reference them from SKILL.md so Claude loads them only when needed.

## Invocation Control Matrix

| Frontmatter | User `/invoke` | Claude auto-invoke | When loaded into context |
|-------------|----------------|-------------------|--------------------------|
| (default) | Yes | Yes | Description always in context; full skill on trigger |
| `disable-model-invocation: true` | Yes | No | Description NOT in context; full skill on manual invoke |
| `user-invocable: false` | No | Yes | Description always in context; full skill on trigger |

**Note:** `user-invocable` only controls menu visibility, not Skill tool access. Use `disable-model-invocation: true` to block programmatic invocation entirely.

## Skill Directory Structure

```
my-skill/
├── SKILL.md           # Required - main instructions
├── scripts/           # Executable code (Python/Bash)
├── references/        # Documentation loaded as needed
└── assets/            # Templates, icons (not loaded)
```

**Skills are self-contained.** Each skill directory is independent. There is NO shared directory pattern across skills. If you need to reduce duplication:
1. Put shared content in **CLAUDE.md** (loaded into all contexts)
2. Create a **background knowledge skill** with `user-invocable: false`
3. Accept duplication (self-contained skills are more maintainable)

## Naming Rules

- `name` field: lowercase letters, numbers, and hyphens only
- Maximum 64 characters
- If `name` omitted, defaults to directory name
- If `description` omitted, falls back to first paragraph of markdown content
- Plugin skills are namespaced as `<plugin-name>:<skill-name>`
- The `SKILL.md` filename should be uppercase. On case-sensitive filesystems (Linux, default macOS APFS) `skill.md` or `Skill.md` will not be discovered; on case-insensitive filesystems it works but is non-portable.

## String Substitutions

| Variable | Example | Result |
|----------|---------|--------|
| `$ARGUMENTS` | `/fix 123` | `123` |
| `$0`, `$1`, `$2` | `/migrate Foo React Vue` | `Foo`, `React`, `Vue` |
| `$ARGUMENTS[N]` | Same as `$N` | Same as above |
| `$<name>` | Named arg via `arguments:` frontmatter | Bound value |
| `${CLAUDE_SESSION_ID}` | - | `abc123def...` |
| `${CLAUDE_EFFORT}` | - | `low` / `medium` / `high` / `xhigh` / `max` (v2.1.119+) |
| `${CLAUDE_SKILL_DIR}` | - | Absolute path to this skill's directory |
| `` !`gh pr diff` `` | - | (PR diff output, single line) |
| `` ```! ... ``` `` fenced block | - | Multi-line shell injection |

**Notes:**
- `` !`command` `` executes BEFORE Claude sees content (preprocessing, not Claude execution).
- If `$ARGUMENTS` is absent in content, arguments are auto-appended as `ARGUMENTS: <value>`.
- Include "ultrathink" in skill content to enable extended thinking.
- Set `shell: powershell` in frontmatter to interpret `` !`cmd` `` via PowerShell instead of bash.
- `disableSkillShellExecution` setting (v2.1.91+) globally blocks all `` !`cmd` `` injection.

## Context: Fork vs Inline

**Inline** (default):
- Runs in main conversation
- Has full conversation context
- Good for reference/knowledge skills

**Fork** (`context: fork`):
- Runs in isolated subagent
- No conversation history
- Good for research/exploration
- Specify agent type with `agent:` field (built-in: `Explore`, `Plan`, `general-purpose`; or any custom agent)

**Warning:** `context: fork` only makes sense for skills with **explicit task instructions**. If your skill contains guidelines like "use these API conventions" without a concrete task, the subagent receives guidelines but no actionable prompt and returns without meaningful output.

| Approach | System prompt | Task | Also loads |
|----------|--------------|------|------------|
| Skill with `context: fork` | From agent type | SKILL.md content | CLAUDE.md |
| Subagent with `skills` field | Subagent's markdown body | Claude's delegation message | Preloaded skills + CLAUDE.md |

## Design Patterns

| Pattern | When to Use | Key Technique |
|---------|------------|---------------|
| **Sequential Workflow** | Multi-step processes (deploy, release, migrate) | `disable-model-invocation: true`, ordered steps |
| **MCP Coordination** | Combining multiple MCP tools into one workflow | Skill wraps MCP calls with business logic |
| **Iterative Refinement** | Output needs progressive improvement | Skill defines criteria + review loop |
| **Context-Aware Tool Selection** | Different tools needed based on input | Conditional instructions based on `$ARGUMENTS` |
| **Domain-Specific Intelligence** | Embedding expert knowledge | Supporting files with schemas, APIs, conventions |

## Complete Examples

### API Reference Skill
```yaml
---
name: api-conventions
description: API design patterns for this codebase. Use when writing or reviewing API endpoints.
---

When writing API endpoints:
- RESTful naming
- Consistent error format: { error: string, code: number }
- Validate all inputs
- Include rate limit headers
```

### Deploy Skill (Side Effects)
```yaml
---
name: deploy
description: Deploy to production
disable-model-invocation: true
context: fork
allowed-tools: Bash, Read
---

Deploy $ARGUMENTS:
1. `npm test` - all must pass
2. `npm run build`
3. `git push origin main`
4. Verify at https://app.example.com/health
```

### Research Skill (Isolated)
```yaml
---
name: deep-research
description: Research codebase thoroughly
context: fork
agent: Explore
---

Research $ARGUMENTS:
1. Find files: Glob and Grep
2. Read and analyze
3. Map dependencies
4. Return summary with file:line references
```

### PR Summary (Dynamic Context)
```yaml
---
name: pr-summary
description: Summarize a pull request
context: fork
agent: Explore
allowed-tools: Bash(gh *)
---

## Context
- Diff: !`gh pr diff`
- Comments: !`gh pr view --comments`
- Files: !`gh pr diff --name-only`

## Task
Summarize: what changed, why, concerns, test suggestions.
```

### Background Knowledge (Hidden)
```yaml
---
name: legacy-db-context
description: Legacy database schema. Use when querying orders table.
user-invocable: false
---

Orders table uses legacy schema:
- `order_id` VARCHAR(20) not INT
- `status` uses codes: 1=pending, 2=shipped, 3=delivered
- Always join with `order_items` for line items
- Index on (customer_id, created_at)
```

## Hooks in Skills

Same format as subagents. **Five** hook types available:

| Type | Use For | Default Timeout |
|------|---------|-----------------|
| `command` | Shell script validation (exit 2 to block) | 600s |
| `prompt` | LLM yes/no decision (fast model, single-turn) | 30s |
| `agent` | Multi-turn validation with tool access | 60s |
| `http` | POST hook input as JSON to a URL (use `allowedEnvVars` for secrets) | 30s |
| `mcp_tool` | Direct MCP tool invocation (v2.1.118+) | per-tool |

Hook events available in skill frontmatter: all settings.json events, including `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, etc.

Skill hook entries also support:
- `once: true` — fire only once per session
- `if: "<permission-rule>"` — evaluate only if the matched call would be governed by that rule, e.g. `if: "Bash(git *)"` or `if: "Edit(*.ts)"` (v2.1.85+)

```yaml
---
name: safe-modifier
hooks:
  PreToolUse:
    - matcher: "Bash"
      if: "Bash(rm *)"
      hooks:
        - type: command
          command: "./scripts/validate.sh"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "npm run lint"
  Stop:
    - hooks:
        - type: prompt
          prompt: "Check if all acceptance criteria are met. If not, respond with reason."
---
```

JSON output (`stdout`) for non-`command` hooks:
```json
{ "hookSpecificOutput": { "permissionDecision": "allow" | "deny" | "ask" | "defer" } }
```
`defer` is `-p` mode only — it exits with the call preserved for an SDK wrapper to resume.

## Restrict Skill Access

In `/permissions`:
```
# Deny all skills
Skill

# Allow specific
Skill(commit)
Skill(review-pr *)

# Deny specific
Skill(deploy *)
```

Syntax: `Skill(name)` exact, `Skill(name *)` prefix match

## Settings That Govern Skills

| Setting | Effect |
|---------|--------|
| `skillOverrides` | `off` (no overrides), `name-only` (project skill replaces user-level skill of same name), `user-invocable-only` (only override if user-invocable), or `on` |
| `disableSkillShellExecution` | Blocks all `` !`cmd` `` shell injection in skills (v2.1.91+) |
| `SLASH_COMMAND_TOOL_CHAR_BUDGET` | Override the description-budget character cap |

## Context Budget

Skill descriptions budget scales dynamically at **1% of the context window**, with a fallback of **8,000 characters**. Caveat: the 1% is computed against a fixed ~200K-token baseline, NOT the model's actual window — on 1M-context models the effective budget is ~5× smaller than expected (raise `skillListingBudgetFraction`, e.g. `0.05`, if descriptions get dropped).

Check: `/context` and `/doctor` — show warnings if skill descriptions were dropped.

Override: `SLASH_COMMAND_TOOL_CHAR_BUDGET=30000` or the `skillListingBudgetFraction` setting.

## Tool Access Semantics (important)

- `allowed-tools` **GRANTS** (pre-approves, no permission prompt) the listed tools while the skill is active. It does **NOT** restrict the tool pool — every other tool remains callable under normal permission rules. Never describe allowed-tools as a restriction; enforce restrictions with permission **deny rules** in settings.json or PreToolUse hooks.
- `disallowed-tools` (v2.1.152+) removes tools from the model while the skill is active; the restriction clears on the next user message.
- Literal `$` before a digit, `ARGUMENTS`, or a declared argument name must be escaped as `\$` (v2.1.163+), e.g. `\$1.00`.
- `/reload-skills` (v2.1.152+) re-scans skill directories without restarting; SKILL.md text changes also hot-reload automatically. Agent `.md` files do NOT hot-reload — they need a session restart (or the `/agents` UI).
- Keep descriptions on a single YAML line — multi-line block scalars can make a skill silently vanish from the listing.

## Nested Discovery

Skills in subdirectories auto-discovered. If editing `packages/frontend/foo.ts`, Claude also finds `packages/frontend/.claude/skills/`.

Skills defined in `.claude/skills/` within `--add-dir` directories are loaded automatically with live change detection.

## Testing & Iteration

### Test levels
1. **Manual** — Direct `/skill-name` execution, verify output
2. **Scripted** — Repeatable test cases for stability
3. **Programmatic** — SDK/API automated testing before distribution

### What to test
- **Trigger accuracy** — Does the skill fire for intended queries? Does it avoid firing for unrelated ones?
- **Functional correctness** — Does it produce expected outputs and follow procedures?
- **Edge cases** — Missing arguments, unusual input, large files

### Iteration guide

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Skill never triggers | Description doesn't match user's natural language | Add phrases users would actually say |
| Skill triggers too often | Description too broad | Narrow with specific conditions and contexts |
| Unstable output | Vague instructions | Add concrete steps and output format examples |
| Subagent returns empty | Guideline-only skill with `context: fork` | Remove `context: fork` or add explicit task |

## Troubleshooting

| Problem | Root Cause | Fix |
|---------|-----------|-----|
| Skill not recognized | Wrong filename case (`skill.md` vs `SKILL.md`) | Use exact `SKILL.md` in correct directory |
| Claude doesn't see all skills | Context budget exceeded | Reduce description lengths or increase `SLASH_COMMAND_TOOL_CHAR_BUDGET` |
| Instructions ignored | SKILL.md too large | Keep under 500 lines; move details to supporting files |
| MCP tools unavailable in skill | Missing `allowed-tools` | Add tool names to frontmatter |
| Subagent returns empty | Task-less skill with `context: fork` | Remove fork or add explicit task instructions |

## Best Practices Checklist

- [ ] Description follows `[what] + [when] + [features]` formula (≤1,536 chars; first 250 shown in `/skills`)
- [ ] SKILL.md under 500 lines
- [ ] Side effects → `disable-model-invocation: true`
- [ ] Research → `context: fork` with explicit task
- [ ] Background knowledge → `user-invocable: false`
- [ ] Large docs → separate files, linked from SKILL.md
- [ ] Tested: skill triggers correctly and doesn't over-trigger
- [ ] `name` follows naming rules (lowercase, hyphens, max 64 chars)
- [ ] Effort knob considered (`effort:` or `${CLAUDE_EFFORT}`) for cost-sensitive workflows
- [ ] Path scoping considered (`paths:` glob) if the skill is only relevant in one area
