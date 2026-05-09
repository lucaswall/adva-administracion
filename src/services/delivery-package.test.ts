/**
 * Tests for delivery-package service
 * Covers: parsePeriodRange, enumerateResumenes, enumerateMovimientos,
 *         formatDeliveryFolderName, prepareDeliveryFolder, copyPdfsToDelivery,
 *         buildMovimientosWorkbook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('./sheets.js', () => ({
  getValues: vi.fn(),
  getSheetMetadata: vi.fn(),
  createSheet: vi.fn(),
  appendRowsWithLinks: vi.fn(),
  formatSheet: vi.fn(),
  deleteSheet: vi.fn(),
  renameSheet: vi.fn(),
  columnIndexToLetter: (index: number): string => {
    let result = '';
    let remaining = index;
    while (remaining > 0) {
      const digit = (remaining - 1) % 26;
      result = String.fromCharCode(65 + digit) + result;
      remaining = Math.floor((remaining - 1) / 26);
    }
    return result;
  },
}));

vi.mock('./drive.js', () => ({
  findByName: vi.fn(),
  createFolder: vi.fn(),
  listByMimeType: vi.fn(),
  listAllChildren: vi.fn(),
  deleteFileById: vi.fn(),
  copyFile: vi.fn(),
  createSpreadsheet: vi.fn(),
  renameFile: vi.fn(),
}));

vi.mock('./folder-structure.js', () => ({
  discoverMovimientosSpreadsheets: vi.fn(),
  validateYear: vi.fn((year: string) => {
    const n = parseInt(year, 10);
    if (Number.isNaN(n) || n < 2000 || n > 2100) {
      return { ok: false as const, error: new Error('Invalid year') };
    }
    return { ok: true as const, value: n };
  }),
}));

vi.mock('./movimientos-reader.js', () => ({
  readMovimientosForPeriod: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  parsePeriodRange,
  enumerateResumenes,
  enumerateMovimientos,
  formatDeliveryFolderName,
  prepareDeliveryFolder,
  copyPdfsToDelivery,
  buildMovimientosWorkbook,
  type ResumenScopeItem,
  type MovimientoScopeItem,
} from './delivery-package.js';

import {
  getValues,
  getSheetMetadata,
  createSheet,
  appendRowsWithLinks,
  formatSheet,
  deleteSheet,
  renameSheet,
  type CellValue,
} from './sheets.js';

import {
  findByName,
  createFolder,
  listByMimeType,
  listAllChildren,
  deleteFileById,
  copyFile,
  createSpreadsheet,
  renameFile,
} from './drive.js';

import { discoverMovimientosSpreadsheets } from './folder-structure.js';
import { readMovimientosForPeriod } from './movimientos-reader.js';

// ── Helper ────────────────────────────────────────────────────────────────────

function ok<T>(value: T) {
  return { ok: true as const, value };
}

function err(message: string) {
  return { ok: false as const, error: new Error(message) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 1: parsePeriodRange
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePeriodRange', () => {
  describe('valid single month', () => {
    it('returns from === to for a single YYYY-MM', () => {
      const result = parsePeriodRange('2025-01');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ from: '2025-01', to: '2025-01' });
      }
    });

    it('accepts boundary month 12', () => {
      const result = parsePeriodRange('2025-12');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ from: '2025-12', to: '2025-12' });
      }
    });

    it('accepts year 2000 (lower bound)', () => {
      const result = parsePeriodRange('2000-01');
      expect(result.ok).toBe(true);
    });

    it('accepts year 2100 (upper bound)', () => {
      const result = parsePeriodRange('2100-12');
      expect(result.ok).toBe(true);
    });
  });

  describe('valid range', () => {
    it('returns correct from/to for range', () => {
      const result = parsePeriodRange('2025-01..2025-03');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ from: '2025-01', to: '2025-03' });
      }
    });

    it('accepts range crossing year boundary', () => {
      const result = parsePeriodRange('2024-11..2025-02');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ from: '2024-11', to: '2025-02' });
      }
    });

    it('accepts same-month range (from === to)', () => {
      const result = parsePeriodRange('2025-03..2025-03');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ from: '2025-03', to: '2025-03' });
      }
    });
  });

  describe('invalid format', () => {
    it('rejects empty string', () => {
      const result = parsePeriodRange('');
      expect(result.ok).toBe(false);
    });

    it('rejects whitespace-only string', () => {
      const result = parsePeriodRange('   ');
      expect(result.ok).toBe(false);
    });

    it('rejects missing month (only year)', () => {
      const result = parsePeriodRange('2025');
      expect(result.ok).toBe(false);
    });

    it('rejects wrong separator (dash between periods)', () => {
      const result = parsePeriodRange('2025-01-2025-03');
      expect(result.ok).toBe(false);
    });

    it('rejects wrong separator (space "to")', () => {
      const result = parsePeriodRange('2025-01 to 2025-03');
      expect(result.ok).toBe(false);
    });

    it('rejects leading spaces', () => {
      const result = parsePeriodRange(' 2025-01');
      expect(result.ok).toBe(false);
    });

    it('rejects trailing spaces', () => {
      const result = parsePeriodRange('2025-01 ');
      expect(result.ok).toBe(false);
    });

    it('rejects single-dot separator', () => {
      const result = parsePeriodRange('2025-01.2025-03');
      expect(result.ok).toBe(false);
    });
  });

  describe('invalid month', () => {
    it('rejects month 00', () => {
      const result = parsePeriodRange('2025-00');
      expect(result.ok).toBe(false);
    });

    it('rejects month 13', () => {
      const result = parsePeriodRange('2025-13');
      expect(result.ok).toBe(false);
    });

    it('rejects month 00 in range to', () => {
      const result = parsePeriodRange('2025-01..2025-00');
      expect(result.ok).toBe(false);
    });

    it('rejects month 13 in range to', () => {
      const result = parsePeriodRange('2025-01..2025-13');
      expect(result.ok).toBe(false);
    });
  });

  describe('invalid year', () => {
    it('rejects 3-digit year', () => {
      const result = parsePeriodRange('999-01');
      expect(result.ok).toBe(false);
    });

    it('rejects year 9999 (above 2100)', () => {
      const result = parsePeriodRange('9999-01');
      expect(result.ok).toBe(false);
    });

    it('rejects year 1999 (below 2000)', () => {
      const result = parsePeriodRange('1999-01');
      expect(result.ok).toBe(false);
    });
  });

  describe('inverted range', () => {
    it('rejects range where to < from with Spanish message', () => {
      const result = parsePeriodRange('2025-03..2025-01');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Error message must be in Spanish and user-facing
        expect(result.error.message).toMatch(/inválido|anterior|final/i);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2: enumerateResumenes
// ─────────────────────────────────────────────────────────────────────────────

describe('enumerateResumenes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Header rows for each schema (lower-cased to match function's normalization)
  const bancarioHeaders = [
    'periodo','fechaDesde','fechaHasta','fileId','fileName',
    'banco','numeroCuenta','moneda','saldoInicial','saldoFinal','balanceOk','balanceDiff',
  ];
  const tarjetaHeaders = [
    'periodo','fechaDesde','fechaHasta','fileId','fileName',
    'banco','numeroCuenta','tipoTarjeta','pagoMinimo','saldoActual',
  ];
  const brokerHeaders = [
    'periodo','fechaDesde','fechaHasta','fileId','fileName',
    'broker','numeroCuenta','saldoARS','saldoUSD',
  ];

  /**
   * Sets up mocks for a folder hierarchy:
   *  ROOT/{year}/Bancos/{account}/Control de Resumenes
   * `accounts` is a map: yearFolderId -> [{ name, sheetId, headers, rows }]
   */
  type AccountFixture = {
    name: string;
    sheetId: string | null;
    headers: string[];
    rows: CellValue[][];
    readError?: string;
  };
  function setupHierarchy(years: Array<{
    yearName: string;
    yearId: string;
    bancosId: string | null;
    accounts: AccountFixture[];
  }>) {
    // Root listByMimeType returns year folders
    vi.mocked(listByMimeType).mockImplementation(async (folderId: string, _mime: string) => {
      // Root folder lookup
      if (folderId === 'root-id') {
        return ok(years.map(y => ({ id: y.yearId, name: y.yearName, mimeType: 'application/vnd.google-apps.folder' })));
      }
      // Bancos folder lookup → list account folders
      const yearWithThisBancos = years.find(y => y.bancosId === folderId);
      if (yearWithThisBancos) {
        return ok(yearWithThisBancos.accounts.map((a, i) => ({
          id: `${yearWithThisBancos.yearId}:acc-${i}`,
          name: a.name,
          mimeType: 'application/vnd.google-apps.folder',
        })));
      }
      return ok([]);
    });

    // findByName: handles Bancos lookup and Control de Resumenes lookup
    vi.mocked(findByName).mockImplementation(async (parentId: string, name: string, _mime?: string) => {
      // Bancos folder under a year
      if (name === 'Bancos') {
        const year = years.find(y => y.yearId === parentId);
        if (!year) return ok(null);
        if (year.bancosId === null) return ok(null);
        return ok({ id: year.bancosId, name: 'Bancos', mimeType: 'application/vnd.google-apps.folder' });
      }
      // Control de Resumenes spreadsheet under an account folder
      if (name === 'Control de Resumenes') {
        for (const year of years) {
          const idx = year.accounts.findIndex((_, i) => `${year.yearId}:acc-${i}` === parentId);
          if (idx >= 0) {
            const acc = year.accounts[idx];
            if (acc.sheetId === null) return ok(null);
            return ok({ id: acc.sheetId, name: 'Control de Resumenes', mimeType: 'application/vnd.google-apps.spreadsheet' });
          }
        }
        return ok(null);
      }
      return ok(null);
    });

    // getValues: keyed by sheetId
    vi.mocked(getValues).mockImplementation(async (id: string, _range: string) => {
      for (const year of years) {
        for (const acc of year.accounts) {
          if (acc.sheetId === id) {
            if (acc.readError) return err(acc.readError);
            if (acc.rows.length === 0 && acc.headers.length === 0) return ok([]);
            return ok([[...acc.headers], ...acc.rows]);
          }
        }
      }
      return ok([]);
    });
  }

  it('returns empty array when no year folders exist', async () => {
    setupHierarchy([]);
    const result = await enumerateResumenes('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('returns empty array when all per-account sheets are empty', async () => {
    setupHierarchy([
      {
        yearName: '2025', yearId: 'year-2025', bancosId: 'bancos-2025',
        accounts: [
          { name: 'BBVA 1234567890 ARS', sheetId: 'sh-bbva', headers: bancarioHeaders, rows: [] },
        ],
      },
    ]);
    const result = await enumerateResumenes('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('includes periods inside range and excludes outside', async () => {
    setupHierarchy([
      {
        yearName: '2025', yearId: 'year-2025', bancosId: 'bancos-2025',
        accounts: [
          {
            name: 'BBVA 1234567890 ARS', sheetId: 'sh-bbva', headers: bancarioHeaders,
            rows: [
              ['2024-12', '2024-12-01', '2024-12-31', 'fid-dec', 'dec.pdf', 'BBVA', '1234', 'ARS', 0, 0, true, 0],
              ['2025-01', '2025-01-01', '2025-01-31', 'fid-jan', 'jan.pdf', 'BBVA', '1234', 'ARS', 0, 0, true, 0],
              ['2025-04', '2025-04-01', '2025-04-30', 'fid-apr', 'apr.pdf', 'BBVA', '1234', 'ARS', 0, 0, true, 0],
            ],
          },
        ],
      },
    ]);
    const result = await enumerateResumenes('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({ fileId: 'fid-jan', type: 'bancario', periodo: '2025-01' });
    }
  });

  it('includes boundaries (from and to inclusive)', async () => {
    setupHierarchy([
      {
        yearName: '2025', yearId: 'year-2025', bancosId: 'bancos-2025',
        accounts: [
          {
            name: 'BBVA 1234567890 ARS', sheetId: 'sh-bbva', headers: bancarioHeaders,
            rows: [
              ['2025-01', '', '', 'fid-jan', 'jan.pdf', '', '', '', 0, 0, true, 0],
              ['2025-03', '', '', 'fid-mar', 'mar.pdf', '', '', '', 0, 0, true, 0],
            ],
          },
        ],
      },
    ]);
    const result = await enumerateResumenes('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  it('skips header row (uses header-based column lookup)', async () => {
    setupHierarchy([
      {
        yearName: '2025', yearId: 'year-2025', bancosId: 'bancos-2025',
        accounts: [
          {
            name: 'BBVA 1234567890 ARS', sheetId: 'sh-bbva', headers: bancarioHeaders,
            rows: [['2025-02', '', '', 'fid-feb', 'feb.pdf', '', '', '', 0, 0, true, 0]],
          },
        ],
      },
    ]);
    const result = await enumerateResumenes('2025-01', '2025-12', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].fileId).toBe('fid-feb');
    }
  });

  it('aggregates mixed account types correctly (bank + 2 cards + broker)', async () => {
    setupHierarchy([
      {
        yearName: '2025', yearId: 'year-2025', bancosId: 'bancos-2025',
        accounts: [
          {
            name: 'BBVA 1234567890 ARS', sheetId: 'sh-bank', headers: bancarioHeaders,
            rows: [['2025-01', '', '', 'fid-bank', 'bank.pdf', '', '', '', 0, 0, true, 0]],
          },
          {
            name: 'BBVA Visa 4563', sheetId: 'sh-card1', headers: tarjetaHeaders,
            rows: [['2025-01', '', '', 'fid-card1', 'card1.pdf', '', '', 'Visa', 0, 0]],
          },
          {
            name: 'BBVA Mastercard 9876', sheetId: 'sh-card2', headers: tarjetaHeaders,
            rows: [['2025-02', '', '', 'fid-card2', 'card2.pdf', '', '', 'Mastercard', 0, 0]],
          },
          {
            name: 'BALANZ CAPITAL VALORES SAU 123456', sheetId: 'sh-brok', headers: brokerHeaders,
            rows: [['2025-01', '', '', 'fid-brok', 'brok.pdf', '', '', 0, 0]],
          },
        ],
      },
    ]);
    const result = await enumerateResumenes('2025-01', '2025-02', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(4);
      const types = result.value.map(i => i.type);
      expect(types.filter(t => t === 'bancario')).toHaveLength(1);
      expect(types.filter(t => t === 'tarjeta')).toHaveLength(2);
      expect(types.filter(t => t === 'broker')).toHaveLength(1);
    }
  });

  it('single-month range returns only that period', async () => {
    setupHierarchy([
      {
        yearName: '2025', yearId: 'year-2025', bancosId: 'bancos-2025',
        accounts: [
          {
            name: 'BBVA 1234567890 ARS', sheetId: 'sh-bbva', headers: bancarioHeaders,
            rows: [
              ['2025-01', '', '', 'fid-jan', 'jan.pdf', '', '', '', 0, 0, true, 0],
              ['2025-02', '', '', 'fid-feb', 'feb.pdf', '', '', '', 0, 0, true, 0],
            ],
          },
        ],
      },
    ]);
    const result = await enumerateResumenes('2025-01', '2025-01', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].periodo).toBe('2025-01');
    }
  });

  it('walks multiple years (range crossing year boundary)', async () => {
    setupHierarchy([
      {
        yearName: '2024', yearId: 'year-2024', bancosId: 'bancos-2024',
        accounts: [
          {
            name: 'BBVA 1234567890 ARS', sheetId: 'sh-2024', headers: bancarioHeaders,
            rows: [
              ['2024-11', '', '', 'fid-2024-11', 'nov.pdf', '', '', '', 0, 0, true, 0],
              ['2024-12', '', '', 'fid-2024-12', 'dec.pdf', '', '', '', 0, 0, true, 0],
            ],
          },
        ],
      },
      {
        yearName: '2025', yearId: 'year-2025', bancosId: 'bancos-2025',
        accounts: [
          {
            name: 'BBVA 1234567890 ARS', sheetId: 'sh-2025', headers: bancarioHeaders,
            rows: [
              ['2025-01', '', '', 'fid-2025-01', 'jan.pdf', '', '', '', 0, 0, true, 0],
              ['2025-02', '', '', 'fid-2025-02', 'feb.pdf', '', '', '', 0, 0, true, 0],
            ],
          },
        ],
      },
    ]);
    const result = await enumerateResumenes('2024-11', '2025-02', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(4);
      const fileIds = result.value.map(i => i.fileId).sort();
      expect(fileIds).toEqual(['fid-2024-11', 'fid-2024-12', 'fid-2025-01', 'fid-2025-02']);
    }
  });

  it('skips year folders that do not validate as a year', async () => {
    setupHierarchy([
      { yearName: 'Entrada', yearId: 'entrada-id', bancosId: null, accounts: [] },
      {
        yearName: '2025', yearId: 'year-2025', bancosId: 'bancos-2025',
        accounts: [
          {
            name: 'BBVA 1234567890 ARS', sheetId: 'sh-bbva', headers: bancarioHeaders,
            rows: [['2025-01', '', '', 'fid-jan', 'jan.pdf', '', '', '', 0, 0, true, 0]],
          },
        ],
      },
    ]);
    const result = await enumerateResumenes('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('skips a year that has no Bancos folder', async () => {
    setupHierarchy([
      { yearName: '2024', yearId: 'year-2024', bancosId: null, accounts: [] },
      {
        yearName: '2025', yearId: 'year-2025', bancosId: 'bancos-2025',
        accounts: [
          {
            name: 'BBVA 1234567890 ARS', sheetId: 'sh-bbva', headers: bancarioHeaders,
            rows: [['2025-01', '', '', 'fid-jan', 'jan.pdf', '', '', '', 0, 0, true, 0]],
          },
        ],
      },
    ]);
    const result = await enumerateResumenes('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('skips an account whose Control de Resumenes spreadsheet is missing', async () => {
    setupHierarchy([
      {
        yearName: '2025', yearId: 'year-2025', bancosId: 'bancos-2025',
        accounts: [
          { name: 'BBVA 1234567890 ARS', sheetId: null, headers: [], rows: [] },
          {
            name: 'BBVA Visa 4563', sheetId: 'sh-card', headers: tarjetaHeaders,
            rows: [['2025-01', '', '', 'fid-card', 'card.pdf', '', '', 'Visa', 0, 0]],
          },
        ],
      },
    ]);
    const result = await enumerateResumenes('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].type).toBe('tarjeta');
    }
  });

  it('skips an account whose Resumenes read fails (warns + continues)', async () => {
    setupHierarchy([
      {
        yearName: '2025', yearId: 'year-2025', bancosId: 'bancos-2025',
        accounts: [
          {
            name: 'BBVA 1234567890 ARS', sheetId: 'sh-bbva', headers: bancarioHeaders,
            rows: [], readError: 'Drive API error',
          },
          {
            name: 'BBVA Visa 4563', sheetId: 'sh-card', headers: tarjetaHeaders,
            rows: [['2025-01', '', '', 'fid-card', 'card.pdf', '', '', 'Visa', 0, 0]],
          },
        ],
      },
    ]);
    const result = await enumerateResumenes('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].fileId).toBe('fid-card');
    }
  });

  it('returns Result.err when listing year folders fails (top-level discovery)', async () => {
    vi.mocked(listByMimeType).mockResolvedValueOnce(err('Drive root listing failed'));
    const result = await enumerateResumenes('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3: enumerateMovimientos
// ─────────────────────────────────────────────────────────────────────────────

describe('enumerateMovimientos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no spreadsheets discovered', async () => {
    vi.mocked(discoverMovimientosSpreadsheets).mockResolvedValue(ok(new Map()));
    const result = await enumerateMovimientos('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('enumerates months for each account across range', async () => {
    const spreadsheets = new Map([
      ['2025:BBVA 1234567890 ARS', 'ssid-bbva'],
    ]);
    vi.mocked(discoverMovimientosSpreadsheets).mockResolvedValue(ok(spreadsheets));
    vi.mocked(getSheetMetadata).mockResolvedValue(ok([
      { title: '2025-01', sheetId: 1, index: 0 },
      { title: '2025-02', sheetId: 2, index: 1 },
      { title: '2025-03', sheetId: 3, index: 2 },
      { title: '2025-04', sheetId: 4, index: 3 }, // outside range
      { title: 'Movimientos', sheetId: 5, index: 4 }, // non-YYYY-MM
    ]));

    const result = await enumerateMovimientos('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      const months = result.value.map(i => i.sheetName);
      expect(months).toContain('2025-01');
      expect(months).toContain('2025-02');
      expect(months).toContain('2025-03');
      expect(months).not.toContain('2025-04');
    }
  });

  it('parses banco/numeroCuenta/moneda from key', async () => {
    const spreadsheets = new Map([
      ['2025:BBVA 1234567890 ARS', 'ssid-bbva'],
    ]);
    vi.mocked(discoverMovimientosSpreadsheets).mockResolvedValue(ok(spreadsheets));
    vi.mocked(getSheetMetadata).mockResolvedValue(ok([
      { title: '2025-01', sheetId: 1, index: 0 },
    ]));

    const result = await enumerateMovimientos('2025-01', '2025-01', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]).toMatchObject({
        banco: 'BBVA',
        numeroCuenta: '1234567890',
        moneda: 'ARS',
        sheetName: '2025-01',
        spreadsheetId: 'ssid-bbva',
      });
    }
  });

  it('handles range crossing year boundary — walks both year folders', async () => {
    const spreadsheets = new Map([
      ['2024:BBVA 1234567890 ARS', 'ssid-2024'],
      ['2025:BBVA 1234567890 ARS', 'ssid-2025'],
    ]);
    vi.mocked(discoverMovimientosSpreadsheets).mockResolvedValue(ok(spreadsheets));
    vi.mocked(getSheetMetadata).mockImplementation(async (ssid: string) => {
      if (ssid === 'ssid-2024') {
        return ok([
          { title: '2024-11', sheetId: 1, index: 0 },
          { title: '2024-12', sheetId: 2, index: 1 },
        ]);
      }
      return ok([
        { title: '2025-01', sheetId: 3, index: 0 },
        { title: '2025-02', sheetId: 4, index: 1 },
      ]);
    });

    const result = await enumerateMovimientos('2024-11', '2025-02', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const months = result.value.map(i => i.sheetName);
      expect(months).toContain('2024-11');
      expect(months).toContain('2024-12');
      expect(months).toContain('2025-01');
      expect(months).toContain('2025-02');
    }
  });

  it('skips months without corresponding tab (silently)', async () => {
    const spreadsheets = new Map([
      ['2025:BBVA 1234567890 ARS', 'ssid-bbva'],
    ]);
    vi.mocked(discoverMovimientosSpreadsheets).mockResolvedValue(ok(spreadsheets));
    // Only has 2025-01, not 2025-02 or 2025-03
    vi.mocked(getSheetMetadata).mockResolvedValue(ok([
      { title: '2025-01', sheetId: 1, index: 0 },
    ]));

    const result = await enumerateMovimientos('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].sheetName).toBe('2025-01');
    }
  });

  it('single-month range yields one tab per matching account', async () => {
    const spreadsheets = new Map([
      ['2025:BBVA 1234567890 ARS', 'ssid-bbva'],
      ['2025:GALICIA 9876543210 ARS', 'ssid-galicia'],
    ]);
    vi.mocked(discoverMovimientosSpreadsheets).mockResolvedValue(ok(spreadsheets));
    vi.mocked(getSheetMetadata).mockResolvedValue(ok([
      { title: '2025-01', sheetId: 1, index: 0 },
      { title: '2025-02', sheetId: 2, index: 1 },
    ]));

    const result = await enumerateMovimientos('2025-01', '2025-01', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2); // one per account
      expect(result.value.every(i => i.sheetName === '2025-01')).toBe(true);
    }
  });

  it('skips account when getSheetMetadata fails, continues others, returns ok', async () => {
    const spreadsheets = new Map([
      ['2025:BBVA 1234567890 ARS', 'ssid-bbva'],
      ['2025:GALICIA 9876543210 ARS', 'ssid-galicia'],
    ]);
    vi.mocked(discoverMovimientosSpreadsheets).mockResolvedValue(ok(spreadsheets));
    vi.mocked(getSheetMetadata).mockImplementation(async (ssid: string) => {
      if (ssid === 'ssid-bbva') return err('API error for BBVA');
      return ok([{ title: '2025-01', sheetId: 1, index: 0 }]);
    });

    const result = await enumerateMovimientos('2025-01', '2025-01', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // GALICIA account still processed
      expect(result.value).toHaveLength(1);
      expect(result.value[0].banco).toBe('GALICIA');
    }
  });

  it('returns err when discoverMovimientosSpreadsheets fails', async () => {
    vi.mocked(discoverMovimientosSpreadsheets).mockResolvedValue(err('Discovery failed'));
    const result = await enumerateMovimientos('2025-01', '2025-03', 'root-id');
    expect(result.ok).toBe(false);
  });

  it('skips non-bank movimientos spreadsheets (credit cards, brokers)', async () => {
    // Codex P2: card/broker Movimientos sheets have a different schema.
    // readMovimientosForPeriod returns [] for them, so without filtering we
    // would create empty placeholder tabs in the delivery workbook.
    const spreadsheets = new Map([
      ['2025:BBVA 1234567890 ARS', 'ssid-bank'],
      ['2025:BBVA Visa 4563', 'ssid-card'],
      ['2025:BALANZ CAPITAL VALORES SAU 123456', 'ssid-broker'],
    ]);
    vi.mocked(discoverMovimientosSpreadsheets).mockResolvedValue(ok(spreadsheets));
    vi.mocked(getSheetMetadata).mockResolvedValue(ok([
      { title: '2025-01', sheetId: 1, index: 0 },
    ]));

    const result = await enumerateMovimientos('2025-01', '2025-01', 'root-id');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].spreadsheetId).toBe('ssid-bank');
      expect(result.value[0].banco).toBe('BBVA');
      expect(result.value[0].moneda).toBe('ARS');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 5: formatDeliveryFolderName + prepareDeliveryFolder
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDeliveryFolderName', () => {
  it('produces single-month form when from === to', () => {
    const name = formatDeliveryFolderName({
      from: '2025-01',
      to: '2025-01',
      deliveryDate: new Date('2025-05-08T12:00:00Z'),
    });
    expect(name).toBe('2025-01 (entregado 2025-05-08)');
  });

  it('produces range form when from !== to', () => {
    const name = formatDeliveryFolderName({
      from: '2025-01',
      to: '2025-03',
      deliveryDate: new Date('2025-05-08T12:00:00Z'),
    });
    expect(name).toBe('2025-01 al 2025-03 (entregado 2025-05-08)');
  });

  it('uses the delivery date in the output', () => {
    const name = formatDeliveryFolderName({
      from: '2025-06',
      to: '2025-09',
      deliveryDate: new Date('2025-12-31T12:00:00Z'),
    });
    expect(name).toContain('2025-12-31');
  });
});

describe('prepareDeliveryFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ROOT_ID = 'root-folder-id';
  const DELIVERY_DATE = new Date('2025-05-08T12:00:00Z');
  const FOLDER_NAME = '2025-01 (entregado 2025-05-08)';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

  it('creates Entregas/ folder if missing, then creates period folder — isReuse: false', async () => {
    vi.mocked(findByName).mockResolvedValueOnce(ok(null));  // Entregas/ not found
    vi.mocked(createFolder)
      .mockResolvedValueOnce(ok({ id: 'entregas-id', name: 'Entregas', mimeType: FOLDER_MIME }))
      .mockResolvedValueOnce(ok({ id: 'period-id', name: FOLDER_NAME, mimeType: FOLDER_MIME }));
    vi.mocked(listByMimeType).mockResolvedValue(ok([])); // no existing delivery folders under Entregas

    const result = await prepareDeliveryFolder(ROOT_ID, FOLDER_NAME, DELIVERY_DATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.folderId).toBe('period-id');
      expect(result.value.folderUrl).toBe('https://drive.google.com/drive/folders/period-id');
      expect(result.value.isReuse).toBe(false);
    }
  });

  it('reuses existing Entregas/ folder without duplicating it', async () => {
    vi.mocked(findByName).mockResolvedValueOnce(
      ok({ id: 'existing-entregas-id', name: 'Entregas', mimeType: FOLDER_MIME })
    );
    vi.mocked(listByMimeType).mockResolvedValue(ok([])); // no existing delivery folders
    vi.mocked(createFolder).mockResolvedValueOnce(
      ok({ id: 'period-id', name: FOLDER_NAME, mimeType: FOLDER_MIME })
    );

    const result = await prepareDeliveryFolder(ROOT_ID, FOLDER_NAME, DELIVERY_DATE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.isReuse).toBe(false);
    // createFolder called once only (for period, not Entregas)
    expect(createFolder).toHaveBeenCalledTimes(1);
  });

  it('re-delivery same day: finds folder by exact name, deletes ALL children, returns isReuse: true', async () => {
    // Codex P2: re-delivery must clear every file, not just PDFs and Sheets.
    // The delivery folder is documented as operation-owned: any leftover file
    // (image, doc, zip, manual note) from the previous run survives without
    // this guarantee.
    vi.mocked(findByName).mockResolvedValueOnce(
      ok({ id: 'entregas-id', name: 'Entregas', mimeType: FOLDER_MIME })
    );
    vi.mocked(listByMimeType).mockImplementation(async (folderId: string, mime: string) => {
      // Listing folders under Entregas
      if (folderId === 'entregas-id' && mime === FOLDER_MIME) {
        return ok([{ id: 'period-id', name: FOLDER_NAME, mimeType: FOLDER_MIME }]);
      }
      return ok([]);
    });
    vi.mocked(listAllChildren).mockImplementation(async (folderId: string) => {
      if (folderId === 'period-id') {
        return ok([
          { id: 'pdf1', name: 'resumen1.pdf', mimeType: 'application/pdf' },
          { id: 'pdf2', name: 'resumen2.pdf', mimeType: 'application/pdf' },
          { id: 'sheet1', name: 'Movimientos', mimeType: SHEET_MIME },
          { id: 'note1', name: 'manual-note.txt', mimeType: 'text/plain' },
          { id: 'img1', name: 'screenshot.png', mimeType: 'image/png' },
        ]);
      }
      return ok([]);
    });
    vi.mocked(deleteFileById).mockResolvedValue(ok(undefined));

    const result = await prepareDeliveryFolder(ROOT_ID, FOLDER_NAME, DELIVERY_DATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.folderId).toBe('period-id');
      expect(result.value.isReuse).toBe(true);
    }
    // Every child must be deleted, regardless of MIME type
    expect(deleteFileById).toHaveBeenCalledTimes(5);
    expect(deleteFileById).toHaveBeenCalledWith('pdf1');
    expect(deleteFileById).toHaveBeenCalledWith('pdf2');
    expect(deleteFileById).toHaveBeenCalledWith('sheet1');
    expect(deleteFileById).toHaveBeenCalledWith('note1');
    expect(deleteFileById).toHaveBeenCalledWith('img1');
  });

  it('re-delivery on different day: matches by period prefix and renames folder to new date', async () => {
    const PRIOR_NAME = '2025-01 (entregado 2025-05-07)'; // delivered yesterday
    vi.mocked(findByName).mockResolvedValueOnce(
      ok({ id: 'entregas-id', name: 'Entregas', mimeType: FOLDER_MIME })
    );
    vi.mocked(listByMimeType).mockImplementation(async (folderId: string, mime: string) => {
      if (folderId === 'entregas-id' && mime === FOLDER_MIME) {
        return ok([{ id: 'period-id', name: PRIOR_NAME, mimeType: FOLDER_MIME }]);
      }
      return ok([]);
    });
    vi.mocked(listAllChildren).mockResolvedValue(ok([]));
    vi.mocked(deleteFileById).mockResolvedValue(ok(undefined));
    vi.mocked(renameFile).mockResolvedValue(ok(undefined));

    const result = await prepareDeliveryFolder(ROOT_ID, FOLDER_NAME, DELIVERY_DATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.folderId).toBe('period-id');
      expect(result.value.isReuse).toBe(true);
    }
    // Folder renamed to today's name
    expect(renameFile).toHaveBeenCalledWith('period-id', FOLDER_NAME);
  });

  it('does not match a different period (e.g. 2025-10 should not match 2025-01 prefix)', async () => {
    vi.mocked(findByName).mockResolvedValueOnce(
      ok({ id: 'entregas-id', name: 'Entregas', mimeType: FOLDER_MIME })
    );
    vi.mocked(listByMimeType).mockResolvedValue(ok([
      { id: 'wrong-period', name: '2025-10 (entregado 2025-05-08)', mimeType: FOLDER_MIME },
    ]));
    vi.mocked(createFolder).mockResolvedValueOnce(
      ok({ id: 'new-period-id', name: FOLDER_NAME, mimeType: FOLDER_MIME })
    );

    const result = await prepareDeliveryFolder(ROOT_ID, FOLDER_NAME, DELIVERY_DATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.folderId).toBe('new-period-id');
      expect(result.value.isReuse).toBe(false);
    }
    expect(deleteFileById).not.toHaveBeenCalled();
  });

  it('delivery folder itself is NOT deleted — only contents', async () => {
    vi.mocked(findByName).mockResolvedValueOnce(
      ok({ id: 'entregas-id', name: 'Entregas', mimeType: FOLDER_MIME })
    );
    vi.mocked(listByMimeType).mockImplementation(async (folderId: string, mime: string) => {
      if (folderId === 'entregas-id' && mime === FOLDER_MIME) {
        return ok([{ id: 'period-id', name: FOLDER_NAME, mimeType: FOLDER_MIME }]);
      }
      return ok([]); // no contents
    });
    vi.mocked(listAllChildren).mockResolvedValue(ok([])); // empty period folder

    const result = await prepareDeliveryFolder(ROOT_ID, FOLDER_NAME, DELIVERY_DATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.folderId).toBe('period-id');
      expect(result.value.isReuse).toBe(true);
    }
    expect(deleteFileById).not.toHaveBeenCalledWith('period-id');
  });

  it('does NOT match a multi-month folder when re-delivering a single month with the same starting period', async () => {
    // BUG: a startsWith("2025-01 ") check would incorrectly match
    // "2025-01 al 2025-12 (entregado ...)". The fix anchors the comparison
    // to the full period token via extractPeriodPrefix.
    vi.mocked(findByName).mockResolvedValueOnce(
      ok({ id: 'entregas-id', name: 'Entregas', mimeType: FOLDER_MIME })
    );
    vi.mocked(listByMimeType).mockResolvedValue(ok([
      {
        id: 'multi-month-id',
        name: '2025-01 al 2025-12 (entregado 2025-05-01)',
        mimeType: FOLDER_MIME,
      },
    ]));
    vi.mocked(createFolder).mockResolvedValueOnce(
      ok({ id: 'new-period-id', name: FOLDER_NAME, mimeType: FOLDER_MIME })
    );

    const result = await prepareDeliveryFolder(ROOT_ID, FOLDER_NAME, DELIVERY_DATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.folderId).toBe('new-period-id');
      expect(result.value.isReuse).toBe(false);
    }
    // The multi-month folder must remain untouched
    expect(deleteFileById).not.toHaveBeenCalled();
    expect(renameFile).not.toHaveBeenCalled();
  });

  it('reuses existing single-month folder when re-delivering same month on a different day', async () => {
    // Complementary to the "no false match" test: confirms the period-prefix
    // equality check still works for the legitimate same-period re-delivery case.
    const PRIOR_NAME = '2025-01 (entregado 2025-05-01)';
    vi.mocked(findByName).mockResolvedValueOnce(
      ok({ id: 'entregas-id', name: 'Entregas', mimeType: FOLDER_MIME })
    );
    vi.mocked(listByMimeType).mockImplementation(async (folderId: string, mime: string) => {
      if (folderId === 'entregas-id' && mime === FOLDER_MIME) {
        return ok([{ id: 'period-id', name: PRIOR_NAME, mimeType: FOLDER_MIME }]);
      }
      return ok([]);
    });
    vi.mocked(listAllChildren).mockResolvedValue(ok([]));
    vi.mocked(deleteFileById).mockResolvedValue(ok(undefined));
    vi.mocked(renameFile).mockResolvedValue(ok(undefined));

    const result = await prepareDeliveryFolder(ROOT_ID, FOLDER_NAME, DELIVERY_DATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.folderId).toBe('period-id');
      expect(result.value.isReuse).toBe(true);
    }
    expect(renameFile).toHaveBeenCalledWith('period-id', FOLDER_NAME);
  });

  it('returns Result.err when Drive error occurs during create', async () => {
    vi.mocked(findByName).mockResolvedValue(ok(null));
    vi.mocked(createFolder).mockResolvedValue(err('Drive API error'));

    const result = await prepareDeliveryFolder(ROOT_ID, FOLDER_NAME, DELIVERY_DATE);
    expect(result.ok).toBe(false);
  });

  it('returns Result.err when delete fails (does not silently continue)', async () => {
    vi.mocked(findByName).mockResolvedValueOnce(
      ok({ id: 'entregas-id', name: 'Entregas', mimeType: FOLDER_MIME })
    );
    vi.mocked(listByMimeType).mockImplementation(async (folderId: string, mime: string) => {
      if (folderId === 'entregas-id' && mime === FOLDER_MIME) {
        return ok([{ id: 'period-id', name: FOLDER_NAME, mimeType: FOLDER_MIME }]);
      }
      return ok([]);
    });
    vi.mocked(listAllChildren).mockResolvedValue(ok([
      { id: 'pdf1', name: 'resumen.pdf', mimeType: 'application/pdf' },
    ]));
    vi.mocked(deleteFileById).mockResolvedValue(err('Delete failed'));

    const result = await prepareDeliveryFolder(ROOT_ID, FOLDER_NAME, DELIVERY_DATE);
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 6: copyPdfsToDelivery
// ─────────────────────────────────────────────────────────────────────────────

describe('copyPdfsToDelivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeScope = (...ids: string[]): ResumenScopeItem[] =>
    ids.map((id, i) => ({
      fileId: id,
      fileName: `file-${id}.pdf`,
      type: 'bancario' as const,
      periodo: `2025-0${i + 1}`,
    }));

  it('empty scope returns {copied: 0, failed: []} with Result.ok', async () => {
    const result = await copyPdfsToDelivery('folder-id', []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ copied: 0, failed: [] });
    }
    expect(copyFile).not.toHaveBeenCalled();
  });

  it('all copies succeed → {copied: N, failed: []}', async () => {
    vi.mocked(copyFile).mockResolvedValue(ok({ id: 'copy-id', name: 'file.pdf', mimeType: 'application/pdf' }));
    const scope = makeScope('fid1', 'fid2', 'fid3');

    const result = await copyPdfsToDelivery('folder-id', scope);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.copied).toBe(3);
      expect(result.value.failed).toEqual([]);
    }
  });

  it('one copy fails → failed contains it, others complete, overall Result.ok', async () => {
    vi.mocked(copyFile)
      .mockResolvedValueOnce(ok({ id: 'copy1', name: 'f1.pdf', mimeType: 'application/pdf' }))
      .mockResolvedValueOnce(err('Copy error'))
      .mockResolvedValueOnce(ok({ id: 'copy3', name: 'f3.pdf', mimeType: 'application/pdf' }));

    const scope = makeScope('fid1', 'fid2', 'fid3');
    const result = await copyPdfsToDelivery('folder-id', scope);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.copied).toBe(2);
      expect(result.value.failed).toHaveLength(1);
      expect(result.value.failed[0].fileId).toBe('fid2');
      expect(result.value.failed[0].error).toBe('Copy error');
    }
  });

  it('all copies fail → still Result.ok with all in failed', async () => {
    vi.mocked(copyFile).mockResolvedValue(err('Copy error'));
    const scope = makeScope('fid1', 'fid2');

    const result = await copyPdfsToDelivery('folder-id', scope);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.copied).toBe(0);
      expect(result.value.failed).toHaveLength(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7: buildMovimientosWorkbook
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMovimientosWorkbook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const FOLDER_ID = 'delivery-folder-id';
  const WORKBOOK_ID = 'workbook-id';
  const WORKBOOK_URL = `https://docs.google.com/spreadsheets/d/${WORKBOOK_ID}/edit`;

  function setupCreateSpreadsheet() {
    vi.mocked(createSpreadsheet).mockResolvedValue(
      ok({ id: WORKBOOK_ID, name: 'Movimientos', mimeType: 'application/vnd.google-apps.spreadsheet' })
    );
  }

  function setupInitialMeta(sheetId = 0) {
    vi.mocked(getSheetMetadata).mockResolvedValue(ok([
      { title: 'Sheet1', sheetId, index: 0 },
    ]));
  }

  function makeScope(...items: Array<{ sheetName: string; banco: string; numeroCuenta: string; moneda: string }>): MovimientoScopeItem[] {
    return items.map(i => ({
      spreadsheetId: 'src-ssid',
      ...i,
    }));
  }

  function makeMovimiento(fecha: string, concepto: string, debito: number, credito: number, saldo: number, detalle: string) {
    return {
      sheetName: '2025-01',
      rowNumber: 2,
      fecha,
      concepto,
      debito,
      credito,
      saldo,
      saldoCalculado: 0,
      matchedFileId: '',
      matchedType: '' as const,
      detalle,
    };
  }

  it('empty scope → placeholder tab "Sin Movimientos" with headers; tabCount: 0', async () => {
    setupCreateSpreadsheet();
    setupInitialMeta(42);
    vi.mocked(renameSheet).mockResolvedValue(ok(undefined));
    vi.mocked(appendRowsWithLinks).mockResolvedValue(ok(6));

    const result = await buildMovimientosWorkbook(FOLDER_ID, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.workbookId).toBe(WORKBOOK_ID);
      expect(result.value.workbookUrl).toBe(WORKBOOK_URL);
      expect(result.value.tabCount).toBe(0);
    }
    expect(renameSheet).toHaveBeenCalledWith(WORKBOOK_ID, 42, 'Sin Movimientos');
    expect(appendRowsWithLinks).toHaveBeenCalledWith(
      WORKBOOK_ID,
      expect.stringContaining('Sin Movimientos'),
      [expect.arrayContaining(['fecha', 'concepto', 'debito', 'credito', 'saldo', 'detalle'])]
    );
  });

  it('one scope item → one tab named correctly, six columns, default tab deleted', async () => {
    setupCreateSpreadsheet();
    setupInitialMeta(0);
    vi.mocked(createSheet).mockResolvedValue(ok(1));
    vi.mocked(readMovimientosForPeriod).mockResolvedValue(ok([
      makeMovimiento('2025-01-15', 'Pago', 1000, 0, 5000, 'Match XYZ'),
    ]));
    vi.mocked(appendRowsWithLinks).mockResolvedValue(ok(12));
    vi.mocked(formatSheet).mockResolvedValue(ok(undefined));
    vi.mocked(deleteSheet).mockResolvedValue(ok(undefined));

    const scope = makeScope({ sheetName: '2025-01', banco: 'BBVA', numeroCuenta: '1234567890', moneda: 'ARS' });
    const result = await buildMovimientosWorkbook(FOLDER_ID, scope);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tabCount).toBe(1);
    }
    // Tab created with correct name
    expect(createSheet).toHaveBeenCalledWith(WORKBOOK_ID, '2025-01 BBVA 1234567890 ARS');
    // Default tab deleted
    expect(deleteSheet).toHaveBeenCalledWith(WORKBOOK_ID, 0);
    // Data appended (header + 1 data row)
    expect(appendRowsWithLinks).toHaveBeenCalled();
    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    const rows = appendCall[2];
    expect(rows).toHaveLength(2); // header + data row
    // Header row is plain strings
    expect(rows[0]).toEqual(['fecha', 'concepto', 'debito', 'credito', 'saldo', 'detalle']);
    // Data row has CellDate for fecha, CellNumber for debito/credito/saldo
    const dataRow = rows[1];
    expect(dataRow[0]).toMatchObject({ type: 'date', value: '2025-01-15' });
    expect(dataRow[1]).toBe('Pago');
    expect(dataRow[2]).toMatchObject({ type: 'number', value: 1000 });
    expect(dataRow[3]).toMatchObject({ type: 'number', value: 0 });
    expect(dataRow[4]).toMatchObject({ type: 'number', value: 5000 });
    expect(dataRow[5]).toBe('Match XYZ');
    // formatSheet called
    expect(formatSheet).toHaveBeenCalledWith(WORKBOOK_ID, 1, expect.objectContaining({ frozenRows: 1 }));
  });

  it('multiple items sort tabs lexicographically (month-major)', async () => {
    setupCreateSpreadsheet();
    setupInitialMeta(0);
    vi.mocked(createSheet).mockResolvedValue(ok(1));
    vi.mocked(readMovimientosForPeriod).mockResolvedValue(ok([]));
    vi.mocked(appendRowsWithLinks).mockResolvedValue(ok(6));
    vi.mocked(formatSheet).mockResolvedValue(ok(undefined));
    vi.mocked(deleteSheet).mockResolvedValue(ok(undefined));

    const scope = makeScope(
      { sheetName: '2025-03', banco: 'BBVA', numeroCuenta: '1234', moneda: 'ARS' },
      { sheetName: '2025-01', banco: 'BBVA', numeroCuenta: '1234', moneda: 'ARS' },
      { sheetName: '2025-02', banco: 'BBVA', numeroCuenta: '1234', moneda: 'ARS' },
    );
    const result = await buildMovimientosWorkbook(FOLDER_ID, scope);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tabCount).toBe(3);

    const tabNames = vi.mocked(createSheet).mock.calls.map(c => c[1]);
    expect(tabNames[0]).toContain('2025-01');
    expect(tabNames[1]).toContain('2025-02');
    expect(tabNames[2]).toContain('2025-03');
  });

  it('source with only SALDO rows (empty after filter) → tab with header only', async () => {
    setupCreateSpreadsheet();
    setupInitialMeta(0);
    vi.mocked(createSheet).mockResolvedValue(ok(1));
    vi.mocked(readMovimientosForPeriod).mockResolvedValue(ok([])); // empty after filtering
    vi.mocked(appendRowsWithLinks).mockResolvedValue(ok(6));
    vi.mocked(formatSheet).mockResolvedValue(ok(undefined));
    vi.mocked(deleteSheet).mockResolvedValue(ok(undefined));

    const scope = makeScope({ sheetName: '2025-01', banco: 'BBVA', numeroCuenta: '1234', moneda: 'ARS' });
    const result = await buildMovimientosWorkbook(FOLDER_ID, scope);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tabCount).toBe(1);

    const appendCall = vi.mocked(appendRowsWithLinks).mock.calls[0];
    expect(appendCall[2]).toHaveLength(1); // only header row
  });

  it('readMovimientosForPeriod error on one tab → tab is fully skipped (not created), others written, Result.ok', async () => {
    // Codex P2: when readMovimientosForPeriod fails (e.g. transient Sheets
    // error), the previous implementation logged + continued and ended up with
    // a header-only tab, hiding the data loss behind a successful response.
    // The fixed implementation skips the tab entirely.
    setupCreateSpreadsheet();
    setupInitialMeta(0);
    vi.mocked(createSheet).mockResolvedValue(ok(1));
    vi.mocked(readMovimientosForPeriod)
      .mockResolvedValueOnce(err('Read error'))
      .mockResolvedValueOnce(ok([makeMovimiento('2025-02-10', 'Pago', 500, 0, 4500, '')]));
    vi.mocked(appendRowsWithLinks).mockResolvedValue(ok(6));
    vi.mocked(formatSheet).mockResolvedValue(ok(undefined));
    vi.mocked(deleteSheet).mockResolvedValue(ok(undefined));

    const scope = [
      { spreadsheetId: 'src-ssid', sheetName: '2025-01', banco: 'BBVA', numeroCuenta: '1234', moneda: 'ARS' },
      { spreadsheetId: 'src-ssid', sheetName: '2025-02', banco: 'BBVA', numeroCuenta: '1234', moneda: 'ARS' },
    ];
    const result = await buildMovimientosWorkbook(FOLDER_ID, scope);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only the successful tab is counted; the failed tab is skipped entirely
      expect(result.value.tabCount).toBe(1);
    }
    // createSheet must NOT have been called for the failed scope item
    expect(createSheet).toHaveBeenCalledTimes(1);
    expect(createSheet).toHaveBeenCalledWith(WORKBOOK_ID, '2025-02 BBVA 1234 ARS');
  });

  it('appendRowsWithLinks failure on one tab → tab is removed, not counted; others written, Result.ok', async () => {
    // Codex P2: when the data write fails after the tab is created, leaving the
    // empty tab and incrementing tabCount silently omits the account's data
    // while reporting success. The fix removes the empty tab and skips it.
    setupCreateSpreadsheet();
    setupInitialMeta(0);
    vi.mocked(createSheet)
      .mockResolvedValueOnce(ok(101)) // tab for 2025-01 (will fail to append)
      .mockResolvedValueOnce(ok(102)); // tab for 2025-02 (will succeed)
    vi.mocked(readMovimientosForPeriod).mockResolvedValue(
      ok([makeMovimiento('2025-01-10', 'Pago', 500, 0, 4500, '')])
    );
    vi.mocked(appendRowsWithLinks)
      .mockResolvedValueOnce(err('Quota exceeded'))
      .mockResolvedValueOnce(ok(6));
    vi.mocked(formatSheet).mockResolvedValue(ok(undefined));
    vi.mocked(deleteSheet).mockResolvedValue(ok(undefined));

    const scope = [
      { spreadsheetId: 'src-ssid', sheetName: '2025-01', banco: 'BBVA', numeroCuenta: '1234', moneda: 'ARS' },
      { spreadsheetId: 'src-ssid', sheetName: '2025-02', banco: 'BBVA', numeroCuenta: '1234', moneda: 'ARS' },
    ];
    const result = await buildMovimientosWorkbook(FOLDER_ID, scope);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only the successful tab is counted
      expect(result.value.tabCount).toBe(1);
    }
    // The failed tab was deleted (tab 101) and the default sheet was deleted
    // (post-loop cleanup). The successful tab (102) is NOT deleted.
    expect(deleteSheet).toHaveBeenCalledWith(WORKBOOK_ID, 101);
    expect(deleteSheet).not.toHaveBeenCalledWith(WORKBOOK_ID, 102);
    // Format must NOT be called for the failed tab
    expect(formatSheet).toHaveBeenCalledTimes(1);
    expect(formatSheet).toHaveBeenCalledWith(WORKBOOK_ID, 102, expect.anything());
  });

  it('all createSheet calls fail → falls back to Sin Movimientos placeholder, deleteSheet not called', async () => {
    setupCreateSpreadsheet();
    setupInitialMeta(7);
    vi.mocked(createSheet).mockResolvedValue(err('Sheet quota exceeded'));
    vi.mocked(renameSheet).mockResolvedValue(ok(undefined));
    vi.mocked(appendRowsWithLinks).mockResolvedValue(ok(6));
    vi.mocked(deleteSheet).mockResolvedValue(ok(undefined));

    const scope = makeScope(
      { sheetName: '2025-01', banco: 'BBVA', numeroCuenta: '1234', moneda: 'ARS' },
      { sheetName: '2025-02', banco: 'BBVA', numeroCuenta: '1234', moneda: 'ARS' },
    );
    const result = await buildMovimientosWorkbook(FOLDER_ID, scope);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tabCount).toBe(0);

    // Default sheet must NOT be deleted (would orphan the workbook)
    expect(deleteSheet).not.toHaveBeenCalled();
    // Default sheet renamed to Sin Movimientos and headers written
    expect(renameSheet).toHaveBeenCalledWith(WORKBOOK_ID, 7, 'Sin Movimientos');
    expect(appendRowsWithLinks).toHaveBeenCalledWith(
      WORKBOOK_ID,
      expect.stringContaining('Sin Movimientos'),
      [expect.arrayContaining(['fecha', 'concepto', 'debito', 'credito', 'saldo', 'detalle'])]
    );
  });
});
