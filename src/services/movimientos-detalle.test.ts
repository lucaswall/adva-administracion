/**
 * Tests for movimientos-detalle service
 * Handles batch updates of matchedFileId and detalle columns
 */

import { createHash } from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateDetalle, type DetalleUpdate } from './movimientos-detalle.js';

// Mock dependencies
vi.mock('./sheets.js', () => ({
  batchUpdate: vi.fn(),
  getValues: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { batchUpdate, getValues } from './sheets.js';

describe('updateDetalle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return success with 0 count for empty updates array', async () => {
    const result = await updateDetalle('spreadsheet-id', []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('should update columns G and H for a single row', async () => {
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

    const updates: DetalleUpdate[] = [
      {
        sheetName: '2025-01',
        rowNumber: 5,
        matchedFileId: 'file123',
        detalle: 'Cobro Factura de TEST SA',
      },
    ];

    const result = await updateDetalle('spreadsheet-id', updates);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }

    expect(batchUpdate).toHaveBeenCalledWith('spreadsheet-id', [
      {
        range: "'2025-01'!G5:H5",
        values: [['file123', 'Cobro Factura de TEST SA']],
      },
    ]);
  });

  it('should update multiple rows across different sheets', async () => {
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

    const updates: DetalleUpdate[] = [
      { sheetName: '2025-01', rowNumber: 5, matchedFileId: 'file1', detalle: 'Match 1' },
      { sheetName: '2025-01', rowNumber: 10, matchedFileId: 'file2', detalle: 'Match 2' },
      { sheetName: '2025-02', rowNumber: 3, matchedFileId: 'file3', detalle: 'Match 3' },
    ];

    const result = await updateDetalle('spreadsheet-id', updates);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(3);
    }

    expect(batchUpdate).toHaveBeenCalledWith('spreadsheet-id', [
      { range: "'2025-01'!G5:H5", values: [['file1', 'Match 1']] },
      { range: "'2025-01'!G10:H10", values: [['file2', 'Match 2']] },
      { range: "'2025-02'!G3:H3", values: [['file3', 'Match 3']] },
    ]);
  });

  it('should chunk updates when exceeding 500 operations', async () => {
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

    // Create 600 updates
    const updates: DetalleUpdate[] = [];
    for (let i = 0; i < 600; i++) {
      updates.push({
        sheetName: '2025-01',
        rowNumber: i + 2,
        matchedFileId: `file${i}`,
        detalle: `Match ${i}`,
      });
    }

    const result = await updateDetalle('spreadsheet-id', updates);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(600);
    }

    // Should have been called twice (500 + 100)
    expect(batchUpdate).toHaveBeenCalledTimes(2);

    // First call should have 500 updates
    const firstCall = vi.mocked(batchUpdate).mock.calls[0];
    expect(firstCall[1]).toHaveLength(500);

    // Second call should have 100 updates
    const secondCall = vi.mocked(batchUpdate).mock.calls[1];
    expect(secondCall[1]).toHaveLength(100);
  });

  it('should make 3 API calls for 1500 updates', async () => {
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

    // Create 1500 updates
    const updates: DetalleUpdate[] = [];
    for (let i = 0; i < 1500; i++) {
      updates.push({
        sheetName: '2025-01',
        rowNumber: i + 2,
        matchedFileId: `file${i}`,
        detalle: `Match ${i}`,
      });
    }

    const result = await updateDetalle('spreadsheet-id', updates);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1500);
    }

    // Should have been called three times (500 + 500 + 500)
    expect(batchUpdate).toHaveBeenCalledTimes(3);
  });

  it('should propagate error from batchUpdate', async () => {
    vi.mocked(batchUpdate).mockResolvedValue({
      ok: false,
      error: new Error('API quota exceeded'),
    });

    const updates: DetalleUpdate[] = [
      { sheetName: '2025-01', rowNumber: 5, matchedFileId: 'file1', detalle: 'Match 1' },
    ];

    const result = await updateDetalle('spreadsheet-id', updates);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('API quota exceeded');
    }
  });

  it('should stop processing on first chunk error', async () => {
    vi.mocked(batchUpdate)
      .mockResolvedValueOnce({ ok: true, value: 500 })
      .mockResolvedValueOnce({ ok: false, error: new Error('Second chunk failed') });

    // Create 600 updates (requires 2 chunks)
    const updates: DetalleUpdate[] = [];
    for (let i = 0; i < 600; i++) {
      updates.push({
        sheetName: '2025-01',
        rowNumber: i + 2,
        matchedFileId: `file${i}`,
        detalle: `Match ${i}`,
      });
    }

    const result = await updateDetalle('spreadsheet-id', updates);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Second chunk failed');
    }

    // Should have attempted 2 calls
    expect(batchUpdate).toHaveBeenCalledTimes(2);
  });

  it('should handle empty matchedFileId and detalle (clearing matches)', async () => {
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

    const updates: DetalleUpdate[] = [
      { sheetName: '2025-01', rowNumber: 5, matchedFileId: '', detalle: '' },
    ];

    const result = await updateDetalle('spreadsheet-id', updates);

    expect(result.ok).toBe(true);
    expect(batchUpdate).toHaveBeenCalledWith('spreadsheet-id', [
      { range: "'2025-01'!G5:H5", values: [['', '']] },
    ]);
  });

  it('should use correct range format with quoted sheet names', async () => {
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

    const updates: DetalleUpdate[] = [
      { sheetName: '2025-01', rowNumber: 5, matchedFileId: 'file1', detalle: 'Match' },
    ];

    await updateDetalle('spreadsheet-id', updates);

    const call = vi.mocked(batchUpdate).mock.calls[0];
    const ranges = call[1].map((u: { range: string }) => u.range);

    // Sheet name should be quoted in A1 notation
    expect(ranges[0]).toBe("'2025-01'!G5:H5");
  });

  it('should properly escape single quote in sheet name', async () => {
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

    const updates: DetalleUpdate[] = [
      {
        sheetName: "Sheet'Name",
        rowNumber: 5,
        matchedFileId: 'file123',
        detalle: 'Test',
      },
    ];

    const result = await updateDetalle('spreadsheet-id', updates);

    expect(result.ok).toBe(true);

    // Verify the range was called with properly escaped sheet name
    expect(batchUpdate).toHaveBeenCalledWith('spreadsheet-id', [
      {
        range: "'Sheet''Name'!G5:H5",
        values: [['file123', 'Test']],
      },
    ]);
  });

  it('should handle sheet names with spaces', async () => {
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

    const updates: DetalleUpdate[] = [
      {
        sheetName: "Sheet With Spaces",
        rowNumber: 3,
        matchedFileId: 'file456',
        detalle: 'Another Test',
      },
    ];

    const result = await updateDetalle('spreadsheet-id', updates);

    expect(result.ok).toBe(true);

    expect(batchUpdate).toHaveBeenCalledWith('spreadsheet-id', [
      {
        range: "'Sheet With Spaces'!G3:H3",
        values: [['file456', 'Another Test']],
      },
    ]);
  });

  it('should handle normal sheet names without modification', async () => {
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

    const updates: DetalleUpdate[] = [
      {
        sheetName: "2024-01",
        rowNumber: 2,
        matchedFileId: 'file789',
        detalle: 'Normal Sheet',
      },
    ];

    const result = await updateDetalle('spreadsheet-id', updates);

    expect(result.ok).toBe(true);

    expect(batchUpdate).toHaveBeenCalledWith('spreadsheet-id', [
      {
        range: "'2024-01'!G2:H2",
        values: [['file789', 'Normal Sheet']],
      },
    ]);
  });

  it('should correctly compute version hash with serial number dates in TOCTOU check', async () => {
    // computeVersionFromRow must normalize serial number dates so that the
    // version hash matches what computeRowVersion produces from the parsed
    // MovimientoRow (which gets fecha as a normalized date string).
    //
    // Row data: [45993, 'TRANSFERENCIA', 1000, null, null, null, '', '']
    // Serial 45993 => '2025-12-02'
    // Expected hash input: '2025-12-02|TRANSFERENCIA|1000|||'
    const expectedHashInput = '2025-12-02|TRANSFERENCIA|1000|||';
    const expectedVersion = createHash('md5').update(expectedHashInput).digest('hex').slice(0, 16);

    // Mock getValues to return a row with a serial number date
    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
        [45993, 'TRANSFERENCIA', 1000, null, null, null, '', ''],
      ],
    });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

    const updates: DetalleUpdate[] = [
      {
        sheetName: '2025-12',
        rowNumber: 2,
        matchedFileId: 'file-new',
        detalle: 'New match',
        expectedVersion,
      },
    ];

    const result = await updateDetalle('spreadsheet-id', updates);

    // If computeVersionFromRow normalizes the serial number correctly,
    // the version check passes and batchUpdate is called
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }
    expect(batchUpdate).toHaveBeenCalled();
  });

  it('should reject version mismatch when serial number is not normalized', async () => {
    // If someone computes a version using the raw serial string "45993"
    // instead of the normalized date, it should NOT match
    const wrongHashInput = '45993|TRANSFERENCIA|1000|||';
    const wrongVersion = createHash('md5').update(wrongHashInput).digest('hex').slice(0, 16);

    // The correct hash from normalized date
    const correctHashInput = '2025-12-02|TRANSFERENCIA|1000|||';
    const correctVersion = createHash('md5').update(correctHashInput).digest('hex').slice(0, 16);

    // Ensure the two versions are actually different
    expect(wrongVersion).not.toBe(correctVersion);

    vi.mocked(getValues).mockResolvedValue({
      ok: true,
      value: [
        ['fecha', 'concepto', 'debito', 'credito', 'saldo', 'saldoCalculado', 'matchedFileId', 'detalle'],
        [45993, 'TRANSFERENCIA', 1000, null, null, null, '', ''],
      ],
    });
    vi.mocked(batchUpdate).mockResolvedValue({ ok: true, value: 1 });

    const updates: DetalleUpdate[] = [
      {
        sheetName: '2025-12',
        rowNumber: 2,
        matchedFileId: 'file-new',
        detalle: 'New match',
        expectedVersion: wrongVersion,
      },
    ];

    const result = await updateDetalle('spreadsheet-id', updates);

    // Version mismatch → update skipped, but still "ok" (just 0 rows updated)
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
    // batchUpdate should NOT be called since all updates were skipped
    expect(batchUpdate).not.toHaveBeenCalled();
  });
});
