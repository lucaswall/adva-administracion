# Subagents Quick Reference

## Built-in Subagents

| Agent | Model | Tools | Use For |
|-------|-------|-------|---------|
| **Explore** | Haiku | Read-only (denied Write/Edit). Accepts `quick` / `medium` / `very thorough` thoroughness | Fast codebase exploration, file discovery |
| **Plan** | Inherit | Read-only (denied Write/Edit) | Research during plan mode |
| **general-purpose** | Inherit | All | Complex multi-step tasks |
| **statusline-setup** | Sonnet | - | `/statusline` configuration |
| **claude-code-guide** | Haiku | WebFetch, WebSearch | Questions about Claude Code features |

## Managing Subagents

**`/agents` command** — Interactive UI for viewing, creating, editing, and deleting subagents. Recommended for management. Subagents created via `/agents` are available immediately without restart.

**Manual files** — Create `.md` files directly. Requires session restart or `/agents` to load.

## Key Constraints

**Keep the roster small.** Anthropic's current guidance is "narrow, specialized, well-described" rather than a hard cap, but in practice 3–4 custom subagents per project is plenty — beyond that, the lead struggles to pick the right one and delegation regresses.

**Subagents cannot spawn other subagents.** If your workflow requires nested delegation, use skills or chain subagents from the main conversation. Exception: an agent running as **main thread** via `claude --agent <name>` *can* spawn via `Agent(type1, type2)`.

**Restrict spawnable agents** — Use `Agent(type1, type2)` in the `tools` field to allowlist which agent types can be spawned (only applies when the subagent runs as main thread with `claude --agent`). The Task tool was renamed to **Agent** in v2.1.63.

**Plugin-installed subagents** ignore their declared `hooks`, `mcpServers`, and `permissionMode` fields — those are loaded only from project/user/CLI scopes for security.

## New Subagent Fields

### `background: true`
Always runs the subagent as a background task. Background subagents run concurrently, permissions are pre-approved at launch, and additional permissions are auto-denied. MCP tools work only if pre-approved at spawn.

### `isolation: worktree`
Runs the subagent in a temporary git worktree. The worktree is automatically cleaned up if the subagent makes no changes. If changes are made, the worktree path and branch are returned in the result. Useful for isolated experiments or risky operations.

### `effort` (`low` / `medium` / `high` / `xhigh` / `max`)
Per-subagent reasoning effort, overrides session default. Pair with `${CLAUDE_EFFORT}` template variable to make instructions adaptive.

### `color`
UI badge color: `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`. Purely cosmetic but useful for distinguishing custom agents at a glance.

### `initialPrompt`
Auto-submitted as the first user turn when the subagent runs as main thread (`claude --agent <name>`). The frontmatter body remains the system prompt.

## Where Subagents Live

| Location | Scope | Priority |
|----------|-------|----------|
| `--agents` CLI flag (JSON) | Current session only | 1 (highest) |
| Managed (org policy) | Org-wide | 2 |
| `.claude/agents/` | Current project | 3 |
| `~/.claude/agents/` | All your projects | 4 |
| Plugin's `agents/` directory | Where plugin is enabled | 5 (lowest) |

## Permission Modes

| Mode | Behavior | Use When |
|------|----------|----------|
| `default` | Standard prompts | General purpose |
| `acceptEdits` | Auto-accept Write/Edit | Trusted code writers |
| `auto` | Classifier reviews each action; non-interactive aborts after repeated blocks | Coordination leads, longer autonomous runs (replaces older `delegate` mode) |
| `dontAsk` | Auto-deny prompts (allowed tools still work) | **Read-only agents** |
| `bypassPermissions` | Skip ALL checks (dangerous) | Rarely — high trust only |
| `plan` | Read-only exploration | Planning/research |

**Tip:** Use `dontAsk` for read-only agents (reviewers, explorers, auditors). It auto-denies write operations while allowing the tools in the `tools` list.

**Parent precedence:** If the parent uses `bypassPermissions`, `acceptEdits`, or `auto`, that takes precedence and the child mode cannot weaken it.

**Override the model resolution chain** with `CLAUDE_CODE_SUBAGENT_MODEL=<model>`.

## MCP Access

**Subagents inherit MCP tools by default** when tools are not restricted. Configure per-subagent MCP with the `mcpServers` field (name reference to an already-configured server, or inline definition).

**Background subagents:** MCP works only if the specific tool is pre-approved at spawn. Anything not pre-approved is auto-denied.

**Agent team teammates:** The docs state teammates load MCP servers at spawn, but `skills:` and `mcpServers:` declared in a subagent definition are NOT applied when that definition is used as a teammate — teammates only get servers from project/user settings. Keep MCP operations on the lead in practice.

**MCP retry/safety:** Servers auto-retry up to 3× on transient startup errors. Reserved server name: `workspace` (cannot be used). Use `alwaysLoad: true` in server config to bypass tool-search deferral.

## Persistent Memory

The `memory` field gives a subagent a persistent directory that survives across conversations (introduced in v2.1.33):

| Scope | Location | Use When |
|-------|----------|----------|
| `user` | `~/.claude/agent-memory/<name>/` | Knowledge across all projects (recommended default) |
| `project` | `.claude/agent-memory/<name>/` | Project-specific, shareable via VCS |
| `local` | `.claude/agent-memory-local/<name>/` | Project-specific, NOT in VCS |

When enabled:
- System prompt includes read/write instructions for the memory directory
- First **200 lines or 25 KB** of `MEMORY.md` (whichever comes first) are auto-loaded
- Read, Write, Edit tools automatically enabled

**Auto Memory** (v2.1.59+) is the *user-level* equivalent for the main Claude session — Claude curates `~/.claude/projects/<project>/memory/MEMORY.md` itself across conversations. Toggle via `/memory`, `autoMemoryEnabled`, or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. `autoMemoryDirectory` is configurable in user/managed settings only (not project, for security).

## Hook Events

### In Subagent Frontmatter
All settings.json events are valid; the most common are below. `Stop` auto-converts to `SubagentStop` at runtime.

| Event | Matcher | When |
|-------|---------|------|
| `PreToolUse` | Tool name | Before tool executes |
| `PostToolUse` | Tool name | After tool succeeds |
| `PostToolUseFailure` | Tool name | After tool fails |
| `Stop` | (none) | Subagent finishes (converted to `SubagentStop` at runtime) |

### In settings.json (All Events)
| Event | Matcher | When |
|-------|---------|------|
| `Setup` | (none) | `--init-only` / `-p --init|--maintenance` startup |
| `SessionStart` | `startup`, `resume`, `clear`, `compact` | Session begins or resumes |
| `InstructionsLoaded` | (none) | CLAUDE.md / `.claude/rules/` loaded — useful for debugging which files load |
| `UserPromptSubmit` | (none) | User submits prompt, before Claude processes |
| `UserPromptExpansion` | (none) | Slash-command expansion completes |
| `PreToolUse` | Tool name | Before tool executes |
| `PermissionRequest` | (none) | Permission dialog appears (not in `-p` mode) |
| `PermissionDenied` | (none) | After deny — supports `retry: true` |
| `PostToolUse` | Tool name | After tool succeeds (now includes `duration_ms`) |
| `PostToolUseFailure` | Tool name | After tool fails (includes `duration_ms`) |
| `PostToolBatch` | (none) | After a parallel tool batch completes |
| `Notification` | (none) | Claude Code sends notification |
| `SubagentStart` | Agent name | Subagent begins |
| `SubagentStop` | (none) | Any subagent completes |
| `TeammateIdle` | (none) | Teammate goes idle after a turn |
| `TaskCreated` | (none) | Task created on shared task list |
| `TaskCompleted` | (none) | Task marked completed |
| `ConfigChange` | `user_settings`, `project_settings`, `skills` | Config/skills change during session |
| `CwdChanged`, `FileChanged` | (none) | Working dir / file system changes (`CLAUDE_ENV_FILE` for env persistence) |
| `WorktreeCreate`, `WorktreeRemove` | (none) | Replace default git worktree behavior |
| `Elicitation`, `ElicitationResult` | (none) | MCP user-input flow |
| `PreCompact`, `PostCompact` | (none) | Around context compaction |
| `Stop` | (none) | Claude finishes responding |
| `StopFailure` | `rate_limit`, `billing_error`, ... | API errors that stop a turn |
| `SessionEnd` | (none) | Session terminates |

### Hook Types (5 total)
| Type | Use For | Default Timeout |
|------|---------|-----------------|
| `command` | Shell script validation (exit 2 to block) | 600s |
| `prompt` | LLM yes/no decision (fast model, single-turn) | 30s |
| `agent` | Multi-turn validation with tool access | 60s |
| `http` | POST hook input as JSON to a URL (use `allowedEnvVars` for secrets) | 30s |
| `mcp_tool` | Direct MCP tool invocation (v2.1.118+) | per-tool |

**Skill-only hook modifiers** (not available in subagent frontmatter): `once: true` (fire only once per session) and `if: "<permission-rule>"` (v2.1.85+, evaluate only if the matched call would be governed by that rule).

### Hook Input (stdin JSON)
```json
{
  "session_id": "abc123",
  "transcript_path": "...",
  "cwd": "...",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "tool_use_id": "toolu_...",
  "stop_hook_active": false
}
```
Subagent hooks add `agent_id` and `agent_type`.

### Hook Exit Codes
| Code | Behavior |
|------|----------|
| 0 | Continue normally (stdout added to context for some events) |
| 1 | Error (shows message, action proceeds) |
| 2 | Block the operation (stderr fed back to Claude as feedback) |

### Structured JSON Output (exit 0 + JSON to stdout)
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Command is safe",
    "additionalContext": "<≤10k chars of extra context to inject>",
    "updatedInput": { "command": "npm test --silent" },
    "updatedToolOutput": "<replacement output for PostToolUse>"
  }
}
```
- `permissionDecision`: `"allow"`, `"deny"`, `"ask"`, or `"defer"` (`-p` mode only — exits with the call preserved for SDK resume). `allow` does NOT bypass deny rules.
- `updatedInput` rewrites tool args (last-write-wins; avoid duplicates).
- `updatedToolOutput` (PostToolUse) now works for **all** tools (was MCP-only).
- `disableAllHooks: true` in settings is the global kill switch.

**Prevent Stop hook loops:** Check `stop_hook_active` in input — if true, exit 0 immediately.

## Foreground vs Background

**Foreground** (default):
- Blocks main conversation
- Permission prompts pass through
- Can ask clarifying questions
- MCP tools available

**Background**:
- Runs concurrently
- Permissions pre-approved at launch, auto-denies anything not pre-approved
- Cannot ask questions (tool call fails but subagent continues)
- MCP works only if pre-approved at spawn

Trigger background: ask "run in background" or press **Ctrl+B**

Disable background: `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`

**Fork mode** (`CLAUDE_CODE_FORK_SUBAGENT=1`, `/fork`, v2.1.117+, experimental): forks the *current* Claude session into a subagent that inherits the full conversation context and shares the prompt cache — different from a fresh subagent which starts empty. Useful for "go investigate this without polluting my context."

## Resume Subagents

Subagents can be resumed to continue previous work with full context:
```
Continue that code review and analyze authorization
```

Transcripts: `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`

Transcripts persist independently of main conversation compaction and survive session restarts. Cleaned up based on `cleanupPeriodDays` setting (default: 30 days).

## Preload Skills into Subagents

The `skills` field **injects full skill content** into the subagent's context at startup (not just made available for invocation). Subagents don't inherit skills from the parent conversation.

```yaml
skills:
  - api-conventions
  - error-handling-patterns
```

This is the inverse of `context: fork` in a skill. With `skills` in a subagent, the subagent controls the system prompt and loads skill content. With `context: fork` in a skill, the skill content becomes the task for the agent.

## Auto-Compaction

Subagents auto-compact at ~95% capacity (same as main conversation).

To trigger earlier: `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` (percentage)

## Complete Example

```yaml
---
name: security-auditor
description: Security audit specialist. Use proactively after modifying auth code.
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit
model: sonnet
permissionMode: dontAsk
memory: user
isolation: worktree
skills:
  - security-patterns
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-safe-commands.sh"
  Stop:
    - hooks:
        - type: command
          command: "./scripts/cleanup.sh"
---

You are a security auditor. When invoked:
1. Run git diff to see recent changes
2. Focus on authentication and authorization code
3. Check for OWASP Top 10 vulnerabilities
4. Report findings by severity: Critical, High, Medium, Low

Never modify files. Only analyze and report.
```

## Disable Subagents

In settings.json:
```json
{
  "permissions": {
    "deny": ["Agent(Explore)", "Agent(my-custom-agent)"]
  }
}
```

Or via CLI:
```bash
claude --disallowedTools "Agent(Explore)"
```

(`Task` is the legacy name; both forms still parse, but `Agent` is canonical post-v2.1.63.)
