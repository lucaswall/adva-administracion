# Implementation Plan

**Created:** 2026-02-01
**Source:** Linear integration for project workflow management

## Context Gathered

### Current Workflow Analysis

**File-based workflow (to be replaced):**
- `TODO.md` - Backlog items with `## item #N [tag] [priority]` format
- `PLANS.md` - Implementation plans with tasks, iterations, and status

**Skills that interact with TODO.md/PLANS.md:**
| Skill | Current Behavior | Linear Integration |
|-------|------------------|-------------------|
| `code-audit` | Writes findings to TODO.md | Creates Linear issues in **Backlog** |
| *(manual)* | User edits TODO.md directly | User creates issues in **Backlog** via Linear UI |
| `plan-todo` | Reads TODO.md, writes PLANS.md, removes items | Reads Linear **Backlog**, writes PLANS.md with links, moves to **Todo** |
| `plan-inline` | Writes PLANS.md directly | Writes PLANS.md, creates issues in **Todo** |
| `plan-fix` | Writes PLANS.md directly | Writes PLANS.md, creates issues in **Todo** |
| `plan-implement` | Adds iterations to PLANS.md | + Real-time per task: **Todo** → **In Progress** (start) → **Review** (complete) |
| `plan-review-implementation` | Adds review findings, marks COMPLETE | + Moves **Review** → **Done**; creates new **Todo** issues for bugs found |
| `investigate` | References TODO.md in chaining | Update to reference Linear instead |

### Linear Team Configuration

**Team:** ADVA Administracion

**Workflow States:**
| State | Type | Usage |
|-------|------|-------|
| Backlog | backlog | New issues from code-audit, manual creation |
| Todo | unstarted | Issues ready for implementation (moved by plan-todo/inline/fix) |
| In Progress | started | Being implemented (moved by plan-implement at task start) |
| Review | started | Implementation complete, awaiting review (moved by plan-implement at task end) |
| Done | completed | Reviewed and approved (moved by plan-review-implementation) |
| Canceled | canceled | Abandoned issues |
| Duplicate | canceled | Duplicate of another issue |

**State Flow:** Backlog → Todo → In Progress → Review → Done

**Bug Loop:** When plan-review-implementation finds bugs, it creates NEW issues in Todo. These new issues go through the full cycle (Todo → In Progress → Review → Done) when the Fix Plan is implemented.

**State Transition Triggers:**
| Transition | Triggered By | When |
|------------|--------------|------|
| → Todo | plan-todo, plan-inline, plan-fix, plan-review (bugs) | Task enters PLANS.md |
| Todo → In Progress | plan-implement | Task work **starts** (real-time) |
| In Progress → Review | plan-implement | Task work **completes** (real-time) |
| Review → Done | plan-review-implementation | Task passes review |

**Labels:**
| Label | Color | Maps to code-audit tags |
|-------|-------|------------------------|
| Security | Red | `[security]`, `[dependency]` |
| Bug | Pink | `[bug]`, `[async]`, `[shutdown]`, `[edge-case]`, `[type]` |
| Performance | Green | `[memory-leak]`, `[resource-leak]`, `[timeout]`, `[rate-limit]` |
| Convention | Gray | `[convention]` |
| Technical Debt | Orange | `[dead-code]`, `[duplicate]`, `[test]`, `[practice]`, `[docs]`, `[chore]` |
| Feature | Purple | `[feature]` |
| Improvement | Blue | `[improvement]`, `[enhancement]`, `[refactor]` |

**Priority Mapping:**
| TODO.md Priority | Linear Priority |
|------------------|-----------------|
| `[critical]` | 1 (Urgent) |
| `[high]` | 2 (High) |
| `[medium]` | 3 (Medium) |
| `[low]` | 4 (Low) |

### Skills Architecture Understanding

**Skills are markdown instruction files, not TypeScript modules:**
- Skills live in `.claude/skills/<name>/SKILL.md`
- They contain frontmatter (`allowed-tools`, `description`, etc.) + instructions
- MCP tools are used directly via frontmatter permissions
- No TypeScript code or unit tests for skills

**To add Linear MCP to a skill:**
1. Add `mcp__linear__*` to `allowed-tools` in frontmatter
2. Update instructions to use Linear MCP tools (list_issues, create_issue, update_issue)

### PLANS.md Format with Linear Links

Each task will include a Linear issue link:

```markdown
### Task 1: Add parseResumenBroker function
**Linear Issue:** [ADVA-123](https://linear.app/...)

1. Write test in src/gemini/parser.test.ts
2. Run verifier (expect fail)
3. Implement in src/gemini/parser.ts
4. Run verifier (expect pass)
```

---

## Original Plan

### Task 1: Update CLAUDE.md with Linear integration documentation

1. Edit `CLAUDE.md`:
   - Add Linear MCP to "MCP SERVERS" section with allowed operations:
     - `list_issues`, `get_issue`, `create_issue`, `update_issue`
     - `list_issue_labels`, `list_issue_statuses`
   - Remove TODO.md references from skill workflow section
   - Add "LINEAR INTEGRATION" section documenting:
     - State flow: Backlog → Todo → In Progress → Review → Done
     - Label mapping table (code-audit tags → Linear labels)
     - Priority mapping table
     - Which skills trigger which state transitions
     - PLANS.md format with Linear issue links
     - Manual issue creation in Backlog (equivalent to TODO.md editing)

2. Verify: Read updated CLAUDE.md

### Task 2: Update code-audit skill to create Linear issues

1. Edit `.claude/skills/code-audit/SKILL.md`:
   - Add `mcp__linear__*` to `allowed-tools` frontmatter
   - Update description: "Creates Linear issues in Backlog" instead of "writes TODO.md"
   - Update "Pre-flight" section:
     - Query existing Backlog issues using `mcp__linear__list_issues` with `state=Backlog, team=ADVA Administracion`
     - Remove TODO.md parsing
   - Update "Step 6: Merge, Deduplicate, and Reprioritize":
     - Merge new findings with existing Backlog issues (match by title similarity)
   - Update "Step 7: Write TODO.md" → "Step 7: Create Linear Issues":
     - Use `mcp__linear__create_issue` for each new finding
     - Set `team` to "ADVA Administracion"
     - Set `state` to "Backlog"
     - Map priority: critical→1, high→2, medium→3, low→4
     - Map tags to labels:
       - `[security]`, `[dependency]` → Security
       - `[bug]`, `[async]`, `[shutdown]`, `[edge-case]`, `[type]` → Bug
       - `[memory-leak]`, `[resource-leak]`, `[timeout]`, `[rate-limit]` → Performance
       - `[convention]` → Convention
       - `[dead-code]`, `[duplicate]`, `[test]`, `[practice]` → Technical Debt
       - `[feature]` → Feature
       - `[improvement]`, `[enhancement]`, `[refactor]` → Improvement
   - Update "Termination" message to reference Linear and show issue count

2. Update `.claude/skills/code-audit/references/category-tags.md`:
   - Add "Linear Label Mapping" section with the tag-to-label mapping

3. Verify: Read updated skill files

### Task 3: Update plan-todo skill to read from Linear Backlog

1. Edit `.claude/skills/plan-todo/SKILL.md`:
   - Add `mcp__linear__*` to `allowed-tools` frontmatter
   - Update description: "Convert Linear Backlog issues into TDD plans"
   - Remove all TODO.md references throughout
   - Update "Arguments" section:
     - Selectors now reference Linear issues: `ADVA-123`, `all bugs`, `all security`, `backlog items`
     - Can filter by label: "all Bug issues", "all Security issues"
   - Update "Workflow":
     - Step 2: Query Linear Backlog using `mcp__linear__list_issues` with `state=Backlog, team=ADVA Administracion`
     - Step 7: Write PLANS.md with Linear issue links in each task header
     - Step 8: Move selected issues to "Todo" state using `mcp__linear__update_issue`
   - Update "PLANS.md Structure":
     - Add `**Linear Issues:** [ADVA-123](url), [ADVA-124](url)` to header
     - Add `**Linear Issue:** [ADVA-123](url)` to each task
   - Remove "TODO.md Reformatting" section entirely
   - Update "Termination" message

2. Verify: Read updated skill file

### Task 4: Update plan-inline skill to create Linear issues

1. Edit `.claude/skills/plan-inline/SKILL.md`:
   - Add `mcp__linear__*` to `allowed-tools` frontmatter
   - Update description to mention Linear issue creation
   - Add "Linear Issue Creation" section after "Generate plan":
     ```markdown
     ## Linear Issue Creation

     After writing PLANS.md, create a Linear issue for each task:
     1. Use `mcp__linear__create_issue` with:
        - `team`: "ADVA Administracion"
        - `title`: Task name
        - `description`: Task details from PLANS.md
        - `state`: "Todo"
        - `labels`: Infer from task type (Feature, Improvement, Bug)
     2. Update PLANS.md to add `**Linear Issue:** [ADVA-N](url)` to each task
     ```
   - Update "PLANS.md Structure":
     - Add `**Linear Issues:** [ADVA-123](url), [ADVA-124](url)` to header
     - Add `**Linear Issue:** [ADVA-123](url)` to each task
   - Update "Termination" message to include Linear issue links

2. Verify: Read updated skill file

### Task 5: Update plan-fix skill to create Linear issues

1. Edit `.claude/skills/plan-fix/SKILL.md`:
   - Add `mcp__linear__*` to `allowed-tools` frontmatter
   - Update description to mention Linear issue creation
   - Add "Linear Issue Creation" section after documenting findings:
     ```markdown
     ## Linear Issue Creation

     After writing the fix plan to PLANS.md, create a Linear issue for each fix:
     1. Use `mcp__linear__create_issue` with:
        - `team`: "ADVA Administracion"
        - `title`: Fix description
        - `description`: Root cause and fix details
        - `state`: "Todo"
        - `labels`: Bug (or Security if security-related)
     2. Update PLANS.md to add `**Linear Issue:** [ADVA-N](url)` to each fix task
     ```
   - Update "PLANS.md Structure" in "Document Findings":
     - Add `**Linear Issues:** [ADVA-123](url)` to header
     - Add `**Linear Issue:** [ADVA-123](url)` to each fix task
   - Update "Termination" message

2. Verify: Read updated skill file

### Task 6: Update plan-implement skill for Linear state transitions

1. Edit `.claude/skills/plan-implement/SKILL.md`:
   - Add `mcp__linear__*` to `allowed-tools` frontmatter
   - Add "Linear State Management" section after "Identify What to Execute":
     ```markdown
     ## Linear State Management

     State transitions happen **in real-time, task by task** (not batched at the end).

     **When STARTING a task:**
     1. Extract Linear issue ID from task's `**Linear Issue:** [ADVA-N](url)` line
     2. IMMEDIATELY move issue to "In Progress" using `mcp__linear__update_issue`
     3. Then begin the TDD cycle

     **When COMPLETING a task:**
     1. After verifier passes, IMMEDIATELY move issue to "Review" using `mcp__linear__update_issue`
     2. Then proceed to the next task

     If task has no Linear issue link, skip state updates (legacy plan).
     ```
   - Update "Execution Workflow" - integrate state transitions into the TDD cycle:
     ```markdown
     For each task:
     1. Move Linear issue: Todo → In Progress
     2. Write test
     3. Run verifier (expect fail)
     4. Implement
     5. Run verifier (expect pass)
     6. Move Linear issue: In Progress → Review
     7. Proceed to next task
     ```
   - Update "Document Results" section:
     - Include Linear state changes in iteration summary:
       ```markdown
       ### Linear Updates
       - ADVA-123: Todo → In Progress → Review
       - ADVA-124: Todo → In Progress → Review
       ```

2. Verify: Read updated skill file

### Task 7: Update plan-review-implementation skill for Linear state transitions

1. Edit `.claude/skills/plan-review-implementation/SKILL.md`:
   - Add `mcp__linear__*` to `allowed-tools` frontmatter
   - Add "Linear State Management" section after "Pre-flight Check":
     ```markdown
     ## Linear State Management

     This skill moves issues from **Review → Done** (the final transition).

     **If task passes review (no issues):**
     - Move issue from "Review" to "Done" using `mcp__linear__update_issue`

     **If task needs fixes (issues found):**
     - Move original issue from "Review" to "Done" (the original task was completed)
     - Create NEW Linear issue(s) in "Todo" for each bug/fix using `mcp__linear__create_issue`:
       - `team`: "ADVA Administracion"
       - `state`: "Todo" (will enter PLANS.md via Fix Plan)
       - `labels`: Bug
     - Add new issue links to the Fix Plan section in PLANS.md
     - These new issues will go through the full cycle when plan-implement runs the Fix Plan
     ```
   - Update "Document Findings" sections to include Linear updates
   - Update "After ALL Iterations Reviewed":
     - When marking COMPLETE, all issues should be in Done state

2. Verify: Read updated skill file

### Task 8: Update investigate skill to reference Linear

1. Edit `.claude/skills/investigate/SKILL.md`:
   - Update "Termination" section:
     - Change references from TODO.md to Linear
     - Update chaining message:
       ```markdown
       Would you like me to create a fix plan? Say 'yes' or run `/plan-fix` with the context above.
       (Fix plans will create Linear issues in Todo state)
       ```
   - No need for Linear MCP access (investigate is read-only)

2. Verify: Read updated skill file

### Task 9: Delete TODO.md and update references

1. Delete `TODO.md` file (if it exists)
2. Search for remaining TODO.md references using Grep in `.claude/` directory
3. Update any remaining references found
4. Verify: Confirm no TODO.md references remain

### Task 10: Add Linear authentication documentation

1. Edit `DEVELOPMENT.md` to add "Linear Integration" section:
   ```markdown
   ## Linear Integration

   This project uses Linear for issue tracking via MCP (Model Context Protocol).

   ### Authentication

   1. Run `/mcp` in Claude Code to authenticate with Linear
   2. Follow the OAuth flow in your browser
   3. Authentication tokens are stored in `~/.mcp-auth`

   ### Workflow

   - **Create issues:** Use Linear UI or `code-audit` skill
   - **Plan work:** Use `plan-todo` to convert Backlog issues to plans
   - **Track progress:** Issues move through states automatically:
     - Backlog → Todo → In Progress → Review → Done

   ### Required Linear Setup

   Team "ADVA Administracion" must have:
   - **States:** Backlog, Todo, In Progress, Review, Done
   - **Labels:** Security, Bug, Performance, Convention, Technical Debt, Feature, Improvement
   ```

2. Verify: Read the documentation file

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Replace file-based TODO.md workflow with Linear issue tracking, keeping PLANS.md as the implementation detail record while synchronizing issue states with Linear.

**Source:** Direct feature request for Linear integration

**Approach:** Update all skills that interact with TODO.md/PLANS.md to use Linear MCP for issue management. Each task in PLANS.md maps 1:1 to a Linear issue. Skills trigger state transitions as work progresses through the pipeline.

**Scope:**
- Tasks: 10
- Files affected: 11 (7 skills + 1 reference file, CLAUDE.md, DEVELOPMENT.md, TODO.md deletion)
- New tests: No (skills are markdown instructions, not code)

**Key Decisions:**
- PLANS.md remains the source of implementation details (Linear issues link to it, not replace it)
- 1:1 mapping between PLANS.md tasks and Linear issues
- All tasks start in **Todo** when they enter PLANS.md
- State transitions happen **real-time, task by task** in plan-implement:
  - Todo → In Progress (when task work starts)
  - In Progress → Review (when task work completes)
- plan-review-implementation moves Review → Done (for all tasks, even those with bugs found)
- Bugs found during review create NEW issues in Todo (they go through the full cycle)
- Label mapping from code-audit tags to Linear labels documented in skills
- Priority mapping: critical→1(Urgent), high→2, medium→3, low→4

**Dependencies/Prerequisites:**
- Linear MCP already configured in `.mcp.json` ✓
- Linear team "ADVA Administracion" with all states ✓
- Linear labels configured ✓
- Task 1 (CLAUDE.md) documents integration for all other tasks
- Tasks 2-8 can be done in any order after Task 1
- Task 9 (cleanup) should be last after skills are updated

**Risks/Considerations:**
- Rate limiting considerations for bulk issue creation in code-audit
- Manual issue creation in Linear Backlog is fully supported (equivalent to TODO.md editing)
- Legacy plans without Linear links will still work (state updates skipped)

---

## Iteration 1

**Implemented:** 2026-02-01

### Completed
- Task 1: Updated CLAUDE.md with Linear MCP section and LINEAR INTEGRATION documentation including state flow, label mapping, priority mapping, and PLANS.md format with Linear links
- Task 2: Updated code-audit skill to create Linear issues in Backlog instead of writing TODO.md, with label and priority mappings
- Task 3: Updated plan-todo skill to read from Linear Backlog instead of TODO.md, moves planned issues to Todo state
- Task 4: Updated plan-inline skill to create Linear issues in Todo state when creating plans
- Task 5: Updated plan-fix skill to create Linear issues in Todo state when creating fix plans
- Task 6: Updated plan-implement skill with real-time Linear state transitions (Todo→In Progress at task start, In Progress→Review at task end)
- Task 7: Updated plan-review-implementation skill to move Review→Done on pass, create new bug issues in Todo when fixes needed
- Task 8: Updated investigate skill termination message to reference Linear instead of TODO.md
- Task 9: Deleted TODO.md and removed all remaining TODO.md references from skill files
- Task 10: Added Linear Integration section to DEVELOPMENT.md with authentication, workflow, and required setup documentation

### Files Modified
- `CLAUDE.md` - Added Linear MCP to MCP SERVERS section, added LINEAR INTEGRATION section
- `.claude/skills/code-audit/SKILL.md` - Replaced TODO.md with Linear Backlog integration
- `.claude/skills/code-audit/references/category-tags.md` - Added Linear Label Mapping section
- `.claude/skills/plan-todo/SKILL.md` - Replaced TODO.md with Linear Backlog, added state management
- `.claude/skills/plan-inline/SKILL.md` - Added Linear issue creation in Todo state
- `.claude/skills/plan-fix/SKILL.md` - Added Linear issue creation in Todo state
- `.claude/skills/plan-implement/SKILL.md` - Added real-time Linear state transitions
- `.claude/skills/plan-review-implementation/SKILL.md` - Added Review→Done transitions and bug issue creation
- `.claude/skills/investigate/SKILL.md` - Updated termination message to reference Linear
- `DEVELOPMENT.md` - Added Linear Integration section

### Pre-commit Verification
- bug-hunter: Found 3 medium issues, fixed before proceeding (Technical Debt mapping consistency, unnecessary create permission in plan-todo)
- verifier: All 1365 tests pass, zero warnings

### Review Findings

Files reviewed: 10
Checks applied: Consistency, Completeness, Correctness of Instructions, Convention Compliance

**Files Reviewed:**
1. `CLAUDE.md` - Linear MCP section, LINEAR INTEGRATION section
2. `.claude/skills/code-audit/SKILL.md` - Linear Backlog integration
3. `.claude/skills/code-audit/references/category-tags.md` - Linear Label Mapping section
4. `.claude/skills/plan-todo/SKILL.md` - Linear Backlog to Todo workflow
5. `.claude/skills/plan-inline/SKILL.md` - Linear issue creation in Todo
6. `.claude/skills/plan-fix/SKILL.md` - Linear issue creation in Todo
7. `.claude/skills/plan-implement/SKILL.md` - Linear state transitions
8. `.claude/skills/plan-review-implementation/SKILL.md` - Linear Review→Done transitions
9. `.claude/skills/investigate/SKILL.md` - Linear termination message
10. `DEVELOPMENT.md` - Linear Integration section

**Verification Results:**
- State flow documentation is consistent across CLAUDE.md and all skills
- Label and priority mappings match in CLAUDE.md, code-audit skill, and category-tags.md
- TODO.md properly deleted with no lingering references
- All skills have correct `mcp__linear__*` tools in allowed-tools frontmatter
- Instructions are clear, specific, and implementable

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- N/A (plan created before Linear integration - no Linear issues to transition)

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. Ready for human review.
