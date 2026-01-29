---
name: investigate
description: Investigates issues and reports findings without creating plans. Use when user says "investigate", "check why", "look into", "diagnose", or wants to understand a problem before deciding on action. Accesses Railway logs, Drive files, Gemini prompts, and codebase.
argument-hint: <what to investigate>
allowed-tools: Read, Glob, Grep, Task, Bash
disable-model-invocation: true
---

Investigate issues and report findings. Does NOT create plans or modify code.

## Purpose

- Investigate reported issues (extraction errors, wrong data, missing matches, file sorting)
- Debug deployment or runtime issues using available logs
- Test and compare Gemini prompts when extraction problems are suspected
- Examine processed files and their destinations
- Analyze codebase to understand behavior
- **Report findings only** - user decides next steps

## Arguments

$ARGUMENTS should describe what to investigate:
- What happened vs what was expected
- File IDs or names if relevant
- Error messages or unexpected values
- Deployment ID if it's a deployment issue
- Any context that helps narrow the scope

## Context Gathering

**IMPORTANT: Do NOT hardcode MCP names or folder paths.** Always read CLAUDE.md to discover:

1. **Available MCP servers** - Look for "MCP SERVERS" section to find:
   - File/storage MCPs for accessing documents and data
   - Deployment MCPs for logs and service status
   - AI/LLM MCPs for prompt testing

2. **Project structure** - Look for "STRUCTURE" or "FOLDER STRUCTURE" sections to understand:
   - Where source code and documents are stored
   - Naming conventions and organization

3. **Domain concepts** - Look for sections describing:
   - Document types and their processing
   - Data schemas and formats
   - Business rules and validation

## Investigation Workflow

### Step 1: Classify the Investigation Type

Based on $ARGUMENTS, determine what you're investigating:

| Category | Indicators | Primary Tools |
|----------|-----------|---------------|
| **Extraction** | Wrong data extracted, missing fields, null values | Drive MCP, Gemini MCP, Codebase |
| **Deployment** | Service down, build failures, runtime errors | Railway/Deployment MCP |
| **File Sorting** | Files in wrong folder, unexpected destination | Drive MCP, Codebase |
| **Matching** | Wrong matches, missing matches, unexpected links | Drive MCP, Codebase |
| **Prompt** | Consistent extraction errors on specific doc types | Gemini MCP, current prompts |
| **Performance** | Slow processing, timeouts, resource issues | Deployment logs, Codebase |
| **General** | Unknown cause, need exploration | All available tools |

### Step 2: Gather Evidence

**For Codebase Analysis:**
- Use Grep/Glob for specific searches
- Use Task tool with `subagent_type=Explore` for broader exploration
- Read relevant source files, configs, and tests

**For Deployment Issues (if deployment MCPs available):**
1. Check MCP/CLI status
2. List services to find affected service
3. List recent deployments with statuses
4. Get deployment and build logs
5. Search logs for errors using filters (e.g., `@level:error`)

**For Document/File Issues (if file MCPs available):**
- Search for the problematic file
- Read file contents or metadata
- Check related data stores (spreadsheets, databases)
- Trace the file's processing path

**For Prompt/AI Issues (if AI MCPs available):**
1. Get the source document that has issues
2. Read current prompts from the project's prompts file
3. Test the current prompt against the document
4. Try variations to understand why extraction fails
5. Compare outputs between different prompt versions

### Step 3: Form Conclusions

After gathering evidence, determine:

1. **Root Cause Identified** - You found what's causing the issue
2. **Root Cause Suspected** - Strong hypothesis but not 100% certain
3. **Multiple Possibilities** - Several potential causes, need more info
4. **Nothing Wrong Found** - Investigation shows system working correctly
5. **Cannot Determine** - Insufficient information to conclude

## Investigation Report Format

Write findings to the conversation (NOT to a file):

```
## Investigation Report

**Subject:** [What was investigated]
**Conclusion:** [Root Cause Identified | Suspected | Multiple Possibilities | Nothing Wrong | Cannot Determine]

### Context
- **MCPs used:** [list MCPs accessed]
- **Files examined:** [list key files checked]
- **Logs reviewed:** [deployment IDs, time ranges if applicable]

### Evidence
[What you found - be specific with data points, log excerpts, file contents]

### Findings

[Explain what you discovered. If root cause found, explain it clearly.
If nothing wrong, explain what was checked and why it appears correct.
If uncertain, list possibilities ranked by likelihood.]

### Recommendations (Optional)
[Only if you have specific suggestions - do NOT write a fix plan]
```

## Prompt Testing Guidelines

When investigating AI/LLM extraction issues:

1. **Get the problematic input** using file/document MCPs
2. **Read current prompt** from the project's prompts file
3. **Test with AI MCP** if available:
   - Run current prompt against the document
   - Try variations to isolate the issue
   - Compare outputs to understand failure mode
4. **Document findings** - What works, what doesn't, why

Example workflow:
```
1. Current prompt extracts field X as null
2. Examined document - field X exists with value "ABC"
3. Tested prompt variation A: Added explicit instruction
4. Result: Still null - issue is document format, not prompt
5. Finding: Document has unusual layout Gemini misinterprets
```

## Deployment Debugging Guidelines

When investigating deployment issues (if deployment MCPs available):

1. **Check status first** - Verify MCP/CLI access
2. **List recent deployments** - Get deployment IDs and statuses
3. **Get targeted logs** - Search for errors using filters
4. **Look for patterns** - Repeated errors, timing correlations
5. **Check configuration** - Environment variables, settings

## File Tracing Guidelines

When investigating file sorting or processing:

1. **Find the file** using file MCPs
2. **Check current location** - Where is it now?
3. **Trace processing** - Check logs for processing history
4. **Examine classification** - How was the file classified?
5. **Check destination logic** - What determined where it went?

## Error Handling

| Situation | Action |
|-----------|--------|
| $ARGUMENTS is vague | Ask for more specific details |
| CLAUDE.md doesn't exist | Continue with codebase-only investigation |
| MCP not available | Skip that MCP, note in report what couldn't be checked |
| File/resource not found | Document in report (may be relevant) |
| Cannot reproduce issue | Document steps taken, request more context |
| Logs unavailable | Note in report, suggest alternative approaches |

## Rules

- **Report only** - Do NOT modify source code or files
- **No plans** - Do NOT write PLANS.md or fix plans
- **Discover MCPs** - Read CLAUDE.md to find available tools
- **Be thorough** - Check multiple sources before concluding
- **Be specific** - Include exact values, line numbers, timestamps
- **Be honest** - If uncertain, say so; if nothing wrong, say so

## What NOT to Do

1. **Don't create PLANS.md** - This skill only reports
2. **Don't modify code** - Investigation is read-only
3. **Don't assume MCPs** - Discover from CLAUDE.md
4. **Don't conclude prematurely** - Gather sufficient evidence first
5. **Don't force findings** - "Nothing wrong" is a valid conclusion

## Termination

When you finish investigating, output the investigation report and this message:

```
---
Investigation complete.

To take action based on these findings:
- For bug fixes: Use `plan-fix` with this context
- For feature changes: Use `plan-inline` with specific request
- For further investigation: Provide more details and run investigate again
```

Do not ask follow-up questions. Do not offer to implement fixes. Report findings and stop.
