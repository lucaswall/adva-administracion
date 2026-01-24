/**
 * Tests for spreadsheet headers constants
 */

import { describe, it, expect } from 'vitest';
import {
  STATUS_HEADERS,
  STATUS_SHEET,
  DASHBOARD_OPERATIVO_SHEETS,
  ARCHIVOS_PROCESADOS_SHEET,
  ARCHIVOS_PROCESADOS_HEADERS,
} from './spreadsheet-headers.js';

describe('Status Sheet Headers', () => {
  describe('STATUS_HEADERS', () => {
    it('should have Metrica and Valor columns', () => {
      expect(STATUS_HEADERS).toEqual(['Metrica', 'Valor']);
    });

    it('should have exactly 2 headers', () => {
      expect(STATUS_HEADERS).toHaveLength(2);
    });
  });

  describe('STATUS_SHEET', () => {
    it('should have correct title', () => {
      expect(STATUS_SHEET.title).toBe('Status');
    });

    it('should have STATUS_HEADERS as headers', () => {
      expect(STATUS_SHEET.headers).toEqual(STATUS_HEADERS);
    });
  });

  describe('DASHBOARD_OPERATIVO_SHEETS', () => {
    it('should include Status sheet', () => {
      const statusSheet = DASHBOARD_OPERATIVO_SHEETS.find(
        s => s.title === 'Status'
      );
      expect(statusSheet).toBeDefined();
      expect(statusSheet?.headers).toEqual(['Metrica', 'Valor']);
    });

    it('should include Archivos Procesados sheet', () => {
      const archivosSheet = DASHBOARD_OPERATIVO_SHEETS.find(
        s => s.title === 'Archivos Procesados'
      );
      expect(archivosSheet).toBeDefined();
    });
  });
});

describe('Archivos Procesados Sheet Headers', () => {
  describe('ARCHIVOS_PROCESADOS_HEADERS', () => {
    it('should have fileId, fileName, processedAt, documentType, and status columns', () => {
      expect(ARCHIVOS_PROCESADOS_HEADERS).toEqual([
        'fileId',
        'fileName',
        'processedAt',
        'documentType',
        'status',
      ]);
    });

    it('should have exactly 5 headers', () => {
      expect(ARCHIVOS_PROCESADOS_HEADERS).toHaveLength(5);
    });
  });

  describe('ARCHIVOS_PROCESADOS_SHEET', () => {
    it('should have correct title', () => {
      expect(ARCHIVOS_PROCESADOS_SHEET.title).toBe('Archivos Procesados');
    });

    it('should have ARCHIVOS_PROCESADOS_HEADERS as headers', () => {
      expect(ARCHIVOS_PROCESADOS_SHEET.headers).toEqual(ARCHIVOS_PROCESADOS_HEADERS);
    });

    it('should have processedAt column formatted as date', () => {
      expect(ARCHIVOS_PROCESADOS_SHEET.numberFormats?.get(2)).toEqual({ type: 'date' });
    });
  });
});
