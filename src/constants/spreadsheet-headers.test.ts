/**
 * Tests for spreadsheet headers constants
 */

import { describe, it, expect } from 'vitest';
import {
  STATUS_HEADERS,
  STATUS_SHEET,
  DASHBOARD_OPERATIVO_SHEETS,
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
  });
});
