/**
 * Tests for Token Usage Logger service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateCost, generateRequestId, logTokenUsage } from '../../../src/services/token-usage-logger.js';
import * as sheetsService from '../../../src/services/sheets.js';

// Mock sheets service
vi.mock('../../../src/services/sheets.js', () => ({
  appendRows: vi.fn(),
}));

describe('calculateCost', () => {
  it('should calculate cost for gemini-2.5-flash with only prompt tokens', () => {
    const cost = calculateCost('gemini-2.5-flash', 1000, 0);
    // $0.15 per 1M tokens = $0.00000015 per token
    // 1000 tokens * $0.00000015 = $0.00015
    expect(cost).toBe(0.00015);
  });

  it('should calculate cost for gemini-2.5-flash with only output tokens', () => {
    const cost = calculateCost('gemini-2.5-flash', 0, 500);
    // $0.60 per 1M tokens = $0.0000006 per token
    // 500 tokens * $0.0000006 = $0.0003
    expect(cost).toBe(0.0003);
  });

  it('should calculate cost for gemini-2.5-flash with both prompt and output tokens', () => {
    const cost = calculateCost('gemini-2.5-flash', 1000, 500);
    // Prompt: 1000 * $0.00000015 = $0.00015
    // Output: 500 * $0.0000006 = $0.0003
    // Total: $0.00045
    expect(cost).toBe(0.00045);
  });

  it('should handle zero tokens', () => {
    const cost = calculateCost('gemini-2.5-flash', 0, 0);
    expect(cost).toBe(0);
  });

  it('should handle large token counts', () => {
    const cost = calculateCost('gemini-2.5-flash', 1_000_000, 1_000_000);
    // Prompt: 1M * $0.00000015 = $0.15
    // Output: 1M * $0.0000006 = $0.60
    // Total: $0.75
    expect(cost).toBe(0.75);
  });

  it('should round to reasonable precision', () => {
    const cost = calculateCost('gemini-2.5-flash', 333, 777);
    // Prompt: 333 * $0.00000015 = $0.00004995
    // Output: 777 * $0.0000006 = $0.0004662
    // Total: $0.00051615
    expect(cost).toBeCloseTo(0.00051615, 8);
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
    const mockAppendRows = vi.mocked(sheetsService.appendRows);
    mockAppendRows.mockResolvedValue({ ok: true, value: undefined });

    const data = {
      timestamp: '2026-01-21T10:30:00.000Z',
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      fileId: 'file123',
      fileName: 'invoice.pdf',
      model: 'gemini-2.5-flash' as const,
      promptTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      estimatedCostUSD: 0.00045,
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
        '2026-01-21T10:30:00.000Z',
        '123e4567-e89b-12d3-a456-426614174000',
        'file123',
        'invoice.pdf',
        'gemini-2.5-flash',
        1000,
        500,
        1500,
        0.00045,
        2500,
        'YES',
        '',
      ]]
    );
  });

  it('should log failed API call with error message', async () => {
    const mockAppendRows = vi.mocked(sheetsService.appendRows);
    mockAppendRows.mockResolvedValue({ ok: true, value: undefined });

    const data = {
      timestamp: '2026-01-21T10:30:00.000Z',
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      fileId: 'file123',
      fileName: 'invoice.pdf',
      model: 'gemini-2.5-flash' as const,
      promptTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUSD: 0,
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
        '2026-01-21T10:30:00.000Z',
        '123e4567-e89b-12d3-a456-426614174000',
        'file123',
        'invoice.pdf',
        'gemini-2.5-flash',
        0,
        0,
        0,
        0,
        1000,
        'NO',
        'API rate limit exceeded',
      ]]
    );
  });

  it('should return error when appendRows fails', async () => {
    const mockAppendRows = vi.mocked(sheetsService.appendRows);
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
      outputTokens: 500,
      totalTokens: 1500,
      estimatedCostUSD: 0.00045,
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
    const mockAppendRows = vi.mocked(sheetsService.appendRows);
    mockAppendRows.mockResolvedValue({ ok: true, value: undefined });

    const data = {
      timestamp: '2026-01-21T10:30:00.000Z',
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      fileId: '',
      fileName: '',
      model: 'gemini-2.5-flash' as const,
      promptTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      estimatedCostUSD: 0.000045,
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
        '2026-01-21T10:30:00.000Z',
        '123e4567-e89b-12d3-a456-426614174000',
        '',
        '',
        'gemini-2.5-flash',
        100,
        50,
        150,
        0.000045,
        500,
        'YES',
        '',
      ]]
    );
  });
});
