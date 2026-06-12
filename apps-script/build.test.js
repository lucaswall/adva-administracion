/**
 * Tests for Apps Script build helpers
 */

import { describe, it, expect } from 'vitest';
import { escapeTemplateValue, applyTemplate } from './build.js';

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

  // ADV-333: applyTemplate must not misinterpret $ special sequences
  describe('applyTemplate (ADV-333)', () => {
    const tpl = "const URL = '{{API_BASE_URL}}'; const SECRET = '{{API_SECRET}}';";

    it('injects plain values correctly', () => {
      const result = applyTemplate(tpl, 'https://example.com', 'mysecret123');
      expect(result).toBe("const URL = 'https://example.com'; const SECRET = 'mysecret123';");
    });

    it('ADV-333: handles $$ in secret without collapsing to single $', () => {
      // String.replace with a string arg interprets $$ as literal $.
      // The function-replacement form must preserve $$ as-is in the output.
      const result = applyTemplate(tpl, 'https://example.com', 'sec$$ret');
      expect(result).toContain("'sec$$ret'");
    });

    it('ADV-333: handles $& in secret without substituting matched text', () => {
      // $& in replacement string would insert the matched pattern {{API_SECRET}}
      const result = applyTemplate(tpl, 'https://example.com', 'sec$&ret');
      expect(result).toContain("'sec$&ret'");
      expect(result).not.toContain('{{API_SECRET}}');
    });

    it('ADV-333: handles $` in secret without inserting the prefix', () => {
      const result = applyTemplate(tpl, 'https://example.com', 'sec$`ret');
      expect(result).toContain("'sec$`ret'");
    });

    it('ADV-333: handles $\' in secret without inserting the suffix', () => {
      const result = applyTemplate(tpl, 'https://example.com', "sec$'ret");
      expect(result).toContain("'sec$\\'ret'");
    });

    it('ADV-333: handles $$ in API_BASE_URL', () => {
      const result = applyTemplate(tpl, 'https://exam$$ple.com', 'secret');
      expect(result).toContain("'https://exam$$ple.com'");
    });
  });
});
