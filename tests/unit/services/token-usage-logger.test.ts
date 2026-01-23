/**
 * Tests for Token Usage Logger service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateCost, generateRequestId, logTokenUsage } from '../../../src/services/token-usage-logger.js';
import * as sheetsService from '../../../src/services/sheets.js';

// Mock sheets service
vi.mock('../../../src/services/sheets.js', () => ({
  appendRowsWithFormatting: vi.fn(),
  getValues: vi.fn(),
}));

describe('calculateCost', () => {
  it('should calculate cost for gemini-2.5-flash with only prompt tokens', () => {
    const cost = calculateCost('gemini-2.5-flash', 1000, 0, 0);
    // $0.30 per 1M tokens = $0.0000003 per token
    // 1000 tokens * $0.0000003 = $0.0003
    expect(cost).toBe(0.0003);
  });

  it('should calculate cost for gemini-2.5-flash with only cached tokens', () => {
    const cost = calculateCost('gemini-2.5-flash', 0, 1000, 0);
    // $0.03 per 1M tokens = $0.00000003 per token
    // 1000 tokens * $0.00000003 = $0.00003
    expect(cost).toBeCloseTo(0.00003, 8);
  });

  it('should calculate cost for gemini-2.5-flash with only output tokens', () => {
    const cost = calculateCost('gemini-2.5-flash', 0, 0, 500);
    // $2.50 per 1M tokens = $0.0000025 per token
    // 500 tokens * $0.0000025 = $0.00125
    expect(cost).toBe(0.00125);
  });

  it('should calculate cost for gemini-2.5-flash with prompt and output tokens', () => {
    const cost = calculateCost('gemini-2.5-flash', 1000, 0, 500);
    // Prompt: 1000 * $0.0000003 = $0.0003
    // Output: 500 * $0.0000025 = $0.00125
    // Total: $0.00155
    expect(cost).toBe(0.00155);
  });

  it('should calculate cost for gemini-2.5-flash with all token types', () => {
    const cost = calculateCost('gemini-2.5-flash', 1000, 500, 300);
    // Prompt: 1000 * $0.0000003 = $0.0003
    // Cached: 500 * $0.00000003 = $0.000015
    // Output: 300 * $0.0000025 = $0.00075
    // Total: $0.001065
    expect(cost).toBe(0.001065);
  });

  it('should handle zero tokens', () => {
    const cost = calculateCost('gemini-2.5-flash', 0, 0, 0);
    expect(cost).toBe(0);
  });

  it('should handle large token counts', () => {
    const cost = calculateCost('gemini-2.5-flash', 1_000_000, 500_000, 1_000_000);
    // Prompt: 1M * $0.0000003 = $0.30
    // Cached: 500K * $0.00000003 = $0.015
    // Output: 1M * $0.0000025 = $2.50
    // Total: $2.815
    expect(cost).toBe(2.815);
  });

  it('should round to reasonable precision', () => {
    const cost = calculateCost('gemini-2.5-flash', 333, 222, 777);
    // Prompt: 333 * $0.0000003 = $0.0000999
    // Cached: 222 * $0.00000003 = $0.00000666
    // Output: 777 * $0.0000025 = $0.0019425
    // Total: $0.00204906
    expect(cost).toBeCloseTo(0.00204906, 8);
  });

  it('should show cached tokens are 90% cheaper than prompt tokens', () => {
    const promptCost = calculateCost('gemini-2.5-flash', 1000, 0, 0);
    const cachedCost = calculateCost('gemini-2.5-flash', 0, 1000, 0);
    // Cached should be 10x cheaper (90% discount)
    expect(promptCost / cachedCost).toBe(10);
  });
});

describe('generateRequestId', () => {
  it('should generate a valid UUID v4', () => {
    const id = generateRequestId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidV4Regex);
  });

  it('should generate unique IDs', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    const id3 = generateRequestId();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it('should generate IDs with correct length', () => {
    const id = generateRequestId();
    expect(id.length).toBe(36); // UUID format with dashes
  });
});

describe('logTokenUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log successful API call with all fields', async () => {
    const mockAppendRows = vi.mocked(sheetsService.appendRowsWithFormatting);
    const mockGetValues = vi.mocked(sheetsService.getValues);

    // Mock current row count (header + 1 existing row = 2 rows, so next row is 3)
    mockGetValues.mockResolvedValue({ ok: true, value: [['header'], ['row1']] });
    mockAppendRows.mockResolvedValue({ ok: true, value: 1 });

    const timestampStr = '2026-01-21T10:30:00.000Z';
    const data = {
      timestamp: timestampStr,
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      fileId: 'file123',
      fileName: 'invoice.pdf',
      model: 'gemini-2.5-flash' as const,
      promptTokens: 1000,
      cachedTokens: 500,
      outputTokens: 500,
      totalTokens: 2000,
      promptCostPerToken: 0.0000003,
      cachedCostPerToken: 0.00000003,
      outputCostPerToken: 0.0000025,
      durationMs: 2500,
      success: true,
      errorMessage: '',
    };

    const result = await logTokenUsage('spreadsheet123', data);

    expect(result.ok).toBe(true);
    expect(mockGetValues).toHaveBeenCalledWith('spreadsheet123', 'Uso de API!A:A');
    expect(mockAppendRows).toHaveBeenCalledWith(
      'spreadsheet123',
      'Uso de API',
      [[
        new Date(timestampStr),
        '123e4567-e89b-12d3-a456-426614174000',
        'file123',
        'invoice.pdf',
        'gemini-2.5-flash',
        1000,
        500,
        500,
        0.0000003,
        0.00000003,
        0.0000025,
        '=F3*I3+G3*J3+H3*K3', // Formula for row 3
        2500,
        'YES',
        '',
      ]]
    );
  });

  it('should log failed API call with error message', async () => {
    const mockAppendRows = vi.mocked(sheetsService.appendRowsWithFormatting);
    const mockGetValues = vi.mocked(sheetsService.getValues);

    // Mock empty sheet (only header)
    mockGetValues.mockResolvedValue({ ok: true, value: [['header']] });
    mockAppendRows.mockResolvedValue({ ok: true, value: 1 });

    const timestampStr = '2026-01-21T10:30:00.000Z';
    const data = {
      timestamp: timestampStr,
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      fileId: 'file123',
      fileName: 'invoice.pdf',
      model: 'gemini-2.5-flash' as const,
      promptTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      promptCostPerToken: 0.0000003,
      cachedCostPerToken: 0.00000003,
      outputCostPerToken: 0.0000025,
      durationMs: 1000,
      success: false,
      errorMessage: 'API rate limit exceeded',
    };

    const result = await logTokenUsage('spreadsheet123', data);

    expect(result.ok).toBe(true);
    expect(mockAppendRows).toHaveBeenCalledWith(
      'spreadsheet123',
      'Uso de API',
      [[
        new Date(timestampStr),
        '123e4567-e89b-12d3-a456-426614174000',
        'file123',
        'invoice.pdf',
        'gemini-2.5-flash',
        0,
        0,
        0,
        0.0000003,
        0.00000003,
        0.0000025,
        '=F2*I2+G2*J2+H2*K2', // Formula for row 2 (first data row)
        1000,
        'NO',
        'API rate limit exceeded',
      ]]
    );
  });

  it('should return error when appendRowsWithFormatting fails', async () => {
    const mockAppendRows = vi.mocked(sheetsService.appendRowsWithFormatting);
    const mockGetValues = vi.mocked(sheetsService.getValues);

    mockGetValues.mockResolvedValue({ ok: true, value: [['header']] });
    mockAppendRows.mockResolvedValue({
      ok: false,
      error: new Error('Failed to append row')
    });

    const data = {
      timestamp: '2026-01-21T10:30:00.000Z',
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      fileId: 'file123',
      fileName: 'invoice.pdf',
      model: 'gemini-2.5-flash' as const,
      promptTokens: 1000,
      cachedTokens: 500,
      outputTokens: 500,
      totalTokens: 2000,
      promptCostPerToken: 0.0000003,
      cachedCostPerToken: 0.00000003,
      outputCostPerToken: 0.0000025,
      durationMs: 2500,
      success: true,
      errorMessage: '',
    };

    const result = await logTokenUsage('spreadsheet123', data);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to append row');
    }
  });

  it('should handle missing optional fields', async () => {
    const mockAppendRows = vi.mocked(sheetsService.appendRowsWithFormatting);
    const mockGetValues = vi.mocked(sheetsService.getValues);

    mockGetValues.mockResolvedValue({ ok: true, value: [['header']] });
    mockAppendRows.mockResolvedValue({ ok: true, value: 1 });

    const timestampStr = '2026-01-21T10:30:00.000Z';
    const data = {
      timestamp: timestampStr,
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      fileId: '',
      fileName: '',
      model: 'gemini-2.5-flash' as const,
      promptTokens: 100,
      cachedTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
      promptCostPerToken: 0.0000003,
      cachedCostPerToken: 0.00000003,
      outputCostPerToken: 0.0000025,
      durationMs: 500,
      success: true,
      errorMessage: '',
    };

    const result = await logTokenUsage('spreadsheet123', data);

    expect(result.ok).toBe(true);
    expect(mockAppendRows).toHaveBeenCalledWith(
      'spreadsheet123',
      'Uso de API',
      [[
        new Date(timestampStr),
        '123e4567-e89b-12d3-a456-426614174000',
        '',
        '',
        'gemini-2.5-flash',
        100,
        0,
        50,
        0.0000003,
        0.00000003,
        0.0000025,
        '=F2*I2+G2*J2+H2*K2',
        500,
        'YES',
        '',
      ]]
    );
  });

  it('should return error when getValues fails', async () => {
    const mockGetValues = vi.mocked(sheetsService.getValues);

    mockGetValues.mockResolvedValue({
      ok: false,
      error: new Error('Failed to get values')
    });

    const data = {
      timestamp: '2026-01-21T10:30:00.000Z',
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      fileId: 'file123',
      fileName: 'invoice.pdf',
      model: 'gemini-2.5-flash' as const,
      promptTokens: 1000,
      cachedTokens: 500,
      outputTokens: 500,
      totalTokens: 2000,
      promptCostPerToken: 0.0000003,
      cachedCostPerToken: 0.00000003,
      outputCostPerToken: 0.0000025,
      durationMs: 2500,
      success: true,
      errorMessage: '',
    };

    const result = await logTokenUsage('spreadsheet123', data);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to get values');
    }
  });

  it('should handle Date object timestamps', async () => {
    const mockAppendRows = vi.mocked(sheetsService.appendRowsWithFormatting);
    const mockGetValues = vi.mocked(sheetsService.getValues);

    mockGetValues.mockResolvedValue({ ok: true, value: [['header']] });
    mockAppendRows.mockResolvedValue({ ok: true, value: 1 });

    const timestampDate = new Date('2026-01-21T10:30:00.000Z');
    const data = {
      timestamp: timestampDate,
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      fileId: 'file123',
      fileName: 'invoice.pdf',
      model: 'gemini-2.5-flash' as const,
      promptTokens: 1000,
      cachedTokens: 500,
      outputTokens: 500,
      totalTokens: 2000,
      promptCostPerToken: 0.0000003,
      cachedCostPerToken: 0.00000003,
      outputCostPerToken: 0.0000025,
      durationMs: 2500,
      success: true,
      errorMessage: '',
    };

    const result = await logTokenUsage('spreadsheet123', data);

    expect(result.ok).toBe(true);
    expect(mockAppendRows).toHaveBeenCalledWith(
      'spreadsheet123',
      'Uso de API',
      [[
        timestampDate,
        '123e4567-e89b-12d3-a456-426614174000',
        'file123',
        'invoice.pdf',
        'gemini-2.5-flash',
        1000,
        500,
        500,
        0.0000003,
        0.00000003,
        0.0000025,
        '=F2*I2+G2*J2+H2*K2',
        2500,
        'YES',
        '',
      ]]
    );
  });
});
