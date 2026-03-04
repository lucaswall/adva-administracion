/**
 * Shared utilities for column letter ↔ index conversion and column projection.
 */

/** Convert 1-based column index to A1 letter(s): 1→A, 26→Z, 27→AA */
export function colIndexToLetter(col: number): string {
  let a1 = '';
  let c = col;
  while (c > 0) {
    c--;
    a1 = String.fromCharCode(65 + (c % 26)) + a1;
    c = Math.floor(c / 26);
  }
  return a1;
}

/** Convert column letter(s) to 0-based index: A→0, B→1, Z→25, AA→26 */
export function colLetterToIndex(letter: string): number {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + (letter.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Parse column specs like ["A", "B", "G:I"] into a sorted array of 0-based column indices.
 * - Single letter: "A" → [0]
 * - Range: "G:I" → [6, 7, 8]
 */
export function parseColumnSpecs(specs: string[]): number[] {
  const indices = new Set<number>();
  for (const spec of specs) {
    const upper = spec.toUpperCase().trim();
    if (upper.includes(':')) {
      const [start, end] = upper.split(':');
      const startIdx = colLetterToIndex(start);
      const endIdx = colLetterToIndex(end);
      for (let i = startIdx; i <= endIdx; i++) {
        indices.add(i);
      }
    } else {
      indices.add(colLetterToIndex(upper));
    }
  }
  return [...indices].sort((a, b) => a - b);
}

/** Project a row to only the specified column indices, padding with empty string if needed. */
export function projectRow<T>(row: T[], colIndices: number[], pad: T): T[] {
  return colIndices.map((i) => (i < row.length ? row[i] : pad));
}
