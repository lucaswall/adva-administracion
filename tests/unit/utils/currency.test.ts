/**
 * Unit tests for currency utilities
 */

import { describe, it, expect } from 'vitest';
import { AMOUNT_TOLERANCE } from '../../../src/utils/currency.js';

describe('currency', () => {
  describe('AMOUNT_TOLERANCE', () => {
    it('is defined as 1 peso', () => {
      expect(AMOUNT_TOLERANCE).toBe(1);
    });
  });
});
