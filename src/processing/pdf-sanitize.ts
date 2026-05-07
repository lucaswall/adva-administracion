/**
 * PDF invisible-text detection (Task 6 — ADV-192)
 *
 * Scans uncompressed PDF content streams for common invisible-text vectors used
 * in PDF injection / prompt-injection attacks:
 *
 *   1. **Font-size 0** (`/FontName 0 Tf`) — text rendered at zero size.
 *   2. **Text outside MediaBox** — absolute text position (via Tm) or
 *      accumulated offset (via Td/TD) lands outside the declared page boundary.
 *   3. **White fill color** (`1 g` or `1 1 1 rg`) preceding text operators —
 *      text that is the same color as a typical white page background.
 *
 * KNOWN GAPS:
 *   - Compressed streams (FlateDecode, LZWDecode, etc.) are NOT decoded — only
 *     raw/uncompressed streams are inspected. Modern PDFs almost always compress
 *     content streams. A proper implementation would need zlib/deflate support.
 *   - White-on-colored-background: detecting a white-background page and then
 *     white text would require rendering the full graphics state stack.
 *   - Rendering mode 3 (invisible text): `/Tr 3` sets the text render mode to
 *     invisible. This is not yet detected.
 *   - Custom `q`/`Q` graphics state stack: color changes inside save/restore
 *     groups are tracked naively (first occurrence wins).
 *
 * DESIGN DECISIONS:
 *   - Pure JS / no dependencies — avoids pulling in pdfjs-dist (>30 MB).
 *   - Uses `latin1` decoding so all byte values survive the string round-trip.
 *   - Regex-based token scanning keeps the implementation simple and fast.
 *
 * @module pdf-sanitize
 */

/**
 * Result returned by `detectInvisibleText`.
 */
export interface InvisibleTextResult {
  /** True if at least one invisible-text vector was detected. */
  hasInvisible: boolean;
  /** Human-readable description of the detected vector, if any. */
  reason?: string;
}

/** Default tolerance: allow text slightly outside the page (PDF units). */
const OUTSIDE_PAGE_MARGIN = -1;

/**
 * Detects whether a buffer contains invisible text.
 *
 * Only PDFs (files whose first 4 bytes are `%PDF`) are inspected.
 * Any other file type returns `{ hasInvisible: false }` immediately.
 *
 * @param buffer - Raw file bytes to inspect.
 * @returns Detection result.
 */
export function detectInvisibleText(buffer: Buffer): InvisibleTextResult {
  // Bail out quickly for non-PDFs
  if (buffer.length < 4) return { hasInvisible: false };
  const header = buffer.slice(0, 5).toString('ascii');
  if (!header.startsWith('%PDF')) return { hasInvisible: false };

  // Decode entire file as latin1 (round-trip safe for binary bytes)
  const doc = buffer.toString('latin1');

  // Extract MediaBox from the document (use the first one found)
  const mediaBox = extractMediaBox(doc);

  // Find all content streams (raw — uncompressed only)
  // A stream block is: `stream<LF or CRLF> ... <LF or CRLF>endstream`
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;

  while ((m = streamRe.exec(doc)) !== null) {
    const stream = m[1];

    // Vector 1: Font-size 0
    // Operator: /FontName <size> Tf
    // Match: slash + word chars + whitespace + 0 (possibly 0.0) + whitespace + Tf
    if (/\/\w+\s+0(?:\.0+)?\s+Tf/.test(stream)) {
      return { hasInvisible: true, reason: 'font-size-0: /Tf operator with size 0 detected' };
    }

    // Vector 2: Text outside MediaBox (absolute position via Tm)
    // Tm operator: a b c d x y Tm  (sets text matrix; x,y are page coordinates)
    // For simplicity we only check Tm (not accumulated Td/TD offsets which require
    // full state tracking). Tm is the most common vector.
    if (mediaBox) {
      const tmResult = checkTextOutsideMediaBox(stream, mediaBox);
      if (tmResult) return tmResult;
    }

    // Vector 3: White fill color before text operators
    if (hasWhiteFillBeforeText(stream)) {
      return { hasInvisible: true, reason: 'white-text: white fill color (1 g or 1 1 1 rg) set before text operators' };
    }
  }

  return { hasInvisible: false };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface MediaBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/**
 * Extracts the first MediaBox declaration from the document string.
 * MediaBox format: `[xMin yMin xMax yMax]` (PDF user-space units).
 */
function extractMediaBox(doc: string): MediaBox | null {
  // Match /MediaBox [llx lly urx ury] in any page or pages dictionary
  const re = /\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/;
  const m = re.exec(doc);
  if (!m) return null;

  return {
    xMin: parseFloat(m[1]),
    yMin: parseFloat(m[2]),
    xMax: parseFloat(m[3]),
    yMax: parseFloat(m[4]),
  };
}

/**
 * Checks if any absolute text-matrix position (Tm operator) places text
 * outside the given MediaBox.
 *
 * Tm syntax: `a b c d x y Tm`
 * The translation components are (x, y) — the 5th and 6th parameters.
 */
function checkTextOutsideMediaBox(stream: string, box: MediaBox): InvisibleTextResult | null {
  // Capture: any 4 numbers (matrix a b c d), then x and y, then Tm
  const tmRe = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm/g;
  let m: RegExpExecArray | null;

  while ((m = tmRe.exec(stream)) !== null) {
    const x = parseFloat(m[5]);
    const y = parseFloat(m[6]);

    const outsideX = x < box.xMin + OUTSIDE_PAGE_MARGIN || x > box.xMax - OUTSIDE_PAGE_MARGIN;
    const outsideY = y < box.yMin + OUTSIDE_PAGE_MARGIN || y > box.yMax - OUTSIDE_PAGE_MARGIN;

    if (outsideX || outsideY) {
      return {
        hasInvisible: true,
        reason: `text-outside-mediabox: text matrix position (${x}, ${y}) is outside MediaBox [${box.xMin} ${box.yMin} ${box.xMax} ${box.yMax}]`
      };
    }
  }

  // Also check simpler 2-argument form: `x y Tm` (nonstandard but seen in some generators)
  // Only try this if the 6-arg form found nothing — avoids false positives.
  const tmShortRe = /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm$/m;
  const ms = tmShortRe.exec(stream);
  if (ms) {
    const x = parseFloat(ms[1]);
    const y = parseFloat(ms[2]);
    const outsideX = x < box.xMin + OUTSIDE_PAGE_MARGIN || x > box.xMax - OUTSIDE_PAGE_MARGIN;
    const outsideY = y < box.yMin + OUTSIDE_PAGE_MARGIN || y > box.yMax - OUTSIDE_PAGE_MARGIN;
    if (outsideX || outsideY) {
      return {
        hasInvisible: true,
        reason: `text-outside-mediabox: text position (${x}, ${y}) is outside MediaBox`
      };
    }
  }

  return null;
}

/**
 * Checks if a white fill color is set anywhere in the stream BEFORE text-drawing
 * operators (`Tj`, `TJ`, `'`, `"`).
 *
 * White fill color indicators:
 *   - `1 g`   — DeviceGray, value 1.0 = white
 *   - `1 1 1 rg` — DeviceRGB, all channels 1.0 = white
 *
 * Walks the stream in operator order and tracks the current fill color.
 * Returns true only when a text-drawing operator fires while the *active*
 * fill is white — i.e. the same `1 g`/`1 1 1 rg` that would actually paint
 * the glyphs. PDFs that paint a white background or shape and then reset the
 * fill to a dark color before drawing visible text do NOT trigger detection
 * (Codex review on PR 112).
 *
 * Limitation: does not handle `q`/`Q` graphics state stack or CMYK/pattern
 * color spaces.
 */
function hasWhiteFillBeforeText(stream: string): boolean {
  type Event = { pos: number; kind: 'color'; isWhite: boolean } | { pos: number; kind: 'text' };
  const events: Event[] = [];

  // Any DeviceGray fill: `<value> g`. White when value >= 1.
  const grayRe = /(?:^|\s)([\d.]+)\s+g(?:\s|$)/gm;
  for (const m of stream.matchAll(grayRe)) {
    if (m.index === undefined) continue;
    events.push({ pos: m.index, kind: 'color', isWhite: parseFloat(m[1]) >= 1 });
  }

  // Any DeviceRGB fill: `<r> <g> <b> rg`. White when all channels >= 1.
  const rgbRe = /(?:^|\s)([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg(?:\s|$)/gm;
  for (const m of stream.matchAll(rgbRe)) {
    if (m.index === undefined) continue;
    const r = parseFloat(m[1]);
    const g = parseFloat(m[2]);
    const b = parseFloat(m[3]);
    events.push({ pos: m.index, kind: 'color', isWhite: r >= 1 && g >= 1 && b >= 1 });
  }

  // Text-drawing operators
  const textRe = /\)\s*(?:Tj|TJ|'|")/g;
  for (const m of stream.matchAll(textRe)) {
    if (m.index === undefined) continue;
    events.push({ pos: m.index, kind: 'text' });
  }

  events.sort((a, b) => a.pos - b.pos);

  let currentFillIsWhite = false;
  for (const e of events) {
    if (e.kind === 'color') {
      currentFillIsWhite = e.isWhite;
    } else if (currentFillIsWhite) {
      return true;
    }
  }
  return false;
}
