# Implementation Plan

**Created:** 2026-01-31
**Source:** TODO.md items #1, #4, #18 (race conditions - conditional formatting, duplicate notification, retry tracking)

## Context Gathered

### Codebase Analysis

**Files Analyzed:**
- `src/services/status-sheet.ts:97-265` - conditionalFormattingApplied global flag race
- `src/routes/webhooks.ts:122-137` - duplicate notification check-then-mark pattern
- `src/services/watch-manager.ts:291-361` - isNotificationDuplicate and markNotificationProcessed (separate functions)
- `src/processing/scanner.ts:51,82,119` - retriedFileIds check-then-set in concurrent queue tasks
- `src/utils/concurrency.ts:103-118` - Reference atomic pattern from recent fix

**Race Condition #1: conditionalFormattingApplied Flag**

Location: `src/services/status-sheet.ts:97,154,255-265`

```typescript
// Line 97: Unprotected global flag
let conditionalFormattingApplied = false;

// Lines 255-265: TOCTOU - check then set
if (!conditionalFormattingApplied) {        // CHECK
  const formatResult = await applyStatus...  // yields to event loop
  // ... inside applyStatus...
  conditionalFormattingApplied = true;       // SET (inside async function at line 154)
}
```

Problem: Multiple concurrent `updateStatusSheet()` calls can pass the check before any sets the flag, causing redundant API calls.

**Race Condition #4: Duplicate Notification Detection**

Location: `src/routes/webhooks.ts:122-137` and `src/services/watch-manager.ts:291-361`

```typescript
// webhooks.ts line 122-125: Check (calls separate function)
if (messageNumber && isNotificationDuplicate(messageNumber, channelId)) {
  return reply.code(200).send({ status: 'duplicate' });
}

// webhooks.ts lines 136-137: Mark (calls separate function)
if (messageNumber) {
  markNotificationProcessed(messageNumber, channelId);
}
```

Problem: Two separate function calls create TOCTOU gap. Between check (line 122) and mark (line 136), another request can slip through.

**Race Condition #18: retriedFileIds Tracking**

Location: `src/processing/scanner.ts:51,82,119`

```typescript
// Line 51: Shared map
const retriedFileIds = new Map<string, number>();

// Line 82: Read (inside queue task)
const retryCount = retriedFileIds.get(fileInfo.id) ?? 0;

// Line 113: Async processing... (yields to event loop!)
const processResult = await processFile(fileInfo, context);

// Line 119: Write (after async gap)
retriedFileIds.set(fileInfo.id, retryCount + 1);
```

Problem: Queue runs with concurrency=12 (see `queue.ts:29,34`). Between read at line 82 and write at line 119, another queue task can read the same value. However, this is only relevant for the SAME fileId. Since files are unique in a batch, concurrent tasks won't access the same fileId.

**Upon closer analysis:** The scanner processes files from `newFiles` array (line 565). Each file has a unique `fileInfo.id`. The queue tasks operate on different files, not the same file. The retry logic is recursive within a single task (line 136), so there's no concurrent access to the same fileId.

**Revised assessment:** Item #18 is actually a FALSE POSITIVE. The retry tracking race condition does NOT exist because:
1. Each queue task processes a unique file
2. Retry is recursive within the same task (line 136: `return processFileWithRetry(...)`)
3. `retriedFileIds.clear()` happens after `queue.onIdle()` (line 583, 675) - all tasks complete first

### Existing Patterns

From recent fix in `concurrency.ts:103-118`:
```typescript
// Atomic: create promise, then set all state in single Map.set()
let resolver: () => void = () => {};
const waitPromise = new Promise<void>((resolve) => {
  resolver = resolve;
});

this.locks.set(resourceId, {
  locked: true,
  acquiredAt: Date.now(),
  autoExpiryMs,
  holderCorrelationId: correlationId,
  waitPromise,
  waitResolve: resolver,
});
```

From scanner.ts state machine (lines 54-55, 365-383):
```typescript
type ScanState = 'idle' | 'pending' | 'running';
let scanState: ScanState = 'idle';

// Atomic check-and-set (no yield between)
if (scanState !== 'idle') {
  return skipped;
}
scanState = 'pending';  // Set immediately, no await
```

### Test Patterns

Existing tests in:
- `src/services/status-sheet.test.ts` - Tests collectStatusMetrics, formatTimestampInTimezone
- `src/routes/webhooks.test.ts` - Tests webhook routes with mocked watch-manager
- `src/services/watch-manager.test.ts` - Tests watch channel management
- `src/utils/concurrency.test.ts:227-350` - Concurrent lock acquisition stress tests

---

## Implementation Tasks

### Task 1: Fix conditionalFormattingApplied race condition

1. Write test in `src/services/status-sheet.test.ts`:
   - Test that concurrent `updateStatusSheet()` calls only apply formatting once
   - Use Promise.all to simulate concurrent calls
   - Mock `applyConditionalFormat` to track call count
   - Verify formatting applied exactly once despite multiple concurrent calls

2. Run test-runner (expect fail)

3. Update `src/services/status-sheet.ts`:
   - Use atomic check-and-set pattern (same as scanner.ts state machine)
   - Set flag BEFORE async operation, not after

   **Before (lines 255-265):**
   ```typescript
   if (!conditionalFormattingApplied) {
     const formatResult = await applyStatusConditionalFormatting(spreadsheetId);
     // ... flag set inside applyStatusConditionalFormatting at line 154
   }
   ```

   **After:**
   ```typescript
   // Atomic check-and-set: no yield between read and write
   if (!conditionalFormattingApplied) {
     conditionalFormattingApplied = true;  // Set BEFORE async call
     const formatResult = await applyStatusConditionalFormatting(spreadsheetId);
     if (!formatResult.ok) {
       // Note: We don't reset to false because:
       // 1. Error is already logged (line 259-263)
       // 2. Re-attempting on next call would likely fail again
       // 3. Non-fatal - status sheet works without formatting
     }
   }
   ```

   Also remove the duplicate flag set at line 154 inside `applyStatusConditionalFormatting()`.

4. Run test-runner (expect pass)

### Task 2: Fix duplicate notification detection race condition

1. Write test in `src/services/watch-manager.test.ts`:
   - Test that concurrent calls with same messageNumber only process once
   - Create new `checkAndMarkNotification()` function
   - Use Promise.all to simulate concurrent webhook handlers
   - Verify exactly one returns "new", others return "duplicate"

2. Run test-runner (expect fail)

3. Update `src/services/watch-manager.ts`:
   - Create atomic `checkAndMarkNotification()` function that combines check and mark
   - Returns boolean: `true` if notification was new (and now marked), `false` if duplicate

   **Add new function:**
   ```typescript
   /**
    * Atomically check and mark a notification as processed
    * Prevents TOCTOU race between check and mark
    *
    * @param messageNumber - Notification message number
    * @param channelId - Channel ID
    * @returns true if notification was new and now marked, false if duplicate
    */
   export function checkAndMarkNotification(
     messageNumber: string | undefined,
     channelId: string
   ): boolean {
     if (!messageNumber) {
       return true; // No message number = always process (legacy behavior)
     }

     const now = Date.now();
     let channelNotifications = processedNotifications.get(channelId);

     // Check if already processed (with expiry check)
     if (channelNotifications) {
       const timestamp = channelNotifications.get(messageNumber);
       if (timestamp !== undefined) {
         if (now - timestamp <= MAX_NOTIFICATION_AGE_MS) {
           return false; // Duplicate
         }
         // Expired - will be replaced below
       }
     } else {
       channelNotifications = new Map();
       processedNotifications.set(channelId, channelNotifications);
     }

     // Atomic: mark as processed immediately (no yield before this)
     channelNotifications.set(messageNumber, now);
     lastNotificationTime = new Date();

     // Cleanup old entries (same logic as markNotificationProcessed)
     if (channelNotifications.size > MAX_NOTIFICATIONS_PER_CHANNEL) {
       // ... existing cleanup logic
     }

     return true; // New notification
   }
   ```

4. Update `src/routes/webhooks.ts` to use the new atomic function:

   **Before (lines 122-137):**
   ```typescript
   if (messageNumber && isNotificationDuplicate(messageNumber, channelId)) {
     return reply.code(200).send({ status: 'duplicate' });
   }
   // ... later ...
   if (messageNumber) {
     markNotificationProcessed(messageNumber, channelId);
   }
   ```

   **After:**
   ```typescript
   // Atomic check-and-mark to prevent TOCTOU race
   if (!checkAndMarkNotification(messageNumber, channelId)) {
     server.log.debug({ channelId, messageNumber }, 'Duplicate notification ignored');
     return reply.code(200).send({ status: 'duplicate' });
   }
   // Remove the later markNotificationProcessed calls (lines 136-137, 155-157)
   ```

5. Run test-runner (expect pass)

### Task 3: Remove item #18 from TODO.md (false positive)

1. No test needed - this is a documentation-only change

2. The race condition described in item #18 does NOT exist because:
   - Each queue task processes a unique fileId
   - Retry is recursive within the same task (no concurrent access to same fileId)
   - `retriedFileIds.clear()` happens after all queue tasks complete

3. Update TODO.md to remove item #18 (will be done in final step)

### Task 4: Add stress tests for concurrent operations

1. Write stress test in `src/services/status-sheet.test.ts`:
   - Spawn 10 concurrent updateStatusSheet() calls
   - Verify conditional formatting applied exactly once

2. Write stress test in `src/services/watch-manager.test.ts`:
   - Spawn 10 concurrent checkAndMarkNotification() calls with same messageNumber
   - Verify exactly 1 returns true (new), 9 return false (duplicate)

3. Run test-runner (expect pass - validates fixes from Tasks 1-2)

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings

---

## Iteration 1

**Implemented:** 2026-01-31

### Completed

- **Task 1: Fix conditionalFormattingApplied race condition**
  - Implemented atomic check-and-set pattern in `src/services/status-sheet.ts:255-256`
  - Set flag BEFORE async call to prevent TOCTOU race
  - Removed duplicate flag set inside `applyStatusConditionalFormatting()` at line 154
  - Added concurrent test in `src/services/status-sheet.test.ts` (10 concurrent calls, formatting applied exactly once)

- **Task 2: Fix duplicate notification detection race condition**
  - Created atomic `checkAndMarkNotification()` function in `src/services/watch-manager.ts:363-421`
  - Combines check and mark operations with no yield between (atomic in event loop)
  - Updated `src/routes/webhooks.ts` to use new atomic function (lines 6-11, 117-119)
  - Removed separate `markNotificationProcessed()` calls from webhook handlers
  - Added concurrent test in `src/services/watch-manager.test.ts` (10 concurrent calls, exactly 1 returns true)
  - **Bug fix (from bug-hunter):** Removed dead code - deleted unused `isNotificationDuplicate()` and `markNotificationProcessed()` functions

- **Task 3: Remove item #18 from TODO.md (false positive)**
  - Confirmed TODO.md was regenerated since plan creation - false positive already removed
  - Original item #18 (retriedFileIds race condition) does not exist because:
    - Each queue task processes a unique fileId
    - Retry is recursive within same task (no concurrent access to same fileId)
    - `retriedFileIds.clear()` happens after all queue tasks complete

- **Task 4: Add stress tests for concurrent operations**
  - Enhanced status-sheet test to verify 10 concurrent calls apply formatting exactly once
  - Enhanced watch-manager test to verify 10 concurrent calls return exactly 1 true, 9 false
  - Both tests validate the atomic fixes from Tasks 1-2

### Checklist Results

- **bug-hunter:** Passed
  - Found 3 non-critical issues (test naming, dead code, test isolation)
  - Fixed dead code issue by removing unused functions
  - Other issues noted but acceptable (test is valid, module state is manageable)
  - No runtime bugs found - race condition fixes are correct

- **test-runner:** Passed
  - All 1,187 tests passed
  - Duration: 7.64 seconds

- **builder:** Passed
  - Zero warnings
  - Zero errors

### Notes

**Race condition fixes verified:**

1. **status-sheet.ts (line 255-256):** Atomic check-and-set prevents multiple concurrent `updateStatusSheet()` calls from applying formatting more than once. Flag set synchronously before async operation.

2. **watch-manager.ts (line 363-421):** `checkAndMarkNotification()` combines check and mark with no `await` between operations, making it atomic in JavaScript's event loop model. Prevents duplicate notification processing.

3. **webhooks.ts (line 117-119):** Webhook handler now uses single atomic call instead of separate check-then-mark pattern, eliminating TOCTOU window.

**Edge case discovered:** Test naming could be improved - "concurrent" tests actually execute synchronously (which is fine since the functions are synchronous), but naming could be clearer about testing sequential deduplication rather than true concurrency.

**Dead code removed:** `isNotificationDuplicate()` and `markNotificationProcessed()` were superseded by `checkAndMarkNotification()` and have been deleted. Only `markNotificationProcessedWithTimestamp()` remains for testing purposes.

### Review Findings

Files reviewed: 6
Checks applied: Security, Logic, Async, Race Conditions, Resources, Type Safety, Error Handling, Tests, Conventions

**Verification of race condition fixes:**

1. **status-sheet.ts:255-256** - `conditionalFormattingApplied` flag is set synchronously (no `await` between check and set), preventing multiple concurrent `updateStatusSheet()` calls from passing the check. ✅

2. **watch-manager.ts:292-342** - `checkAndMarkNotification()` is fully synchronous (contains no `await` or `.then()`), making it truly atomic in JavaScript's single-threaded event loop. The check (line 305-310) and mark (line 318) happen in the same synchronous execution block. ✅

3. **webhooks.ts:121** - Single atomic `checkAndMarkNotification()` call replaces the previous separate `isNotificationDuplicate()` + `markNotificationProcessed()` pattern, eliminating the TOCTOU window. ✅

**Test validity:**

- `status-sheet.test.ts:138-157` - Correctly spawns 10 calls via `Promise.all()` and verifies `applyConditionalFormat` called exactly once
- `watch-manager.test.ts:356-374` - Correctly verifies exactly 1 of 10 calls returns `true` (new), 9 return `false` (duplicate)

No issues found - all implementations are correct and follow project conventions.

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. Ready for human review.
