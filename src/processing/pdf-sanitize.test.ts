/**
 * Tests for PDF invisible-text detection (Task 6 — ADV-192)
 *
 * Fixtures are built as minimal in-memory byte sequences — no binary files
 * committed to the repo.
 */

import { describe, it, expect } from 'vitest';
import { detectInvisibleText } from './pdf-sanitize.js';

// ---------------------------------------------------------------------------
// Minimal PDF builder helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal syntactically-correct PDF with a single uncompressed
 * content stream.  Only for testing — not a real PDF renderer.
 */
function buildMinimalPdf(contentStream: string, mediaBox = '0 0 612 792'): Buffer {
  const streamBody = contentStream;
  const streamLen = Buffer.byteLength(streamBody, 'latin1');

  const objects = [
    '1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n',
    '2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n',
    `3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>\nendobj\n`,
    `4 0 obj\n<</Length ${streamLen}>>\nstream\n${streamBody}\nendstream\nendobj\n`,
    '5 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>\nendobj\n',
  ];

  const header = '%PDF-1.4\n';
  let body = '';
  const offsets: number[] = [];

  for (const obj of objects) {
    offsets.push(header.length + body.length);
    body += obj;
  }

  const xrefOffset = header.length + body.length;

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += String(offset).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, 'latin1');
}

/**
 * Builds a minimal non-PDF byte sequence (e.g. a PNG header).
 */
function buildNonPdfBuffer(): Buffer {
  return Buffer.from('\x89PNG\r\n\x1a\nFake PNG content', 'latin1');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectInvisibleText', () => {
  describe('non-PDF inputs', () => {
    it('returns hasInvisible:false for a PNG buffer (no PDF header)', () => {
      const result = detectInvisibleText(buildNonPdfBuffer());
      expect(result.hasInvisible).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    it('returns hasInvisible:false for an empty buffer', () => {
      const result = detectInvisibleText(Buffer.alloc(0));
      expect(result.hasInvisible).toBe(false);
    });

    it('returns hasInvisible:false for a JPEG buffer', () => {
      const jpeg = Buffer.from('\xff\xd8\xff\xe0Some JPEG content', 'latin1');
      const result = detectInvisibleText(jpeg);
      expect(result.hasInvisible).toBe(false);
    });
  });

  describe('clean PDFs', () => {
    it('returns hasInvisible:false for a normal visible text stream', () => {
      const contentStream = 'BT /F1 12 Tf 100 700 Td (Visible text) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(false);
    });

    it('returns hasInvisible:false for an empty content stream', () => {
      const result = detectInvisibleText(buildMinimalPdf(''));
      expect(result.hasInvisible).toBe(false);
    });

    it('returns hasInvisible:false when font size is very small but non-zero', () => {
      const contentStream = 'BT /F1 0.5 Tf 100 700 Td (Tiny but visible) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(false);
    });
  });

  describe('font-size-0 detection', () => {
    it('returns hasInvisible:true for /FontName 0 Tf operator', () => {
      const contentStream = 'BT /F1 0 Tf 100 700 Td (Hidden text) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
      expect(result.reason).toMatch(/font.?size.?0|invisible/i);
    });

    it('returns hasInvisible:true for /FontName 0.0 Tf operator', () => {
      const contentStream = 'BT /F1 0.0 Tf 200 600 Td (Also hidden) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
    });

    it('handles different font names before Tf', () => {
      const contentStream = 'BT /TimesRoman 0 Tf 50 500 Td (Invisible) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
    });
  });

  describe('text-outside-MediaBox detection', () => {
    it('returns hasInvisible:true for text matrix placing text outside page (negative coords)', () => {
      // Tm sets text matrix: a b c d x y Tm — (x,y) is the translation (absolute position)
      // Identity matrix with translation (-200, -300) is outside MediaBox [0 0 612 792]
      const contentStream = 'BT /F1 12 Tf 1 0 0 1 -200 -300 Tm (Outside page) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
      expect(result.reason).toMatch(/mediabox|outside|position/i);
    });

    it('returns hasInvisible:true for text matrix placing text far beyond page right/top', () => {
      // Position (2000, 5000) is beyond MediaBox [0 0 612 792]
      const contentStream = 'BT /F1 12 Tf 1 0 0 1 2000 5000 Tm (Far outside) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
    });

    it('returns hasInvisible:false for text matrix at page origin (0 0)', () => {
      // Identity matrix with translation (0, 0) — exactly at page corner, still inside
      const contentStream = 'BT /F1 12 Tf 1 0 0 1 0 0 Tm (At origin, inside) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(false);
    });

    it('returns hasInvisible:false for text well within page bounds', () => {
      const contentStream = 'BT /F1 12 Tf 1 0 0 1 100 400 Tm (In center) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(false);
    });
  });

  describe('white-on-white text detection', () => {
    it('returns hasInvisible:true for text with white gray fill (1 g)', () => {
      // `1 g` sets fill color to white in DeviceGray
      const contentStream = '1 g\nBT /F1 12 Tf 100 700 Td (White text) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
      expect(result.reason).toMatch(/white|color|invisible/i);
    });

    it('returns hasInvisible:true for text with white RGB fill (1 1 1 rg)', () => {
      const contentStream = '1 1 1 rg\nBT /F1 12 Tf 100 700 Td (White RGB) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
    });
  });

  describe('performance', () => {
    it('completes in <500 ms for a 10 MB PDF-like buffer', () => {
      // Build a large fake PDF buffer: valid header + enough filler content
      const header = Buffer.from('%PDF-1.4\n', 'latin1');
      // 10 MB of filler — just bytes (not valid PDF objects, but tests the scan overhead)
      const filler = Buffer.alloc(10 * 1024 * 1024, 0x20); // spaces
      const eof = Buffer.from('\n%%EOF\n', 'latin1');
      const large = Buffer.concat([header, filler, eof]);

      const start = Date.now();
      detectInvisibleText(large);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });
  });
});
