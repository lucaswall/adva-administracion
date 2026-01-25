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

    batch.add(entry);
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

  it('pendingCount returns correct count', () => {
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
    batch.add(entry);
    expect(batch.pendingCount).toBe(1);
    batch.add(entry);
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
});
