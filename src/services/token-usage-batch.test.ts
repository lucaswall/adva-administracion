import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenUsageBatch, type TokenUsageEntry } from './token-usage-batch.js';
import * as sheets from './sheets.js';

vi.mock('./sheets.js');
vi.mock('./token-usage-logger.js', () => ({
  calculateCost: vi.fn((_model, promptTokens, _cachedTokens, outputTokens) => {
    // Mock calculation: promptTokens * 0.0001 + cachedTokens * 0 + outputTokens * 0.0002
    return promptTokens * 0.0001 + outputTokens * 0.0002;
  }),
}));

describe('TokenUsageBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('add() accumulates entries', () => {
    const batch = new TokenUsageBatch();
    const entry1: TokenUsageEntry = {
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId: 'req-1',
      fileId: 'file-1',
      fileName: 'test1.pdf',
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    };
    const entry2: TokenUsageEntry = {
      ...entry1,
      requestId: 'req-2',
      fileId: 'file-2',
      fileName: 'test2.pdf',
    };

    batch.add(entry1);
    batch.add(entry2);

    expect(batch.pendingCount).toBe(2);
  });

  it('flush() writes all entries in single API call', async () => {
    const batch = new TokenUsageBatch();
    const entry1: TokenUsageEntry = {
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId: 'req-1',
      fileId: 'file-1',
      fileName: 'test1.pdf',
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    };
    const entry2: TokenUsageEntry = {
      ...entry1,
      requestId: 'req-2',
      fileId: 'file-2',
      fileName: 'test2.pdf',
      success: false,
      errorMessage: 'Test error',
    };

    vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });
    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({ ok: true, value: 2 });

    batch.add(entry1);
    batch.add(entry2);

    await batch.flush('dashboard-id');

    expect(sheets.getSpreadsheetTimezone).toHaveBeenCalledWith('dashboard-id');
    expect(sheets.appendRowsWithFormatting).toHaveBeenCalledTimes(1);
    expect(sheets.appendRowsWithFormatting).toHaveBeenCalledWith(
      'dashboard-id',
      'Uso de API',
      [
        [
          entry1.timestamp,
          entry1.requestId,
          entry1.fileId,
          entry1.fileName,
          entry1.model,
          entry1.promptTokens,
          entry1.cachedTokens,
          entry1.outputTokens,
          entry1.promptCostPerToken,
          entry1.cachedCostPerToken,
          entry1.outputCostPerToken,
          0.02, // estimatedCost: 100 * 0.0001 + 50 * 0.0002 = 0.01 + 0.01 = 0.02
          entry1.durationMs,
          'YES',
          '',
        ],
        [
          entry2.timestamp,
          entry2.requestId,
          entry2.fileId,
          entry2.fileName,
          entry2.model,
          entry2.promptTokens,
          entry2.cachedTokens,
          entry2.outputTokens,
          entry2.promptCostPerToken,
          entry2.cachedCostPerToken,
          entry2.outputCostPerToken,
          0.02, // estimatedCost: same calculation as entry1
          entry2.durationMs,
          'NO', // changed from 'ERROR' to 'NO' to match logTokenUsage format
          'Test error',
        ],
      ],
      'America/Argentina/Buenos_Aires'
    );
  });

  it('flush() clears accumulated entries', async () => {
    const batch = new TokenUsageBatch();
    const entry: TokenUsageEntry = {
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId: 'req-1',
      fileId: 'file-1',
      fileName: 'test1.pdf',
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    };

    vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });
    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({ ok: true, value: 1 });

    await batch.add(entry);
    expect(batch.pendingCount).toBe(1);

    await batch.flush('dashboard-id');
    expect(batch.pendingCount).toBe(0);
  });

  it('flush() does nothing when no entries', async () => {
    const batch = new TokenUsageBatch();

    await batch.flush('dashboard-id');

    expect(sheets.getSpreadsheetTimezone).not.toHaveBeenCalled();
    expect(sheets.appendRowsWithFormatting).not.toHaveBeenCalled();
  });

  it('pendingCount returns correct count', async () => {
    const batch = new TokenUsageBatch();
    const entry: TokenUsageEntry = {
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId: 'req-1',
      fileId: 'file-1',
      fileName: 'test1.pdf',
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    };

    expect(batch.pendingCount).toBe(0);
    await batch.add(entry);
    expect(batch.pendingCount).toBe(1);
    await batch.add(entry);
    expect(batch.pendingCount).toBe(2);
  });

  it('reuses cached timezone on subsequent flushes', async () => {
    const batch = new TokenUsageBatch();
    const entry: TokenUsageEntry = {
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId: 'req-1',
      fileId: 'file-1',
      fileName: 'test1.pdf',
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    };

    vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });
    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({ ok: true, value: 1 });

    batch.add(entry);
    await batch.flush('dashboard-id');

    batch.add(entry);
    await batch.flush('dashboard-id');

    expect(sheets.getSpreadsheetTimezone).toHaveBeenCalledTimes(1);
    expect(sheets.appendRowsWithFormatting).toHaveBeenCalledTimes(2);
  });

  it('does not retry timezone fetch repeatedly on failure', async () => {
    const batch = new TokenUsageBatch();
    const entry: TokenUsageEntry = {
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId: 'req-1',
      fileId: 'file-1',
      fileName: 'test1.pdf',
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    };

    // First call fails
    vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValueOnce({ ok: false, error: new Error('API error') });
    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({ ok: true, value: 1 });

    batch.add(entry);
    await batch.flush('dashboard-id');

    // Second flush should not retry timezone immediately
    batch.add(entry);
    await batch.flush('dashboard-id');

    // Should have only called timezone once (failed), not retry on second flush
    expect(sheets.getSpreadsheetTimezone).toHaveBeenCalledTimes(1);
    expect(sheets.appendRowsWithFormatting).toHaveBeenCalledTimes(2);
  });

  it('flush() preserves entries when appendRowsWithFormatting fails', async () => {
    const batch = new TokenUsageBatch();
    const entry: TokenUsageEntry = {
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId: 'req-1',
      fileId: 'file-1',
      fileName: 'test1.pdf',
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    };

    vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });
    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({ ok: false, error: new Error('Network error') });

    batch.add(entry);
    expect(batch.pendingCount).toBe(1);

    const result = await batch.flush('dashboard-id');

    // Entries should be preserved on failure
    expect(batch.pendingCount).toBe(1);
    expect(result.ok).toBe(false);
  });

  it('flush() clears entries only on successful write', async () => {
    const batch = new TokenUsageBatch();
    const entry: TokenUsageEntry = {
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId: 'req-1',
      fileId: 'file-1',
      fileName: 'test1.pdf',
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    };

    vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });
    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({ ok: true, value: 1 });

    batch.add(entry);

    const result = await batch.flush('dashboard-id');

    // Entries should be cleared on success
    expect(batch.pendingCount).toBe(0);
    expect(result.ok).toBe(true);
  });

  it('flush() allows retry with preserved entries after failure', async () => {
    const batch = new TokenUsageBatch();
    const entry: TokenUsageEntry = {
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId: 'req-1',
      fileId: 'file-1',
      fileName: 'test1.pdf',
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    };

    vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });

    batch.add(entry);

    // First flush fails
    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({ ok: false, error: new Error('Temporary error') });
    const result1 = await batch.flush('dashboard-id');
    expect(result1.ok).toBe(false);
    expect(batch.pendingCount).toBe(1);

    // Retry flush succeeds
    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({ ok: true, value: 1 });
    const result2 = await batch.flush('dashboard-id');
    expect(result2.ok).toBe(true);
    expect(batch.pendingCount).toBe(0);

    // Should have tried twice
    expect(sheets.appendRowsWithFormatting).toHaveBeenCalledTimes(2);
  });

  it('auto-flushes when MAX_BATCH_SIZE is reached', async () => {
    const batch = new TokenUsageBatch();
    const entry: TokenUsageEntry = {
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId: 'req-1',
      fileId: 'file-1',
      fileName: 'test.pdf',
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    };

    vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });
    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({ ok: true, value: 100 });

    // Add entries up to MAX_BATCH_SIZE (100)
    for (let i = 0; i < 100; i++) {
      await batch.add({ ...entry, requestId: `req-${i}` }, 'dashboard-id');
    }

    // Should have auto-flushed at exactly 100
    expect(sheets.appendRowsWithFormatting).toHaveBeenCalledTimes(1);
    expect(batch.pendingCount).toBe(0);

    // Adding one more should not flush yet
    await batch.add(entry, 'dashboard-id');
    expect(sheets.appendRowsWithFormatting).toHaveBeenCalledTimes(1);
    expect(batch.pendingCount).toBe(1);
  });

  it('preserves entries if auto-flush fails', async () => {
    const batch = new TokenUsageBatch();
    const entry: TokenUsageEntry = {
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId: 'req-1',
      fileId: 'file-1',
      fileName: 'test.pdf',
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    };

    vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });
    vi.mocked(sheets.appendRowsWithFormatting).mockResolvedValue({ ok: false, error: new Error('API error') });

    // Add entries up to MAX_BATCH_SIZE (100)
    for (let i = 0; i < 100; i++) {
      await batch.add({ ...entry, requestId: `req-${i}` }, 'dashboard-id');
    }

    // Auto-flush should have been attempted but failed
    expect(sheets.appendRowsWithFormatting).toHaveBeenCalledTimes(1);

    // Entries should be preserved for retry
    expect(batch.pendingCount).toBe(100);
  });

  describe('concurrent flushes (Codex PR-120 finding: snapshot atomicity)', () => {
    const makeEntry = (requestId: string): TokenUsageEntry => ({
      timestamp: new Date('2026-01-25T10:00:00Z'),
      requestId,
      fileId: `file-${requestId}`,
      fileName: `${requestId}.pdf`,
      model: 'gemini-2.0-flash',
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0001,
      cachedCostPerToken: 0,
      outputCostPerToken: 0.0002,
      durationMs: 500,
      success: true,
    });

    it('does not duplicate rows when a second flush starts while one is in flight', async () => {
      const batch = new TokenUsageBatch();
      vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });

      // Deferred append: each call resolves only when we release it
      const releases: Array<() => void> = [];
      vi.mocked(sheets.appendRowsWithFormatting).mockImplementation(() =>
        new Promise(resolve => {
          releases.push(() => resolve({ ok: true, value: 1 }));
        })
      );

      await batch.add(makeEntry('req-1'));
      await batch.add(makeEntry('req-2'));

      // First flush starts and blocks on the append
      const flushA = batch.flush('dashboard-id');
      await Promise.resolve();

      // A third entry arrives mid-flight, then a second flush starts
      await batch.add(makeEntry('req-3'));
      const flushB = batch.flush('dashboard-id');
      await Promise.resolve();

      // Release both appends
      releases.forEach(release => release());
      await flushA;
      await flushB;

      // Every requestId must be written exactly once across all append calls
      const writtenIds = vi.mocked(sheets.appendRowsWithFormatting).mock.calls
        .flatMap(call => call[2])
        .map(row => row[1]);
      expect(writtenIds.sort()).toEqual(['req-1', 'req-2', 'req-3']);
    });

    it('preserves entries added during an in-flight flush when that flush succeeds', async () => {
      const batch = new TokenUsageBatch();
      vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });

      let releaseAppend: (() => void) | undefined;
      vi.mocked(sheets.appendRowsWithFormatting).mockImplementationOnce(() =>
        new Promise(resolve => {
          releaseAppend = () => resolve({ ok: true, value: 1 });
        })
      );

      await batch.add(makeEntry('req-1'));
      await batch.add(makeEntry('req-2'));

      const flushA = batch.flush('dashboard-id');
      await Promise.resolve();

      // Entry added while the flush awaits the Sheets append
      await batch.add(makeEntry('req-3'));

      releaseAppend!();
      const result = await flushA;

      expect(result.ok).toBe(true);
      // req-3 must NOT be wiped by the in-flight flush's clear
      expect(batch.pendingCount).toBe(1);
    });

    it('re-queues the snapshot for retry when a flush fails with entries added mid-flight', async () => {
      const batch = new TokenUsageBatch();
      vi.mocked(sheets.getSpreadsheetTimezone).mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });

      let releaseAppend: (() => void) | undefined;
      vi.mocked(sheets.appendRowsWithFormatting).mockImplementationOnce(() =>
        new Promise(resolve => {
          releaseAppend = () => resolve({ ok: false, error: new Error('API error') });
        })
      );

      await batch.add(makeEntry('req-1'));
      await batch.add(makeEntry('req-2'));

      const flushA = batch.flush('dashboard-id');
      await Promise.resolve();

      await batch.add(makeEntry('req-3'));

      releaseAppend!();
      const result = await flushA;

      expect(result.ok).toBe(false);
      // Failed snapshot (req-1, req-2) re-queued alongside the mid-flight req-3
      expect(batch.pendingCount).toBe(3);
    });
  });
});
