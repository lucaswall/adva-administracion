/**
 * Tests for PDF invisible-text detection (Task 6 — ADV-192)
 *
 * Fixtures are built as minimal in-memory byte sequences — no binary files
 * committed to the repo.
 */

import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
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

/**
 * Builds a minimal PDF where the content stream is FlateDecode-compressed.
 * The content stream is zlib-deflated before embedding.
 */
function buildMinimalPdfWithFlateDecode(
  contentStream: string,
  mediaBox = '0 0 612 792'
): Buffer {
  const compressed = deflateSync(Buffer.from(contentStream, 'latin1'));
  const compressedStr = compressed.toString('latin1');
  const streamLen = compressed.length;

  const objects = [
    '1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n',
    '2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n',
    `3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>\nendobj\n`,
    `4 0 obj\n<</Length ${streamLen} /Filter /FlateDecode>>\nstream\n${compressedStr}\nendstream\nendobj\n`,
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
 * Builds a minimal PDF that declares /FlateDecode in its stream dict
 * but stores raw (non-deflated) bytes. The raw bytes happen to contain
 * PDF operators that would trigger white-fill detection in a naive scan.
 * After proper FlateDecode-aware handling (inflate fails → skip stream)
 * this should NOT flag as invisible.
 */
function buildMinimalPdfWithCorruptFlateDecode(mediaBox = '0 0 612 792'): Buffer {
  // Raw bytes that look like an invisible-text stream to a naive scanner
  const fakeCompressedStr = '1 g\nBT /F1 12 Tf 100 700 Td (hidden) Tj ET';
  const streamLen = fakeCompressedStr.length;

  const objects = [
    '1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n',
    '2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n',
    `3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>\nendobj\n`,
    `4 0 obj\n<</Length ${streamLen} /Filter /FlateDecode>>\nstream\n${fakeCompressedStr}\nendstream\nendobj\n`,
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

    it('returns hasInvisible:false when white fill is reset to dark before text (Codex P2)', () => {
      // Common PDF generator pattern: paint white background or shape, then
      // reset to dark fill and draw visible text. Earlier heuristic flagged
      // this as invisible — fix tracks active fill at each text op.
      const contentStream = '1 1 1 rg\n0 0 595 842 re f\n0 0 0 rg\nBT /F1 12 Tf 100 700 Td (Visible black text) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(false);
    });

    it('returns hasInvisible:false when white gray fill is reset to dark before text', () => {
      const contentStream = '1 g\n0 0 595 842 re f\n0 g\nBT /F1 12 Tf 100 700 Td (Visible) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(false);
    });

    it('still detects text drawn while fill is actively white (after a non-white interlude)', () => {
      const contentStream = '0 0 0 rg\nBT /F1 12 Tf 50 700 Td (Visible) Tj ET\n1 1 1 rg\nBT /F1 12 Tf 50 720 Td (Hidden) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
    });

    it('detects white-on-white text drawn with TJ array (Codex P2 follow-up)', () => {
      // `TJ` operator takes an array `[(s1) num (s2) ...]` ending with `]`,
      // not `)`. Earlier regex only matched `) TJ` and missed this form.
      const contentStream = '1 1 1 rg\nBT /F1 12 Tf 100 700 Td [(Hidden) -50 (payload)] TJ ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
    });

    it('does NOT flag visible TJ text after a white-fill background reset', () => {
      // White rect, then dark fill, then visible TJ text — must remain clean.
      const contentStream = '1 1 1 rg\n0 0 595 842 re f\n0 0 0 rg\nBT /F1 12 Tf 100 700 Td [(Visible) -100 (TJ text)] TJ ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(false);
    });

    it('detects white-on-white text drawn from a hex string (Codex P2 follow-up)', () => {
      // PDF allows hex strings (`<...>`) as text operands. A malicious PDF can
      // hide a prompt-injection payload as `1 1 1 rg <68696464656e> Tj`.
      const contentStream = '1 1 1 rg\nBT /F1 12 Tf 100 700 Td <68696464656e> Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
    });

    it('detects white-on-white hex string with the apostrophe show operator', () => {
      const contentStream = '1 1 1 rg\nBT /F1 12 Tf 100 700 Td <68> \' ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
    });

    it('does NOT flag visible hex-string text after a white-fill background reset', () => {
      const contentStream = '1 1 1 rg\n0 0 595 842 re f\n0 0 0 rg\nBT /F1 12 Tf 100 700 Td <56697369626c65> Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(false);
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

  // ---------------------------------------------------------------------------
  // Task 12 — ADV-284: FlateDecode stream decompression
  // ---------------------------------------------------------------------------

  describe('FlateDecode compressed stream detection (ADV-284)', () => {
    it('detects white-fill invisible text inside a FlateDecode-compressed stream', () => {
      const contentStream = '1 g\nBT /F1 12 Tf 100 700 Td (hidden payload) Tj ET';
      const pdf = buildMinimalPdfWithFlateDecode(contentStream);
      const result = detectInvisibleText(pdf);
      expect(result.hasInvisible).toBe(true);
    });

    it('does NOT flag a FlateDecode stream that contains only clean dark text', () => {
      const contentStream = 'BT /F1 12 Tf 100 700 Td (visible) Tj ET';
      const pdf = buildMinimalPdfWithFlateDecode(contentStream);
      const result = detectInvisibleText(pdf);
      expect(result.hasInvisible).toBe(false);
    });

    it('returns hasInvisible:false for a corrupt FlateDecode stream without throwing', () => {
      // The corrupt stream contains raw bytes that look like invisible-text operators
      // (would false-positive in a naive raw scan).
      // After the fix the inflate error causes the stream to be skipped → no false positive.
      const pdf = buildMinimalPdfWithCorruptFlateDecode();
      expect(() => detectInvisibleText(pdf)).not.toThrow();
      const result = detectInvisibleText(pdf);
      expect(result.hasInvisible).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 12 — ADV-284: /Tr 3 invisible render mode detection
  // ---------------------------------------------------------------------------

  describe('/Tr 3 invisible render mode detection (ADV-284)', () => {
    it('detects text render mode 3 followed by Tj in same stream', () => {
      // 3 Tr sets invisible render mode; then (payload) Tj draws invisible text
      const contentStream = 'BT /F1 12 Tf 100 700 Td 3 Tr (invisible via render mode) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
      expect(result.reason).toMatch(/render.?mode|Tr|invisible/i);
    });

    it('detects /Tr 3 with TJ array operator', () => {
      const contentStream = 'BT /F1 12 Tf 100 700 Td 3 Tr [(hidden) 0 (payload)] TJ ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
    });

    it('does NOT flag render mode 0 (normal fill text)', () => {
      const contentStream = 'BT /F1 12 Tf 100 700 Td 0 Tr (visible) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 12 — ADV-284: q/Q graphics-state stack color tracking
  // ---------------------------------------------------------------------------

  describe('q/Q graphics-state stack and color tracking (ADV-284)', () => {
    it('does NOT flag when white fill is set inside q/Q and Q restores dark color', () => {
      // q saves dark; 1 g sets white; Q restores dark; Tj draws in dark → clean
      const contentStream = 'q\n1 g\nQ\nBT /F1 12 Tf 100 700 Td (visible) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(false);
    });

    it('DOES flag when outer white fill is restored by Q before text draw (1 g q 0 g Q Tj)', () => {
      // 1 g sets white; q saves white; 0 g sets dark; Q restores white; Tj draws white → invisible
      const contentStream = '1 g\nq\n0 g\nQ\nBT /F1 12 Tf 100 700 Td (hidden) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
    });

    it('DOES flag when white fill is set after q/Q block (q 0 g Q 1 g Tj)', () => {
      // q saves dark; 0 g dark inside block; Q restores dark; 1 g sets white; Tj → invisible
      const contentStream = 'q\n0 g\nQ\n1 g\nBT /F1 12 Tf 100 700 Td (hidden) Tj ET';
      const result = detectInvisibleText(buildMinimalPdf(contentStream));
      expect(result.hasInvisible).toBe(true);
    });
  });
});
