/**
 * Tests for facturador-reader service
 * Reads Facturador de Socios spreadsheet and returns a map of entries keyed by normalized comprobante
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFacturador } from './facturador-reader.js';

// Mock dependencies
vi.mock('./sheets.js', () => ({
  getValues: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { getValues } from './sheets.js';
import type { CellValue } from './sheets.js';
import * as logger from '../utils/logger.js';

/**
 * Header row for Facturador de Socios sheet:
 * Nro Socio | Comprobante | Empresa | Representante | Email | Membresia | Cobro Id | Cond IVA | Fecha | Importe | Enviado? | Pagado? | Status
 */
const HEADER_ROW: CellValue[] = [
  'Nro Socio', 'Comprobante', 'Empresa', 'Representante', 'Email',
  'Membresia', 'Cobro Id', 'Cond IVA', 'Fecha', 'Importe', 'Enviado?', 'Pagado?', 'Status',
];

function makeRow(
  nroSocio: string,
  comprobante: string,
  empresa: string,
  representante: string,
  email: string,
  membresia: string,
  cobroId: string,
  condIVA: string,
  fecha: string,
  importe: string | number,
  enviado: string,
  pagado: string,
  status: string,
): CellValue[] {
  return [nroSocio, comprobante, empresa, representante, email, membresia, cobroId, condIVA, fecha, importe, enviado, pagado, status];
}

describe('readFacturador', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = process.env.FACTURADOR_SPREADSHEET_ID;
    process.env.FACTURADOR_SPREADSHEET_ID = 'test-spreadsheet-id';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FACTURADOR_SPREADSHEET_ID;
    } else {
      process.env.FACTURADOR_SPREADSHEET_ID = originalEnv;
    }
  });

  describe('comprobante normalization', () => {
    it('should normalize 0005-00000057 to 00005-00000057', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          makeRow('42', '0005-00000057', 'TEST SA', 'Juan Perez', 'test@test.com', 'Plata', 'cobro-1', 'Responsable Inscripto', '2026-01-15', '100,00', 'SI', '', ''),
        ],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.has('00005-00000057')).toBe(true);
        expect(result.value.has('0005-00000057')).toBe(false);
      }
    });

    it('should normalize both 0004-00000020 and 00004-00000020 to the same key', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          makeRow('42', '0004-00000020', 'TEST SA', 'Juan Perez', 'test@test.com', 'Plata', 'cobro-1', 'RI', '2026-01-15', '100,00', 'SI', '', ''),
        ],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Both raw formats normalize to the same key: 00004-00000020
        expect(result.value.has('00004-00000020')).toBe(true);
      }

      // Now test with already-padded format
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          makeRow('43', '00004-00000020', 'TEST SA', 'Juan Perez', 'test@test.com', 'Plata', 'cobro-2', 'RI', '2026-01-15', '100,00', 'SI', '', ''),
        ],
      });

      const result2 = await readFacturador(2026);
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value.has('00004-00000020')).toBe(true);
      }
    });
  });

  describe('multi-row read', () => {
    it('should return a Map of 3 entries for a sheet with 3 data rows', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          makeRow('1', '0001-00000001', 'EMPRESA UNO SA', 'Juan Perez', 'juan@test.com', 'Oro', 'c1', 'RI', '2026-01-01', '1.000,00', 'SI', '', ''),
          makeRow('2', '0001-00000002', 'TEST SA', 'Ana Lopez', 'ana@test.com', 'Plata', 'c2', 'MT', '2026-01-02', '2.000,50', 'NO', '', ''),
          makeRow('3', '0001-00000003', '', 'Pedro Garcia', 'pedro@test.com', 'Bronze', 'c3', 'CF', '2026-01-03', '500,00', 'SI', '', ''),
        ],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(3);
        expect(result.value.has('00001-00000001')).toBe(true);
        expect(result.value.has('00001-00000002')).toBe(true);
        expect(result.value.has('00001-00000003')).toBe(true);
      }
    });
  });

  describe('FacturadorEntry shape', () => {
    it('should return all fields with correct types', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          makeRow('42', '0005-00000057', 'TEST SA', 'Juan Perez', 'juan@test.com', 'Plata', 'cobro-abc', 'RI', '2026-01-15', '1.234,56', 'SI', '', 'Activo'),
        ],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entry = result.value.get('00005-00000057');
        expect(entry).toBeDefined();
        expect(entry?.nroSocio).toBe('42');
        expect(entry?.comprobante).toBe('00005-00000057');
        expect(entry?.empresa).toBe('TEST SA');
        expect(entry?.representante).toBe('Juan Perez');
        expect(entry?.email).toBe('juan@test.com');
        expect(entry?.membresia).toBe('Plata');
        expect(entry?.cobroId).toBe('cobro-abc');
        expect(entry?.condIVA).toBe('RI');
        expect(entry?.fecha).toBe('2026-01-15');
        expect(typeof entry?.importe).toBe('number');
        expect(entry?.importe).toBe(1234.56);
        expect(entry?.pagadoCol).toBe('');
      }
    });

    it('should parse importe with thousands separator', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          makeRow('1', '0001-00000001', 'TEST SA', 'Juan', 'j@t.com', 'Plata', 'c1', 'RI', '2026-01-01', '10.500,00', 'NO', '', ''),
        ],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entry = result.value.get('00001-00000001');
        expect(entry?.importe).toBe(10500);
      }
    });

    it('should parse numeric importe from sheet (already a number)', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          makeRow('1', '0001-00000001', 'TEST SA', 'Juan', 'j@t.com', 'Plata', 'c1', 'RI', '2026-01-01', 1500, 'NO', '', ''),
        ],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entry = result.value.get('00001-00000001');
        expect(entry?.importe).toBe(1500);
      }
    });

    it('should return empty empresa string verbatim when empresa is empty in source', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          makeRow('5', '0002-00000005', '', 'Maria Gomez', 'm@t.com', 'Plata', 'c5', 'MT', '2026-02-01', '800,00', 'NO', '', ''),
        ],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entry = result.value.get('00002-00000005');
        expect(entry?.empresa).toBe('');
        expect(entry?.representante).toBe('Maria Gomez');
      }
    });

    it('normalizes numeric serial date to YYYY-MM-DD (ADV-255)', async () => {
      // Sheets `UNFORMATTED_VALUE` + `SERIAL_NUMBER` returns CellDate columns as numbers.
      // 45993 corresponds to 2025-12-02.
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          // fecha cell is the numeric serial 45993 (not a string)
          makeRow('11', '0006-00000011', 'TEST SA', 'Juan', 'j@t.com', 'RI', 'c11', 'RI', 45993 as unknown as string, '500,00', 'SI', '', ''),
        ],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entry = result.value.get('00006-00000011');
        expect(entry?.fecha).toBe('2025-12-02');
      }
    });

    it('should preserve NC number in pagadoCol verbatim', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          makeRow('7', '0003-00000007', 'TEST SA', 'Juan', 'j@t.com', 'Oro', 'c7', 'RI', '2026-03-01', '300,00', 'SI', '0005-00000011', ''),
        ],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entry = result.value.get('00003-00000007');
        expect(entry?.pagadoCol).toBe('0005-00000011');
      }
    });
  });

  describe('missing current-year tab', () => {
    it('should return empty Map and log warn when tab does not exist (getValues error)', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      vi.mocked(getValues).mockResolvedValue({
        ok: false,
        error: new Error('Unable to parse range: 2026!A:M'),
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(0);
      }
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('tab'),
        expect.objectContaining({ module: 'facturador-reader' }),
      );
    });
  });

  describe('missing FACTURADOR_SPREADSHEET_ID env var', () => {
    it('should return empty Map and log warn when env var is missing', async () => {
      delete process.env.FACTURADOR_SPREADSHEET_ID;
      const warnSpy = vi.spyOn(logger, 'warn');

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(0);
      }
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('FACTURADOR_SPREADSHEET_ID'),
        expect.objectContaining({ module: 'facturador-reader' }),
      );
    });
  });

  describe('empty rows', () => {
    it('should skip rows where Comprobante is empty', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          makeRow('1', '0001-00000001', 'TEST SA', 'Juan', 'j@t.com', 'Plata', 'c1', 'RI', '2026-01-01', '100,00', 'SI', '', ''),
          ['', '', '', '', '', '', '', '', '', '', '', '', ''] as CellValue[],  // empty comprobante
          makeRow('3', '0001-00000003', 'TEST SA', 'Pedro', 'p@t.com', 'Plata', 'c3', 'RI', '2026-01-03', '200,00', 'SI', '', ''),
        ],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(2);
        expect(result.value.has('00001-00000001')).toBe(true);
        expect(result.value.has('00001-00000003')).toBe(true);
      }
    });

    it('should skip entirely empty rows (undefined/null entries)', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [
          HEADER_ROW,
          makeRow('1', '0001-00000001', 'TEST SA', 'Juan', 'j@t.com', 'Plata', 'c1', 'RI', '2026-01-01', '100,00', 'SI', '', ''),
          [] as CellValue[],  // completely empty row
          makeRow('3', '0001-00000003', 'TEST SA', 'Pedro', 'p@t.com', 'Plata', 'c3', 'RI', '2026-01-03', '200,00', 'SI', '', ''),
        ],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(2);
      }
    });
  });

  describe('header-only sheet', () => {
    it('should return empty Map for sheet with only header row', async () => {
      vi.mocked(getValues).mockResolvedValue({
        ok: true,
        value: [HEADER_ROW],
      });

      const result = await readFacturador(2026);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(0);
      }
    });
  });
});
