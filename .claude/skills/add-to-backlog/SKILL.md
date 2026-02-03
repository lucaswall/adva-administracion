---
name: add-to-backlog
description: Add issues to Linear Backlog from free-form input. Use when user says "add to backlog", "create backlog issues", "track this", or describes tasks/improvements/bugs to add. Interprets user's ideas, investigation findings, or conversation context into well-structured Backlog issues. Can process multiple items at once.
argument-hint: [description of what to add, or "from conversation", or "from investigation"]
allowed-tools: Read, Glob, Grep, Task, mcp__linear__list_issues, mcp__linear__get_issue, mcp__linear__create_issue, mcp__linear__list_issue_labels, mcp__linear__list_issue_statuses
disable-model-invocation: true
---

Add issues to Linear Backlog from user input. Interprets free-form descriptions into well-structured issues.

## Purpose

- Convert user's free-form ideas into structured Backlog issues
- Parse multiple items from a single input
- Reference conversation context or investigation findings
- Write problem-focused descriptions (what, not how)
- Include implementation hints for `plan-todo` to use later

## Input Modes

The skill supports three input modes based on $ARGUMENTS:

### Mode 1: Direct Description
User provides task descriptions directly:
```
/add-to-backlog Add validation for CUIT numbers, also need to handle Naranja card type in resumen_tarjeta, and the date parsing fails for documents from 2020
```

### Mode 2: From Conversation
User references the current conversation:
```
/add-to-backlog from conversation - add the three issues we discussed
/add-to-backlog add all the improvements mentioned above
/add-to-backlog track the bug we just found
```

### Mode 3: From Investigation
User references findings from `investigate` skill:
```
/add-to-backlog from investigation findings
/add-to-backlog add the issues found by investigate
```

## Workflow

1. **Parse input** - Understand what to add based on $ARGUMENTS
2. **Identify items** - Separate multiple items from the input
3. **Check existing Backlog** - Avoid duplicates
4. **Draft issues** - Write problem-focused descriptions
5. **Confirm with user** - Show proposed issues before creating
6. **Create in Linear** - Add to Backlog state

## Issue Structure

Each issue should have:

### Title
- Clear, concise problem statement
- Action-oriented: "CUIT validation missing", "Naranja card type not supported"
- NO solution in title

### Description
Structure:
```
**Problem:**
[What is wrong or missing - 1-2 sentences]

**Context:**
[Where this occurs, affected files/areas - brief]

**Impact:**
[Why this matters - user impact, data quality, errors]

**Implementation Hints:** (optional)
[Suggestions for plan-todo, patterns to follow, related code]
```

### Labels
Map to Linear labels based on issue type:

| Issue Type | Linear Label |
|------------|--------------|
| Missing functionality | Feature |
| Broken behavior | Bug |
| Better approach exists | Improvement |
| Code quality issue | Technical Debt |
| Security concern | Security |
| Slow/resource issue | Performance |
| Style/format issue | Convention |

### Priority
Assess based on impact:

| Impact | Priority |
|--------|----------|
| Data loss, security hole, production down | 1 (Urgent) |
| Incorrect data, broken feature | 2 (High) |
| Inconvenience, missing enhancement | 3 (Medium) |
| Minor polish, nice-to-have | 4 (Low) |

## Parsing Input

### Direct Descriptions
Look for natural separators:
- "also", "and also", "additionally"
- Numbered lists: "1.", "2.", etc.
- Bullet points: "-", "*"
- Commas followed by action verbs
- Complete sentences as separate items

Example:
```
"Add CUIT validation, also handle Naranja cards, and fix the 2020 date bug"
```
→ Three issues:
1. CUIT validation missing
2. Naranja card type not supported in resumen_tarjeta
3. Date parsing fails for 2020 documents

### Conversation References
When user says "from conversation" or similar:
1. Review the conversation above
2. Identify discussed problems, improvements, or bugs
3. Extract actionable items

### Investigation References
When user mentions investigation findings:
1. Look for investigation output in conversation
2. Extract issues, errors, or recommendations found
3. Convert findings into actionable issues

## Duplicate Detection

Before creating, check existing Backlog:
1. Query `mcp__linear__list_issues` with `team=ADVA Administracion, state=Backlog`
2. Compare proposed issues against existing titles/descriptions
3. If similar issue exists:
   - Note as "Similar to ADVA-XXX"
   - Ask user if they want to create anyway or skip

## User Confirmation

Before creating issues, show the user what will be created:

```
I'll create the following Backlog issues:

1. **CUIT validation missing** (Feature, Medium)
   Missing validation for CUIT numbers using modulo 11 algorithm.
   Hint: See existing validation patterns in src/utils/validation.ts

2. **Naranja card type not supported** (Feature, Medium)
   resumen_tarjeta extraction doesn't handle Naranja card format.
   Hint: Add to TipoTarjeta enum and update parser.

3. **Date parsing fails for 2020 documents** (Bug, High)
   Documents with dates from 2020 fail to parse correctly.
   Hint: Check date format assumptions in src/utils/date.ts

Similar existing issues found:
- ADVA-45: "CUIT format validation" - might overlap with #1

Create these issues? (I'll skip duplicates unless you confirm)
```

Wait for user confirmation before proceeding.

## Creating Issues

Use `mcp__linear__create_issue` for each confirmed issue:

```
team: "ADVA Administracion"
state: "Backlog"
title: "[Issue title]"
description: "**Problem:**\n[description]\n\n**Context:**\n[context]\n\n**Impact:**\n[impact]\n\n**Implementation Hints:**\n[hints]"
priority: [1|2|3|4]
labels: [Mapped label]
```

## Writing Good Issues

### DO:
- Focus on the problem, not the solution
- Include context about where/when the issue occurs
- Explain impact to help prioritization
- Add implementation hints for plan-todo
- Reference related files or code if known

### DON'T:
- Include step-by-step implementation
- Write the solution in the description
- Use vague language ("improve this", "fix the thing")
- Create issues without clear problem statement

### Good Example:
```
**Problem:**
CUIT numbers are not validated before storage, allowing invalid identifiers.

**Context:**
Affects factura and pago extraction in src/gemini/parser.ts. Invalid CUITs propagate to spreadsheets.

**Impact:**
Incorrect matching between documents due to CUIT typos or extraction errors.

**Implementation Hints:**
- Use modulo 11 algorithm (standard for Argentine CUITs)
- See existing validateEmail pattern in src/utils/validation.ts
- Should return Result<boolean, ValidationError>
```

### Bad Example:
```
Add CUIT validation. Create a function that takes a CUIT string and validates it using modulo 11. Return true if valid, false otherwise. Add tests.
```

## Error Handling

| Situation | Action |
|-----------|--------|
| $ARGUMENTS empty | Ask user what to add |
| Can't parse items | Show interpretation, ask for clarification |
| Linear unavailable | Stop, tell user to check Linear auth |
| All items are duplicates | Report existing issues, ask if user wants to create anyway |
| Conversation reference unclear | List recent topics, ask which to add |

## Rules

- **Always confirm before creating** - Show proposed issues first
- **Problem-focused** - Describe what's wrong, not how to fix
- **Include hints** - Help plan-todo with implementation suggestions
- **Check duplicates** - Avoid cluttering backlog
- **One problem per issue** - Split combined issues

## Termination

After creating issues, output:

```
✓ Created X issues in Linear Backlog:

- ADVA-123: [Title] (Label, Priority)
- ADVA-124: [Title] (Label, Priority)
- ADVA-125: [Title] (Label, Priority)

Skipped:
- [Description] - duplicate of ADVA-45

Next steps:
- Review issues in Linear Backlog
- Use `plan-todo` to create implementation plans
- Use `plan-todo ADVA-123` to plan a specific issue
```

Do not ask follow-up questions. Do not offer to plan or implement.
