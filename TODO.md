# TODO

## item #1 [bug] [high]
`commit-bot` uses `git add -A` which contradicts CLAUDE.md guidance. CLAUDE.md says "prefer adding specific files by name rather than using 'git add -A' or 'git add .'", which can accidentally include sensitive files (.env, credentials) or large binaries. The agent should analyze changes and stage specific files. File: `.claude/agents/commit-bot.md:20`

## item #2 [improvement] [medium]
`pr-creator` uses model `haiku` but performs complex analysis (analyzing all branch commits, generating comprehensive PR descriptions with summaries). Change to `sonnet` for better quality output. File: `.claude/agents/pr-creator.md:5`

## item #3 [improvement] [medium]
Too many custom subagents (5) exceeds the recommended 3-4 limit from tools-improve guidance. Merge `builder` and `test-runner` into a single "verifier" agent that runs tests then builds sequentially. Accept the trade-off of sequential execution (vs parallel when spawning 2 agents) for simpler agent selection. Files: `.claude/agents/test-runner.md`, `.claude/agents/builder.md`

## item #4 [improvement] [low]
The merged "verifier" agent (from item #3) should include trigger phrases for better auto-discovery. Add patterns like "Use when user says 'run tests', 'check tests', 'verify build', 'check warnings'". File: `.claude/agents/verifier.md` (after merge)

## item #5 [improvement] [low]
`investigate` skill does not have MCP tools in its `allowed-tools` list, but its documentation references using MCPs (Railway, Drive, Gemini). Add MCP tools to allowed-tools or document that MCPs are accessed through the main context. File: `.claude/skills/investigate/SKILL.md:5`

## item #6 [improvement] [low]
`plan-review-implementation` does not have context management like `plan-implement`. Add the same context estimation and continuation logic (60% threshold, heuristics for file reads/edits/agents, graceful stop with user instruction to re-run). File: `.claude/skills/plan-review-implementation/SKILL.md`

## item #7 [convention] [low]
`investigate` and `plan-fix` skills have overlapping evidence gathering but different outputs. Make differentiation explicit in descriptions: `investigate` = read-only reporting, `plan-fix` = investigation + actionable plan. Also add skill chaining: `investigate` should offer to invoke `plan-fix` when bugs are found, enabling workflow: investigate → plan-fix → plan-implement. Files: `.claude/skills/investigate/SKILL.md`, `.claude/skills/plan-fix/SKILL.md`