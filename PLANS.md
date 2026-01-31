# Implementation Plan

**Created:** 2026-01-31
**Source:** TODO.md critical items #1, #2, #3 (race conditions in lock acquisition and pendingScan flag)

## Context Gathered

### Codebase Analysis

**Files Analyzed:**
- `src/utils/concurrency.ts:78-123` - Lock acquisition logic with race condition
- `src/processing/scanner.ts:363-384` - pendingScan flag with TOCTOU race
- `src/utils/concurrency.test.ts` - Existing lock tests

**Race Condition #1 & #2: Lock Acquisition (Critical)**

The `LockManager.acquire()` method has a TOCTOU (Time-Of-Check-To-Time-Of-Use) vulnerability:

```typescript
// Line 100-114 in concurrency.ts
const currentState = this.locks.get(resourceId);  // CHECK

if (!currentState?.locked) {
  // Lock is available
  const waitPromise = new Promise<void>((resolve) => {
    this.locks.set(resourceId, {  // USE (not atomic!)
      locked: true,
      // ...
    });
  });

  this.locks.get(resourceId)!.waitPromise = waitPromise;  // Another read/write!
}
```

**Problems:**
1. Between checking `!currentState?.locked` (line 102) and setting the lock (line 105), another async task can also see the lock as free and acquire it
2. The `waitPromise` is set AFTER creating the lock state (line 114), creating a window where waiters see `undefined` and fall into polling
3. JavaScript is single-threaded but async/await yields to the event loop - two concurrent `acquire()` calls interleave at await points

**Race Condition #3: pendingScan Flag (High)**

Similar TOCTOU in scanner.ts:

```typescript
// Line 365-384 in scanner.ts
if (pendingScan) {  // CHECK
  // skip
}

pendingScan = true;  // USE (not atomic!)
```

Between checking and setting, another concurrent invocation can pass the check.

### Existing Patterns

**Lock Pattern:**
- `withLock()` function wraps `acquire`/`release` with try/finally
- Locks auto-expire after configurable timeout (default 30s, processing uses 5min)
- Used for: document processing lock (`PROCESSING_LOCK_ID`)

**Test Patterns:**
- `concurrency.test.ts` has 17 tests covering: basic locking, timeout, auto-expiry, retry
- Tests use `vi.useFakeTimers()` for timing control
- `clearAllLocks()` used in beforeEach for test isolation

### Root Cause Analysis

JavaScript's event loop ensures single-threaded execution per tick, but:
1. `await` yields to event loop
2. Multiple `scanFolder()` calls can start before any completes
3. Each pauses at `await withLock(...)`
4. When lock check runs, multiple can see lock as free

**Example interleaving:**
```
Task A: if (pendingScan)  → false
Task B: if (pendingScan)  → false  (A hasn't set it yet)
Task A: pendingScan = true
Task B: pendingScan = true  (both proceed!)
```

### Solution Approach

**Option 1: Synchronized Flag Pattern**
Use a single atomic state variable instead of check-then-set:

```typescript
let scanState: 'idle' | 'pending' | 'running' = 'idle';

// Atomic state transition
const prevState = scanState;
if (scanState === 'idle') {
  scanState = 'pending';
}
// Single read determines action
if (prevState !== 'idle') {
  return skipped;
}
```

This works because JavaScript guarantees atomic variable reads/writes within a synchronous block.

**Option 2: Promise-based Lock**
For the LockManager, set all state atomically:

```typescript
if (!currentState?.locked) {
  let resolver: () => void;
  const waitPromise = new Promise<void>((resolve) => {
    resolver = resolve;
  });

  // Set everything atomically (no yields between)
  this.locks.set(resourceId, {
    locked: true,
    acquiredAt: Date.now(),
    autoExpiryMs,
    holderCorrelationId: correlationId,
    waitPromise,      // Include in initial set
    waitResolve: resolver!,
  });

  return true;
}
```

**Chosen Approach:** Option 2 for LockManager (single atomic Map.set), Option 1 for pendingScan (state machine pattern)

---

## Implementation Tasks

### Task 1: Fix lock acquisition race condition in concurrency.ts

1. Write test in `src/utils/concurrency.test.ts`:
   - Test that concurrent lock acquisition doesn't result in double-locking
   - Use Promise.all to simulate concurrent acquire() calls
   - Verify only ONE acquires the lock, others wait
   - Test that waitPromise is immediately available (not undefined) for waiters

2. Run test-runner (expect fail)

3. Update `src/utils/concurrency.ts` LockManager.acquire():
   - Create waitPromise and capture resolver BEFORE setting lock state
   - Set all lock state atomically in single `this.locks.set()` call
   - Remove the separate `this.locks.get(resourceId)!.waitPromise = waitPromise` line

   ```typescript
   if (!currentState?.locked) {
     // Create promise and capture resolver synchronously
     let resolver: () => void;
     const waitPromise = new Promise<void>((resolve) => {
       resolver = resolve;
     });

     // Set ALL state atomically (no awaits between)
     this.locks.set(resourceId, {
       locked: true,
       acquiredAt: Date.now(),
       autoExpiryMs,
       holderCorrelationId: correlationId,
       waitPromise,
       waitResolve: resolver!,
     });

     debug('Lock acquired', {
       module: 'concurrency',
       resourceId,
       correlationId,
     });

     return true;
   }
   ```

4. Run test-runner (expect pass)

### Task 2: Fix pendingScan race condition in scanner.ts

1. Write test in `src/processing/scanner.test.ts`:
   - Test that concurrent scanFolder() calls (using Promise.all) don't both proceed
   - Simulate two scans starting simultaneously
   - Verify exactly one runs and one skips
   - Verify the skip happens with reason 'scan_pending'

2. Run test-runner (expect fail)

3. Update `src/processing/scanner.ts`:
   - Replace boolean `pendingScan` with state machine pattern
   - Use atomic read-then-write within synchronous block

   **Before:**
   ```typescript
   let pendingScan = false;

   // In scanFolder:
   if (pendingScan) {
     return skipped;
   }
   pendingScan = true;
   ```

   **After:**
   ```typescript
   type ScanState = 'idle' | 'pending' | 'running';
   let scanState: ScanState = 'idle';

   // In scanFolder:
   // Atomic check-and-set (no yield between read and write)
   if (scanState !== 'idle') {
     info('Scan skipped - another scan already ' + scanState, { module: 'scanner' });
     return {
       ok: true,
       value: {
         skipped: true,
         reason: scanState === 'pending' ? 'scan_pending' : 'scan_running',
         filesProcessed: 0,
         // ... rest of fields
       }
     };
   }
   scanState = 'pending';

   try {
     // Before acquiring lock, mark as running
     // ... inside withLock callback:
     scanState = 'running';
     // ... scan logic
   } finally {
     scanState = 'idle';
   }
   ```

4. Run test-runner (expect pass)

### Task 3: Add stress test for concurrent lock acquisition

1. Write additional test in `src/utils/concurrency.test.ts`:
   - Spawn 10 concurrent withLock() calls
   - Track which ones acquired the lock vs timed out
   - Verify mutual exclusion (only one runs at a time)
   - Verify completion order (FIFO-ish with timing tolerance)

2. Run test-runner (expect pass - validates fix from Task 1)

### Task 4: Add stress test for concurrent scan calls

1. Write additional test in `src/processing/scanner.test.ts`:
   - Spawn 5 concurrent scanFolder() calls
   - Verify exactly 1 runs, others skip or wait
   - Verify final result is successful scan

2. Run test-runner (expect pass - validates fix from Task 2)

### Task 5: Update documentation

1. Update `CLAUDE.md` Concurrency Control section:
   - Document the atomic lock acquisition pattern
   - Document the scan state machine
   - Note that JavaScript async doesn't guarantee ordering without explicit synchronization

2. No test needed (documentation only)

## Post-Implementation Checklist

1. Run `bug-hunter` agent - Review changes for bugs
2. Run `test-runner` agent - Verify all tests pass
3. Run `builder` agent - Verify zero warnings
