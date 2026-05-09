# Post-PR Codex Review Monitor — Per-Tick Logic

This is the per-tick workflow for the cron monitor created by
`plan-review-implementation` after a successful PR. The cron fires every
3 minutes; each firing runs **one** iteration of the steps below. Read this
file at the start of each tick — do not rely on memory between firings.

## Inputs (from the cron prompt)

The cron prompt includes:
- `PR_NUMBER` — the PR being monitored
- `BRANCH` — the head branch (used for sanity checks and merge cleanup)
- `MONITOR_TAG` — a unique substring (e.g., `"Codex monitor for PR <N>"`) so
  the tick can locate its own cron via `CronList` for self-deletion

## Per-Tick Steps

### Step 1 — Read state

Run all three in parallel (single message, 3 Bash calls):

```bash
# CI status
gh pr checks <PR_NUMBER>

# PR + reactions + reviews
gh pr view <PR_NUMBER> --json headRefOid,reactionGroups,reviews,statusCheckRollup

# Unresolved Codex review threads
gh api graphql -f query='query {
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: PR) {
      reviewThreads(first: 50) {
        nodes { id isResolved comments(first: 1) { nodes { databaseId path line body } } }
      }
    }
  }
}'
```

(Substitute owner/repo/PR. The first `gh pr view` call also returns the
HEAD oid which the next steps need.)

Capture:
- `HEAD_SHA` — the latest commit on the PR
- `CI_STATE` — `pass | pending | fail`
- `LATEST_REVIEW` — most recent Codex review (commit, body, submittedAt)
- `EYES` — whether `chatgpt-codex-connector` has 👀 reacted
- `THUMBS` — whether Codex has 👍 reacted on the PR
- `OPEN_THREADS` — list of unresolved review threads with body, path, line
- `HEAD_PUSH_TIME` — `git log -1 --format=%aI <HEAD_SHA>` (commit author/commit time)

### Step 2 — CI assessment

| `CI_STATE` | Action |
|---|---|
| `fail` | Fetch failing logs (`gh run view <run-id> --log-failed`). Diagnose, fix, commit, push. End tick. The next tick will re-check. |
| `pending` | End tick — wait for CI. |
| `pass` | Continue to step 3. |

If CI status is mixed or unclear (e.g., one check passing, one missing),
treat as `pending`. Never proceed to merge while any required check is
unresolved.

### Step 3 — Codex assessment (only when CI is green)

Evaluate in order — first match wins:

#### 3a. 👍 reaction present
**Action:** STOP — proceed to step 4 (merge phase). Codex has signalled
clean review.

#### 3b. New findings on HEAD (top-level review body OR open threads)
**Action:** Assess each finding for validity, then fix or resolve.

For **each** finding:
1. **Read the cited code** (`Read` tool with file path + lines).
2. **Verify the claim**:
   - Does the described code path actually exist?
   - Does the bug actually trigger under realistic conditions?
   - Is there project-specific context (CLAUDE.md, accepted patterns) that makes this a non-issue?
3. **Decide:**
   - **Valid** → fix with TDD where appropriate (test → implement → verify), commit, push, then resolve the thread via `gh api graphql ... resolveReviewThread`.
   - **Invalid** (false positive, misread, accepted-by-design, theoretical-not-realistic) → post a brief reply explaining the rejection via `gh api graphql ... addPullRequestReviewThreadReply`, **then** resolve the thread with `resolveReviewThread`. The rationale reply is **required**, not optional — step 3c relies on it to recognize "all addressed" as a merge signal, and silent dismissal hides the reasoning from future reviewers. Cite the specific reason and link CLAUDE.md or project memory when relevant.

Top-level review body findings (no thread) are addressed by pushing the fix —
they do not have a thread to resolve, but the next Codex review on the new
commit confirms resolution.

After all findings are handled, end tick. The push will trigger a new Codex
review; the next tick re-evaluates.

**Critical rule:** never accept a finding on face value. Codex hallucinates,
misreads regex semantics, and sometimes flags accepted patterns that the
project has explicitly opted into. The project memory and CLAUDE.md list
known-accepted patterns — consult them.

#### 3c. Latest review is on HEAD AND nothing remains to address
**Action:** STOP — proceed to step 4.

Conditions (all four required):
- Latest Codex review's `commit.oid` matches `HEAD_SHA` (Codex saw the current code).
- Review body contains only the standard `### 💡 Codex Review` / `Reviewed commit: <sha>` boilerplate (no `P0/P1/P2/P3` badges).
- Every PR review thread is resolved (`isResolved: true` for all nodes).
- **No 👀 (EYES) reaction is currently present from `chatgpt-codex-connector`** — an EYES reaction means Codex is mid-review (e.g. after a manual `@codex review` trigger) and may post fresh findings imminently. Wait it out via 3e.

This covers two end states:
- **Zero findings:** Codex reviewed HEAD and had nothing to flag. Codex would normally use 👍 here; treat the empty-body, no-threads review as equivalent.
- **All addressed:** Codex posted findings, and every thread is now resolved — either by a fix that landed in HEAD or by a documented rejection-as-invalid (per 3b's required rationale reply). Codex does not re-react 👍 once it has already submitted a review for a commit, so this is the only signal we get when every concern has been handled without a follow-up commit.

If a finding lives in the **top-level review body** (not a thread) and has not been addressed by a new commit, 3c does not apply — push a fix or wait for a new review on the next HEAD.

#### 3d. HEAD pushed > 15 min ago AND no review of HEAD
**Action:** STOP — proceed to step 4. Codex queue is drained or skipped this
commit.

Compute elapsed: `(now - HEAD_PUSH_TIME) > 15 minutes`. The 15-minute window
is generous — Codex normally responds within 5–10 min.

#### 3e. None of the above (eyes still on, or review pending)
**Action:** End tick. Wait for the next firing.

### Step 4 — Merge phase (when stopping)

Run all checks again before merging — state can change between ticks:

1. **Re-verify CI green:** `gh pr checks <N>` — must show `pass`.
2. **Re-verify all threads resolved:** GraphQL `reviewThreads` filtered to `isResolved: false` must return zero.
3. **If either check fails:** abort merge, end tick, do NOT delete the cron. Inform the user via final message and let the loop continue.
4. **If both pass:**
   ```bash
   gh pr merge <PR_NUMBER> --squash --delete-branch
   git checkout main
   git pull
   ```
   `gh pr merge --delete-branch` deletes both the local and remote branch
   automatically (it switches off the branch first if needed).
5. **Locate and delete the cron:**
   ```bash
   CronList                       # find the entry whose prompt contains MONITOR_TAG
   CronDelete id=<that-id>
   ```
6. **Inform the user** with the final outcome:
   - PR merged, branch deleted, on `main`
   - Summary of Codex iterations (count of pushes, count of findings fixed, count discarded)

## Failure Modes

| Situation | Action |
|---|---|
| `gh pr merge` rejects (e.g., not mergeable, conflict) | Do NOT delete cron. Inform user with the gh error and stop the tick. User can rebase or abort. |
| `git pull` after merge has conflicts | Stash/abort cleanly, inform user. The merge already succeeded; this is just local sync. |
| CronDelete fails (cron not found) | Inform user; instruct them to run `/cron list` and `/cron delete <id>` manually. |
| New commits pushed by another author mid-loop | Continue normally — the tick reads the latest HEAD. Codex re-reviews on next push. |
| Codex never reviews HEAD AND no eyes ever | Step 3d (15-min timeout) covers this. |
| All Codex findings rejected as invalid; no 👍 from Codex | Step 3c covers this. Each rejection MUST have a rationale reply on the thread before resolving (per 3b "Decide → Invalid"); without that reply 3c cannot recognize the addressed state and the loop will stall at 3e until the user intervenes or pushes a new commit. |
| Codex 👍 but CI later regresses | Step 4 re-verification catches this. Don't merge. Wait for fix; user-initiated. |

## Bounds

The cron's recurring jobs auto-expire after 7 days (per `CronCreate` docs).
That is the absolute upper bound on this loop; in practice it should
self-terminate within 30–60 minutes of PR creation under normal Codex
cadence.

If the loop is still running after the user has manually merged or closed
the PR, the next tick will detect that the PR is no longer open and should
exit cleanly (run `gh pr view <N> --json state` and stop if `MERGED` /
`CLOSED`).
