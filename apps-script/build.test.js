/**
 * Tests for Apps Script build helpers
 */

import { describe, it, expect } from 'vitest';
import { escapeTemplateValue } from './build.js';

describe('build helpers', () => {
  describe('escapeTemplateValue', () => {
    it('should pass through strings without special characters', () => {
      expect(escapeTemplateValue('simple-secret-123')).toBe('simple-secret-123');
    });

    it('should escape single quotes', () => {
      expect(escapeTemplateValue("it's a secret")).toBe("it\\'s a secret");
    });

    it('should escape backslashes before single quotes', () => {
      expect(escapeTemplateValue("back\\slash")).toBe("back\\\\slash");
    });

    it('should escape both backslashes and single quotes together', () => {
      expect(escapeTemplateValue("val\\'ue")).toBe("val\\\\\\'ue");
    });
  });
});
