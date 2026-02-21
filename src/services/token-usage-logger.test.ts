/**
 * Unit tests for Token Usage Logger
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockInstance } from 'vitest';

// Mock the sheets module before importing token-usage-logger
vi.mock('./sheets.js', () => ({
  appendRowsWithFormatting: vi.fn(),
  getValues: vi.fn(),
  getSpreadsheetTimezone: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { logTokenUsage } from './token-usage-logger.js';
import * as sheetsModule from './sheets.js';

describe('logTokenUsage', () => {
  let mockAppendRowsWithFormatting: MockInstance;
  let mockGetValues: MockInstance;
  let mockGetSpreadsheetTimezone: MockInstance;

  const sampleData = {
    timestamp: new Date('2025-01-15T10:00:00Z'),
    requestId: 'test-uuid-123',
    fileId: 'file-abc',
    fileName: 'test.pdf',
    model: 'gemini-2.5-flash' as const,
    promptTokens: 100,
    cachedTokens: 50,
    outputTokens: 200,
    totalTokens: 350,
    promptCostPerToken: 0.000001,
    cachedCostPerToken: 0.0000005,
    outputCostPerToken: 0.000002,
    durationMs: 1500,
    success: true,
    errorMessage: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendRowsWithFormatting = vi.mocked(sheetsModule.appendRowsWithFormatting);
    mockGetValues = vi.mocked(sheetsModule.getValues);
    mockGetSpreadsheetTimezone = vi.mocked(sheetsModule.getSpreadsheetTimezone);

    mockGetSpreadsheetTimezone.mockResolvedValue({ ok: true, value: 'America/Argentina/Buenos_Aires' });
    mockAppendRowsWithFormatting.mockResolvedValue({ ok: true, value: 1 });
  });

  it('should NOT call getValues (no TOCTOU race condition)', async () => {
    await logTokenUsage('spreadsheet123', sampleData);
    expect(mockGetValues).not.toHaveBeenCalled();
  });

  it('should use ROW()-based self-referencing formula for cost calculation', async () => {
    await logTokenUsage('spreadsheet123', sampleData);

    expect(mockAppendRowsWithFormatting).toHaveBeenCalledOnce();
    const rows = mockAppendRowsWithFormatting.mock.calls[0][2] as unknown[][];
    const row = rows[0];

    // estimatedCostUSD is column 12 (index 11, 0-based)
    const formulaCell = row[11] as { type: string; value: string };

    // Must be a CellFormula object
    expect(formulaCell).toMatchObject({ type: 'formula', value: expect.any(String) });

    // Must use ROW() for self-referencing (not hardcoded row numbers)
    expect(formulaCell.value).toContain('ROW()');

    // Must NOT use hardcoded cell references like F2, G15
    expect(formulaCell.value).not.toMatch(/[A-Z]\d+/);
  });

  it('should return success when append succeeds', async () => {
    const result = await logTokenUsage('spreadsheet123', sampleData);
    expect(result.ok).toBe(true);
  });

  it('should return error when appendRowsWithFormatting fails', async () => {
    mockAppendRowsWithFormatting.mockResolvedValue({ ok: false, error: new Error('API error') });

    const result = await logTokenUsage('spreadsheet123', sampleData);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('API error');
    }
  });
});
