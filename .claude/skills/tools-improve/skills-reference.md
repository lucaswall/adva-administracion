# Skills Quick Reference

## Invocation Control Matrix

| Frontmatter | User `/invoke` | Claude auto-invoke | In context |
|-------------|----------------|-------------------|------------|
| (default) | Yes | Yes | Description always |
| `disable-model-invocation: true` | Yes | No | Description hidden |
| `user-invocable: false` | No | Yes | Description always |

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

## String Substitutions

| Variable | Example | Result |
|----------|---------|--------|
| `$ARGUMENTS` | `/fix 123` | `123` |
| `$0`, `$1`, `$2` | `/migrate Foo React Vue` | `Foo`, `React`, `Vue` |
| `$ARGUMENTS[N]` | Same as `$N` | Same as above |
| `${CLAUDE_SESSION_ID}` | - | `abc123def...` |
| `!\`gh pr diff\`` | - | (PR diff output) |

**Note**: `!`command`` executes BEFORE Claude sees content.

## Context: Fork vs Inline

**Inline** (default):
- Runs in main conversation
- Has full conversation context
- Good for reference/knowledge skills

**Fork** (`context: fork`):
- Runs in isolated subagent
- No conversation history
- Good for research/exploration
- Specify agent type with `agent:` field

**Warning:** `context: fork` only makes sense for skills with **explicit task instructions**. If your skill contains guidelines like "use these API conventions" without a concrete task, the subagent receives guidelines but no actionable prompt and returns without meaningful output.

## Complete Examples

### API Reference Skill
```yaml
---
name: api-conventions
description: API design patterns. Use when writing endpoints.
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

Same format as subagents:
```yaml
---
name: safe-modifier
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate.sh"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "npm run lint"
---
```

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

## Context Budget

Skill descriptions loaded into context (default: 15,000 chars).

Check: `/context` - shows warning if skills excluded.

Increase: `SLASH_COMMAND_TOOL_CHAR_BUDGET=30000`

## Nested Discovery

Skills in subdirectories auto-discovered. If editing `packages/frontend/foo.ts`, Claude also finds `packages/frontend/.claude/skills/`.

## Best Practices Checklist

- [ ] Description includes trigger phrases ("Use when...")
- [ ] SKILL.md under 500 lines
- [ ] Side effects → `disable-model-invocation: true`
- [ ] Research → `context: fork`
- [ ] Background knowledge → `user-invocable: false`
- [ ] Large docs → separate files, linked from SKILL.md
