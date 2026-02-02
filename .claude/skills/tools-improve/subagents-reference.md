# Subagents Quick Reference

## Built-in Subagents

| Agent | Model | Tools | Use For |
|-------|-------|-------|---------|
| **Explore** | Haiku | Read-only | Fast codebase exploration, file discovery |
| **Plan** | Inherit | Read-only | Research during plan mode |
| **general-purpose** | Inherit | All | Complex multi-step tasks |
| **Bash** | Inherit | Bash | Terminal commands in isolation |

## Key Constraints

**Max 3-4 custom subagents** - Too many reduces productivity and confuses delegation.

**Subagents cannot spawn other subagents.** If your workflow requires nested delegation, use skills or chain subagents from the main conversation.

## Permission Modes

| Mode | Behavior | Use When |
|------|----------|----------|
| `default` | Standard prompts | General purpose |
| `acceptEdits` | Auto-accept Write/Edit | Trusted code writers |
| `dontAsk` | Auto-deny prompts (allowed tools still work) | **Read-only agents** |
| `bypassPermissions` | Skip ALL checks (dangerous) | Rarely - high trust only |
| `plan` | Read-only exploration | Planning/research |

**Tip:** Use `dontAsk` for read-only agents (reviewers, explorers, auditors). It auto-denies write operations while allowing the tools in the `tools` list.

## Hook Events

| Event | Matcher | When |
|-------|---------|------|
| `PreToolUse` | Tool name | Before tool executes |
| `PostToolUse` | Tool name | After tool executes |
| `Stop` | (none) | Subagent finishes |
| `SubagentStart` | Agent name | Subagent begins (settings.json only) |
| `SubagentStop` | (none) | Any subagent completes (settings.json only) |

### Hook Input (stdin JSON)
```json
{
  "session_id": "abc123",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" }
}
```

### Hook Exit Codes
| Code | Behavior |
|------|----------|
| 0 | Continue normally |
| 1 | Error (shows message) |
| 2 | Block the operation |

## Foreground vs Background

**Foreground** (default):
- Blocks main conversation
- Permission prompts pass through
- Can ask clarifying questions

**Background**:
- Runs concurrently
- Permissions pre-approved at launch
- Cannot ask questions (tool call fails)
- No MCP tools

Trigger background: ask "run in background" or press **Ctrl+B**

## Resume Subagents

Subagents can be resumed to continue previous work:
```
Continue that code review and analyze authorization
```

Transcripts: `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`

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
    "deny": ["Task(Explore)", "Task(my-custom-agent)"]
  }
}
```

Or via CLI:
```bash
claude --disallowedTools "Task(Explore)"
```
