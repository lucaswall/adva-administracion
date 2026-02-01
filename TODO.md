# TODO

## item #1 [bug] [high]
`commit-bot` uses `git add -A` which contradicts CLAUDE.md guidance. CLAUDE.md says "prefer adding specific files by name rather than using 'git add -A' or 'git add .'", which can accidentally include sensitive files (.env, credentials) or large binaries. The agent should analyze changes and stage specific files. File: `.claude/agents/commit-bot.md:20`

## item #2 [improvement] [medium]
`pr-creator` uses model `haiku` but performs complex analysis (analyzing all branch commits, generating comprehensive PR descriptions with summaries). Consider upgrading to `sonnet` for better quality output. File: `.claude/agents/pr-creator.md:5`

## item #3 [improvement] [medium]
Too many custom subagents (5) exceeds the recommended 3-4 limit from tools-improve guidance. Consider merging `builder` and `test-runner` into a single "verifier" agent, or making one of them a skill instead. This affects productivity as Claude must evaluate more agent descriptions. Files: `.claude/agents/`

## item #4 [improvement] [low]
`test-runner` and `builder` descriptions are generic and don't include trigger phrases. Add "Use when..." patterns for better auto-discovery. Example: "Use proactively after writing tests or modifying code" is good, but could add "Use when user says 'run tests', 'check tests', 'verify tests'". Files: `.claude/agents/test-runner.md:3`, `.claude/agents/builder.md:3`

## item #5 [improvement] [low]
`investigate` skill does not have MCP tools in its `allowed-tools` list, but its documentation references using MCPs (Railway, Drive, Gemini). Add MCP tools to allowed-tools or document that MCPs are accessed through the main context. File: `.claude/skills/investigate/SKILL.md:5`

## item #6 [improvement] [low]
`plan-review-implementation` does not have context management like `plan-implement`. Consider adding context estimation and continuation logic so it can handle large codebases with many iterations without running out of context. File: `.claude/skills/plan-review-implementation/SKILL.md`

## item #7 [convention] [low]
`investigate` skill has significant overlap with `plan-fix` skill - both investigate issues and use similar evidence gathering workflows. Consider documenting clearer differentiation: `investigate` is read-only reporting, `plan-fix` creates actionable plans. The differentiation exists but could be more explicit in descriptions. Files: `.claude/skills/investigate/SKILL.md`, `.claude/skills/plan-fix/SKILL.md`

## item #8 [improvement] [low]
Agents use `permissionMode: default` which requires user approval for each action. Consider using `acceptEdits` for agents that only read/report (bug-hunter could use this) to reduce permission prompts. File: `.claude/agents/bug-hunter.md:6`
