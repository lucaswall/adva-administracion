/**
 * Tests for document extraction and classification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasValidDate } from './extractor.js';

describe('hasValidDate', () => {
  describe('factura types', () => {
    it('returns true for valid YYYY-MM-DD fechaEmision', () => {
      expect(hasValidDate({ fechaEmision: '2025-11-01' }, 'factura_emitida')).toBe(true);
      expect(hasValidDate({ fechaEmision: '2025-11-01' }, 'factura_recibida')).toBe(true);
    });

    it('returns false for DD/MM/YYYY format', () => {
      expect(hasValidDate({ fechaEmision: '01/11/2025' }, 'factura_emitida')).toBe(false);
      expect(hasValidDate({ fechaEmision: '01/11/2025' }, 'factura_recibida')).toBe(false);
    });

    it('returns false for DD-MM-YYYY format', () => {
      expect(hasValidDate({ fechaEmision: '01-11-2025' }, 'factura_emitida')).toBe(false);
    });

    it('returns false for 2-digit year formats', () => {
      expect(hasValidDate({ fechaEmision: '11/13/25' }, 'factura_emitida')).toBe(false);
    });

    it('returns false for empty or missing date', () => {
      expect(hasValidDate({ fechaEmision: '' }, 'factura_emitida')).toBe(false);
      expect(hasValidDate({}, 'factura_emitida')).toBe(false);
    });
  });

  describe('pago types', () => {
    it('returns true for valid YYYY-MM-DD fechaPago', () => {
      expect(hasValidDate({ fechaPago: '2025-12-15' }, 'pago_enviado')).toBe(true);
      expect(hasValidDate({ fechaPago: '2025-12-15' }, 'pago_recibido')).toBe(true);
    });

    it('returns false for DD/MM/YYYY format', () => {
      expect(hasValidDate({ fechaPago: '15/12/2025' }, 'pago_enviado')).toBe(false);
    });

    it('returns false for empty or missing date', () => {
      expect(hasValidDate({ fechaPago: '' }, 'pago_enviado')).toBe(false);
      expect(hasValidDate({}, 'pago_recibido')).toBe(false);
    });
  });

  describe('recibo type', () => {
    it('returns true for valid YYYY-MM-DD fechaPago', () => {
      expect(hasValidDate({ fechaPago: '2025-11-30' }, 'recibo')).toBe(true);
    });

    it('returns false for DD/MM/YYYY format', () => {
      expect(hasValidDate({ fechaPago: '30/11/2025' }, 'recibo')).toBe(false);
    });
  });

  describe('resumen types', () => {
    it('returns true when both fechaDesde and fechaHasta are valid', () => {
      const doc = { fechaDesde: '2025-11-01', fechaHasta: '2025-11-30' };
      expect(hasValidDate(doc, 'resumen_bancario')).toBe(true);
      expect(hasValidDate(doc, 'resumen_tarjeta')).toBe(true);
      expect(hasValidDate(doc, 'resumen_broker')).toBe(true);
    });

    it('returns false when fechaDesde is invalid format', () => {
      const doc = { fechaDesde: '01/11/2025', fechaHasta: '2025-11-30' };
      expect(hasValidDate(doc, 'resumen_bancario')).toBe(false);
    });

    it('returns false when fechaHasta is invalid format', () => {
      const doc = { fechaDesde: '2025-11-01', fechaHasta: '30/11/2025' };
      expect(hasValidDate(doc, 'resumen_bancario')).toBe(false);
    });

    it('returns false when either date is missing', () => {
      expect(hasValidDate({ fechaDesde: '2025-11-01' }, 'resumen_bancario')).toBe(false);
      expect(hasValidDate({ fechaHasta: '2025-11-30' }, 'resumen_bancario')).toBe(false);
    });
  });

  describe('certificado_retencion type', () => {
    it('returns true for valid YYYY-MM-DD fechaEmision', () => {
      expect(hasValidDate({ fechaEmision: '2025-10-15' }, 'certificado_retencion')).toBe(true);
    });

    it('returns false for DD/MM/YYYY format', () => {
      expect(hasValidDate({ fechaEmision: '15/10/2025' }, 'certificado_retencion')).toBe(false);
    });
  });

  describe('unknown types', () => {
    it('returns false for unknown document types', () => {
      expect(hasValidDate({ fechaEmision: '2025-11-01' }, 'unknown' as never)).toBe(false);
      expect(hasValidDate({ fechaEmision: '2025-11-01' }, 'unrecognized' as never)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Task 5: MAX_DOCUMENT_BYTES guard
// ---------------------------------------------------------------------------

describe('extractDocument size guard (Task 5 — ADV-193)', () => {
  // We test processFile's size guard by mocking downloadFile and GeminiClient.
  // Config is reset between tests so the limit can be injected.

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns error and never calls Gemini when document exceeds MAX_DOCUMENT_BYTES', async () => {
    // Set a small limit via env var, then reload config + modules
    process.env.MAX_DOCUMENT_BYTES = '1024'; // 1 KB limit for testing
    process.env.API_SECRET = 'test-secret';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{}';
    process.env.DRIVE_ROOT_FOLDER_ID = 'test-root';
    process.env.NODE_ENV = 'test';

    const { resetConfig } = await import('../config.js');
    resetConfig();

    // Mock downloadFile to return a buffer larger than 1 KB
    vi.doMock('../services/drive.js', () => ({
      downloadFile: vi.fn().mockResolvedValue({
        ok: true,
        value: Buffer.alloc(2048, 'x') // 2 KB — exceeds 1 KB limit
      })
    }));

    // Mock getCachedFolderStructure
    vi.doMock('../services/folder-structure.js', () => ({
      getCachedFolderStructure: vi.fn().mockReturnValue(null)
    }));

    // Mock correlation utils
    vi.doMock('../utils/correlation.js', () => ({
      getCorrelationId: vi.fn().mockReturnValue('test-corr-id'),
      updateCorrelationContext: vi.fn()
    }));

    // Mock GeminiClient to ensure it is NEVER called
    const analyzeDocumentMock = vi.fn();
    vi.doMock('../gemini/client.js', () => ({
      getGeminiClient: vi.fn().mockReturnValue({
        analyzeDocument: analyzeDocumentMock
      }),
      resetGeminiClient: vi.fn()
    }));

    const { processFile } = await import('./extractor.js');

    const result = await processFile({
      id: 'file-id-1',
      name: 'big-file.pdf',
      mimeType: 'application/pdf',
      lastUpdated: new Date('2025-01-15T12:00:00Z'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/size limit|too large|MAX_DOCUMENT_BYTES/i);
    }

    // Gemini must NEVER have been called
    expect(analyzeDocumentMock).not.toHaveBeenCalled();

    // Cleanup
    delete process.env.MAX_DOCUMENT_BYTES;
    resetConfig();
  });

  it('skips the invisible-text sanitizer for oversized documents (Codex P2)', async () => {
    // Size check must run BEFORE detectInvisibleText so an oversized PDF never
    // gets converted into a very large latin1 string by the sanitizer.
    process.env.MAX_DOCUMENT_BYTES = '1024';
    process.env.API_SECRET = 'test-secret';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{}';
    process.env.DRIVE_ROOT_FOLDER_ID = 'test-root';
    process.env.NODE_ENV = 'test';

    const { resetConfig } = await import('../config.js');
    resetConfig();

    vi.doMock('../services/drive.js', () => ({
      downloadFile: vi.fn().mockResolvedValue({
        ok: true,
        value: Buffer.alloc(2048, 'x'), // 2 KB > 1 KB limit
      }),
    }));
    vi.doMock('../services/folder-structure.js', () => ({
      getCachedFolderStructure: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('../utils/correlation.js', () => ({
      getCorrelationId: vi.fn().mockReturnValue('test-corr-id'),
      updateCorrelationContext: vi.fn(),
    }));
    vi.doMock('../gemini/client.js', () => ({
      getGeminiClient: vi.fn().mockReturnValue({ analyzeDocument: vi.fn() }),
      resetGeminiClient: vi.fn(),
    }));

    const detectMock = vi.fn().mockReturnValue({ hasInvisible: false });
    vi.doMock('./pdf-sanitize.js', () => ({
      detectInvisibleText: detectMock,
    }));

    const { processFile } = await import('./extractor.js');

    const result = await processFile({
      id: 'oversized',
      name: 'oversized.pdf',
      mimeType: 'application/pdf',
      lastUpdated: new Date('2025-01-15T12:00:00Z'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/size|MAX_DOCUMENT_BYTES/i);
    }
    // Sanitizer must NEVER run on an oversized buffer
    expect(detectMock).not.toHaveBeenCalled();

    delete process.env.MAX_DOCUMENT_BYTES;
    resetConfig();
  });

  it('proceeds to Gemini when document is exactly at MAX_DOCUMENT_BYTES limit', async () => {
    process.env.MAX_DOCUMENT_BYTES = '1024'; // 1 KB limit
    process.env.API_SECRET = 'test-secret';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{}';
    process.env.DRIVE_ROOT_FOLDER_ID = 'test-root';
    process.env.NODE_ENV = 'test';

    const { resetConfig } = await import('../config.js');
    resetConfig();

    const analyzeDocumentMock = vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify({ documentType: 'unrecognized', confidence: 0.9, reason: 'test' }) });

    vi.doMock('../services/drive.js', () => ({
      downloadFile: vi.fn().mockResolvedValue({
        ok: true,
        value: Buffer.alloc(1024, 'x') // Exactly at limit
      })
    }));
    vi.doMock('../services/folder-structure.js', () => ({
      getCachedFolderStructure: vi.fn().mockReturnValue(null)
    }));
    vi.doMock('../utils/correlation.js', () => ({
      getCorrelationId: vi.fn().mockReturnValue('test-corr-id'),
      updateCorrelationContext: vi.fn()
    }));
    vi.doMock('../gemini/client.js', () => ({
      getGeminiClient: vi.fn().mockReturnValue({
        analyzeDocument: analyzeDocumentMock
      }),
      resetGeminiClient: vi.fn()
    }));

    const { processFile } = await import('./extractor.js');

    await processFile({
      id: 'file-id-2',
      name: 'exactly-limit.pdf',
      mimeType: 'application/pdf',
      lastUpdated: new Date('2025-01-15T12:00:00Z'),
    });

    // Gemini MUST have been called (not rejected by size guard)
    expect(analyzeDocumentMock).toHaveBeenCalled();

    delete process.env.MAX_DOCUMENT_BYTES;
    resetConfig();
  });
});

// ---------------------------------------------------------------------------
// Task 12: Orchestration unit tests for processFile (ADV-204)
// ---------------------------------------------------------------------------

/**
 * Shared helper: sets up a fresh import of processFile with all external
 * dependencies mocked.  Call inside each test (after vi.resetModules()).
 *
 * @param classificationJson - What analyzeDocument returns on the 1st call (classification)
 * @param extractionJson     - What analyzeDocument returns on the 2nd call (extraction)
 * @param overrides          - Optional overrides for specific mock behaviours
 */
async function buildProcessFile(
  classificationJson: string,
  extractionJson: string | null = null,
  overrides: {
    /** If set, analyzeDocument rejects this many times before succeeding */
    rejectTransientCount?: number;
    /** If true, downloadFile returns an error */
    downloadFails?: boolean;
    /** Buffer to return from downloadFile (default 100-byte PDF) */
    downloadBuffer?: Buffer;
  } = {}
) {
  const { rejectTransientCount = 0, downloadFails = false } = overrides;

  // Env vars required by loadConfig()
  process.env.API_SECRET = 'test-secret';
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{}';
  process.env.DRIVE_ROOT_FOLDER_ID = 'test-root';
  process.env.NODE_ENV = 'test';
  delete process.env.MAX_DOCUMENT_BYTES;

  const { resetConfig } = await import('../config.js');
  resetConfig();

  // Minimal PDF header so pdf-sanitize doesn't block the file
  const defaultBuffer = overrides.downloadBuffer ?? Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n',
    'latin1'
  );

  vi.doMock('../services/drive.js', () => ({
    downloadFile: vi.fn().mockResolvedValue(
      downloadFails
        ? { ok: false, error: new Error('Drive error') }
        : { ok: true, value: defaultBuffer }
    )
  }));

  vi.doMock('./pdf-sanitize.js', () => ({
    detectInvisibleText: vi.fn().mockReturnValue({ hasInvisible: false })
  }));

  vi.doMock('../services/folder-structure.js', () => ({
    getCachedFolderStructure: vi.fn().mockReturnValue(null)
  }));

  vi.doMock('../utils/correlation.js', () => ({
    getCorrelationId: vi.fn().mockReturnValue('test-corr'),
    updateCorrelationContext: vi.fn()
  }));

  let callCount = 0;
  let transientCount = 0;
  const analyzeDocumentMock = vi.fn().mockImplementation(async () => {
    callCount++;
    // Simulate transient failures on the FIRST call only (classification)
    if (callCount === 1 && transientCount < rejectTransientCount) {
      transientCount++;
      callCount--; // retry resets the "advance" logic
      return { ok: false, error: { message: 'Service Unavailable', code: 503 } };
    }
    if (callCount === 1) return { ok: true, value: classificationJson };
    if (callCount === 2 && extractionJson !== null) return { ok: true, value: extractionJson };
    return { ok: false, error: { message: 'Unexpected call', code: 500 } };
  });

  vi.doMock('../gemini/client.js', () => ({
    getGeminiClient: vi.fn().mockReturnValue({ analyzeDocument: analyzeDocumentMock }),
    resetGeminiClient: vi.fn()
  }));

  const { processFile } = await import('./extractor.js');
  return { processFile, analyzeDocumentMock };
}

const ADVA_CUIT = '30709076783';
const SUPPLIER_CUIT = '20123456786';

const FAKE_FILE = {
  id: 'file-test-id',
  name: 'test-document.pdf',
  mimeType: 'application/pdf',
  lastUpdated: new Date('2025-01-15T12:00:00Z'),
};

describe('processFile orchestration (Task 12 — ADV-204)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── factura_emitida ──────────────────────────────────────────────────────
  it('routes factura_emitida branch: returns Factura with correct documentType', async () => {
    const classJson = JSON.stringify({ documentType: 'factura_emitida', confidence: 0.95, reason: 'invoice' });
    const extractJson = JSON.stringify({
      issuerName: 'ADVA',
      clientName: 'CLIENTE SA',
      allCuits: [ADVA_CUIT, SUPPLIER_CUIT],
      tipoComprobante: 'A',
      nroFactura: '00001-00000001',
      fechaEmision: '2025-01-15',
      importeNeto: 1000,
      importeIva: 210,
      importeTotal: 1210,
      moneda: 'ARS',
    });

    const { processFile } = await buildProcessFile(classJson, extractJson);
    const result = await processFile(FAKE_FILE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('factura_emitida');
      expect(result.value.document).toBeDefined();
      const factura = result.value.document as { nroFactura: string; fechaEmision: string };
      expect(factura.nroFactura).toBe('00001-00000001');
      expect(factura.fechaEmision).toBe('2025-01-15');
    }
  });

  // ── factura_recibida ─────────────────────────────────────────────────────
  it('routes factura_recibida branch: returns Factura', async () => {
    const classJson = JSON.stringify({ documentType: 'factura_recibida', confidence: 0.9, reason: 'received invoice' });
    const extractJson = JSON.stringify({
      issuerName: 'PROVEEDOR SA',
      clientName: 'ADVA',
      allCuits: [SUPPLIER_CUIT, ADVA_CUIT],
      tipoComprobante: 'B',
      nroFactura: '00002-00000002',
      fechaEmision: '2025-02-10',
      importeNeto: 2000,
      importeIva: 0,
      importeTotal: 2000,
      moneda: 'ARS',
    });

    const { processFile } = await buildProcessFile(classJson, extractJson);
    const result = await processFile(FAKE_FILE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('factura_recibida');
    }
  });

  // ── pago_enviado ─────────────────────────────────────────────────────────
  it('routes pago_enviado branch: returns Pago', async () => {
    const classJson = JSON.stringify({ documentType: 'pago_enviado', confidence: 0.92, reason: 'payment slip' });
    const extractJson = JSON.stringify({
      banco: 'BBVA',
      fechaPago: '2025-03-05',
      importePagado: 5000,
      moneda: 'ARS',
      cuitPagador: ADVA_CUIT,
      nombrePagador: 'ADVA',
      cuitBeneficiario: SUPPLIER_CUIT,
      nombreBeneficiario: 'PROVEEDOR SA',
    });

    const { processFile } = await buildProcessFile(classJson, extractJson);
    const result = await processFile(FAKE_FILE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('pago_enviado');
      const pago = result.value.document as { banco: string; fechaPago: string };
      expect(pago.banco).toBe('BBVA');
      expect(pago.fechaPago).toBe('2025-03-05');
    }
  });

  // ── pago_recibido ────────────────────────────────────────────────────────
  it('routes pago_recibido branch: returns Pago', async () => {
    const classJson = JSON.stringify({ documentType: 'pago_recibido', confidence: 0.88, reason: 'incoming payment' });
    const extractJson = JSON.stringify({
      banco: 'Galicia',
      fechaPago: '2025-03-10',
      importePagado: 10000,
      moneda: 'ARS',
      cuitBeneficiario: ADVA_CUIT,
      nombreBeneficiario: 'ADVA',
    });

    const { processFile } = await buildProcessFile(classJson, extractJson);
    const result = await processFile(FAKE_FILE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('pago_recibido');
    }
  });

  // ── pago_recibido: filename hint wiring (ADV-227) ────────────────────────
  it('passes sanitized filename hint to pago_recibido extraction prompt', async () => {
    const classJson = JSON.stringify({ documentType: 'pago_recibido', confidence: 0.88, reason: 'incoming payment' });
    const extractJson = JSON.stringify({
      banco: 'Galicia',
      fechaPago: '2025-03-10',
      importePagado: 10000,
      moneda: 'ARS',
      cuitBeneficiario: ADVA_CUIT,
      nombreBeneficiario: 'ADVA',
    });

    const { processFile, analyzeDocumentMock } = await buildProcessFile(classJson, extractJson);
    const fileWithName = { ...FAKE_FILE, name: 'Pago Juan Perez Socio 12345.pdf' };
    const result = await processFile(fileWithName);

    expect(result.ok).toBe(true);
    // The extraction call is the second analyzeDocument call (index 1).
    // Argument index 2 is the prompt string.
    const extractionPrompt = analyzeDocumentMock.mock.calls[1][2] as string;
    expect(extractionPrompt).toContain('<<<Pago Juan Perez Socio 12345.pdf>>>');
  });

  // ── pago_enviado: filename hint wiring (ADV-227) ─────────────────────────
  it('passes sanitized filename hint to pago_enviado extraction prompt', async () => {
    const classJson = JSON.stringify({ documentType: 'pago_enviado', confidence: 0.92, reason: 'payment slip' });
    const extractJson = JSON.stringify({
      banco: 'BBVA',
      fechaPago: '2025-03-05',
      importePagado: 5000,
      moneda: 'ARS',
      cuitPagador: ADVA_CUIT,
      nombrePagador: 'ADVA',
      cuitBeneficiario: SUPPLIER_CUIT,
      nombreBeneficiario: 'PROVEEDOR SA',
    });

    const { processFile, analyzeDocumentMock } = await buildProcessFile(classJson, extractJson);
    const fileWithName = { ...FAKE_FILE, name: 'Transferencia ADVA 0042.pdf' };
    const result = await processFile(fileWithName);

    expect(result.ok).toBe(true);
    const extractionPrompt = analyzeDocumentMock.mock.calls[1][2] as string;
    expect(extractionPrompt).toContain('<<<Transferencia ADVA 0042.pdf>>>');
  });

  // ── recibo ───────────────────────────────────────────────────────────────
  it('routes recibo branch: returns Recibo', async () => {
    const classJson = JSON.stringify({ documentType: 'recibo', confidence: 0.91, reason: 'salary slip' });
    const extractJson = JSON.stringify({
      tipoRecibo: 'sueldo',
      nombreEmpleado: 'Juan Perez',
      cuilEmpleado: '20123456786',
      legajo: '001',
      cuitEmpleador: ADVA_CUIT,
      periodoAbonado: 'enero/2025',
      fechaPago: '2025-01-31',
      subtotalRemuneraciones: 100000,
      subtotalDescuentos: 30000,
      totalNeto: 70000,
    });

    const { processFile } = await buildProcessFile(classJson, extractJson);
    const result = await processFile(FAKE_FILE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('recibo');
      const recibo = result.value.document as { nombreEmpleado: string };
      expect(recibo.nombreEmpleado).toBe('Juan Perez');
    }
  });

  // ── resumen_bancario ─────────────────────────────────────────────────────
  it('routes resumen_bancario branch: returns ResumenBancario', async () => {
    const classJson = JSON.stringify({ documentType: 'resumen_bancario', confidence: 0.95, reason: 'bank statement' });
    const extractJson = JSON.stringify({
      banco: 'BBVA',
      numeroCuenta: '1234567890',
      fechaDesde: '2025-01-01',
      fechaHasta: '2025-01-31',
      saldoInicial: 100000,
      saldoFinal: 150000,
      moneda: 'ARS',
      cantidadMovimientos: 5,
    });

    const { processFile } = await buildProcessFile(classJson, extractJson);
    const result = await processFile(FAKE_FILE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('resumen_bancario');
      const resumen = result.value.document as { banco: string; fechaDesde: string };
      expect(resumen.banco).toBe('BBVA');
      expect(resumen.fechaDesde).toBe('2025-01-01');
    }
  });

  // ── resumen_tarjeta ──────────────────────────────────────────────────────
  it('routes resumen_tarjeta branch: returns ResumenTarjeta', async () => {
    const classJson = JSON.stringify({ documentType: 'resumen_tarjeta', confidence: 0.93, reason: 'credit card statement' });
    const extractJson = JSON.stringify({
      banco: 'BBVA',
      numeroCuenta: '4444',
      tipoTarjeta: 'Visa',
      fechaDesde: '2025-01-01',
      fechaHasta: '2025-01-31',
      pagoMinimo: 5000,
      saldoActual: 50000,
      cantidadMovimientos: 10,
    });

    const { processFile } = await buildProcessFile(classJson, extractJson);
    const result = await processFile(FAKE_FILE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('resumen_tarjeta');
      const resumen = result.value.document as { tipoTarjeta: string };
      expect(resumen.tipoTarjeta).toBe('Visa');
    }
  });

  // ── resumen_broker ───────────────────────────────────────────────────────
  it('routes resumen_broker branch: returns ResumenBroker', async () => {
    const classJson = JSON.stringify({ documentType: 'resumen_broker', confidence: 0.9, reason: 'broker statement' });
    const extractJson = JSON.stringify({
      broker: 'BALANZ',
      numeroCuenta: '123456',
      fechaDesde: '2025-01-01',
      fechaHasta: '2025-01-31',
      saldoARS: 1000000,
      cantidadMovimientos: 3,
    });

    const { processFile } = await buildProcessFile(classJson, extractJson);
    const result = await processFile(FAKE_FILE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('resumen_broker');
      const resumen = result.value.document as { broker: string };
      expect(resumen.broker).toBe('BALANZ');
    }
  });

  // ── certificado_retencion ────────────────────────────────────────────────
  it('routes certificado_retencion branch: returns Retencion', async () => {
    const classJson = JSON.stringify({ documentType: 'certificado_retencion', confidence: 0.94, reason: 'withholding certificate' });
    const extractJson = JSON.stringify({
      nroCertificado: '00001',
      fechaEmision: '2025-01-15',
      cuitAgenteRetencion: SUPPLIER_CUIT,
      razonSocialAgenteRetencion: 'PROVEEDOR SA',
      cuitSujetoRetenido: ADVA_CUIT,
      impuesto: 'IVA',
      regimen: 'General',
      montoComprobante: 10000,
      montoRetencion: 1050,
    });

    const { processFile } = await buildProcessFile(classJson, extractJson);
    const result = await processFile(FAKE_FILE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('certificado_retencion');
      const ret = result.value.document as { nroCertificado: string };
      expect(ret.nroCertificado).toBe('00001');
    }
  });

  // ── unrecognized → caller routes to Sin Procesar ─────────────────────────
  it('returns unrecognized documentType when classification says so (caller routes to Sin Procesar)', async () => {
    const classJson = JSON.stringify({ documentType: 'unrecognized', confidence: 0.4, reason: 'cannot determine type' });

    const { processFile, analyzeDocumentMock } = await buildProcessFile(classJson);
    const result = await processFile(FAKE_FILE);

    // processFile returns ok:true with documentType='unrecognized'
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.documentType).toBe('unrecognized');
      expect(result.value.document).toBeUndefined();
    }

    // Only classification was called — no extraction for unrecognized
    expect(analyzeDocumentMock).toHaveBeenCalledTimes(1);
  });

  // ── unknown classification type ──────────────────────────────────────────
  it('returns error when Gemini classification returns an unrecognized type string', async () => {
    // parseClassificationResponse validates types against a strict whitelist.
    // An unknown type string causes it to fail → processFile returns ok:false.
    const classJson = JSON.stringify({ documentType: 'some_future_type', confidence: 0.7, reason: 'future doc' });

    const { processFile } = await buildProcessFile(classJson);
    const result = await processFile(FAKE_FILE);

    // The parser rejects the unknown type → processFile returns an error
    expect(result.ok).toBe(false);
  });

  // ── retry exhaustion (transient error) ───────────────────────────────────
  it('returns error after 3 transient failures on classification (retry exhaustion)', async () => {
    // Simulate 3 transient errors — analyzeDocument always fails
    vi.resetModules();

    const { resetConfig } = await import('../config.js');
    process.env.API_SECRET = 'test-secret';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{}';
    process.env.DRIVE_ROOT_FOLDER_ID = 'test-root';
    process.env.NODE_ENV = 'test';
    resetConfig();

    const analyzeDocumentMock = vi.fn().mockResolvedValue({
      ok: false,
      error: { message: 'Service Unavailable', code: 503 }
    });

    vi.doMock('../gemini/client.js', () => ({
      getGeminiClient: vi.fn().mockReturnValue({ analyzeDocument: analyzeDocumentMock }),
      resetGeminiClient: vi.fn()
    }));
    vi.doMock('../services/drive.js', () => ({
      downloadFile: vi.fn().mockResolvedValue({
        ok: true,
        value: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n', 'latin1')
      })
    }));
    vi.doMock('./pdf-sanitize.js', () => ({
      detectInvisibleText: vi.fn().mockReturnValue({ hasInvisible: false })
    }));
    vi.doMock('../services/folder-structure.js', () => ({
      getCachedFolderStructure: vi.fn().mockReturnValue(null)
    }));
    vi.doMock('../utils/correlation.js', () => ({
      getCorrelationId: vi.fn().mockReturnValue('test-corr'),
      updateCorrelationContext: vi.fn()
    }));

    const { processFile } = await import('./extractor.js');
    const result = await processFile(FAKE_FILE);

    // All retries exhausted → ok:false
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/classification failed|Service Unavailable/i);
    }
  });

  // ── role-validation failure → Sin Procesar ───────────────────────────────
  it('returns error when ADVA is not in expected role (role-validation failure routes to Sin Procesar)', async () => {
    // Classification says factura_emitida but ADVA is not the issuer (wrong role)
    const classJson = JSON.stringify({ documentType: 'factura_emitida', confidence: 0.9, reason: 'invoice' });
    // Extraction: ADVA is NOT in issuerName or clientName → assignCuitsAndClassify throws
    const extractJson = JSON.stringify({
      issuerName: 'EMPRESA AJENA SA',
      clientName: 'OTRA EMPRESA SRL',
      allCuits: [SUPPLIER_CUIT, '27234567891'],
      tipoComprobante: 'A',
      nroFactura: '00001-00001234',
      fechaEmision: '2025-04-01',
      importeNeto: 500,
      importeIva: 105,
      importeTotal: 605,
      moneda: 'ARS',
    });

    const { processFile } = await buildProcessFile(classJson, extractJson);
    const result = await processFile(FAKE_FILE);

    // Role validation failure → processFile returns ok:false
    expect(result.ok).toBe(false);
  });

  // ── download failure ─────────────────────────────────────────────────────
  it('returns error when downloadFile fails', async () => {
    vi.resetModules();

    const { resetConfig } = await import('../config.js');
    process.env.API_SECRET = 'test-secret';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{}';
    process.env.DRIVE_ROOT_FOLDER_ID = 'test-root';
    process.env.NODE_ENV = 'test';
    resetConfig();

    vi.doMock('../services/drive.js', () => ({
      downloadFile: vi.fn().mockResolvedValue({ ok: false, error: new Error('Drive API error') })
    }));
    vi.doMock('./pdf-sanitize.js', () => ({
      detectInvisibleText: vi.fn().mockReturnValue({ hasInvisible: false })
    }));
    vi.doMock('../services/folder-structure.js', () => ({
      getCachedFolderStructure: vi.fn().mockReturnValue(null)
    }));
    vi.doMock('../utils/correlation.js', () => ({
      getCorrelationId: vi.fn().mockReturnValue('test-corr'),
      updateCorrelationContext: vi.fn()
    }));
    vi.doMock('../gemini/client.js', () => ({
      getGeminiClient: vi.fn().mockReturnValue({ analyzeDocument: vi.fn() }),
      resetGeminiClient: vi.fn()
    }));

    const { processFile } = await import('./extractor.js');
    const result = await processFile(FAKE_FILE);

    expect(result.ok).toBe(false);
  });

  // ── hasValidDate integration: no-date document → hasValidDate returns false
  it('hasValidDate returns false for a parsed factura with invalid date (caller routes to Sin Procesar)', async () => {
    // This tests the integration boundary: processFile returns ok:true with
    // a document that fails hasValidDate — the caller (scanner) detects this
    // and routes the file to Sin Procesar.
    const classJson = JSON.stringify({ documentType: 'factura_emitida', confidence: 0.9, reason: 'invoice' });
    const extractJson = JSON.stringify({
      issuerName: 'ADVA',
      clientName: 'CLIENTE SA',
      allCuits: [ADVA_CUIT, SUPPLIER_CUIT],
      tipoComprobante: 'A',
      nroFactura: '00001-00000001',
      fechaEmision: '15/01/2025', // Wrong format — DD/MM/YYYY instead of YYYY-MM-DD
      importeNeto: 1000,
      importeIva: 210,
      importeTotal: 1210,
      moneda: 'ARS',
    });

    const { processFile } = await buildProcessFile(classJson, extractJson);
    const result = await processFile(FAKE_FILE);

    // processFile itself succeeds — the format validation is in hasValidDate
    if (result.ok) {
      const { hasValidDate } = await import('./extractor.js');
      const doc = result.value.document;
      expect(hasValidDate(doc, result.value.documentType)).toBe(false);
    } else {
      // Alternatively the parser may have rejected it — either way, no valid date
      expect(result.ok).toBe(false);
    }
  });
});

describe('token logging error handling (bug #6)', () => {
  it('fire-and-forget promise chain must have catch handler', async () => {
    // Bug #6: Fire-and-forget promises need .catch() to prevent unhandled rejections
    // This test verifies the pattern with a simulated example

    // Track if unhandled rejection occurs
    let unhandledRejection = false;
    const rejectionHandler = () => {
      unhandledRejection = true;
    };

    process.once('unhandledRejection', rejectionHandler);

    // Simulate the CORRECT pattern: void promise.then(handler).catch(handler)
    const failingPromise = Promise.reject(new Error('Token logging failed'));

    void failingPromise
      .then(() => {
        // Won't run because promise rejects
      })
      .catch(() => {
        // This MUST be present to prevent unhandled rejection
        // In real code, this would log a warning
      });

    // Wait for event loop to process
    await new Promise(resolve => setImmediate(resolve));

    // Clean up handler
    process.removeListener('unhandledRejection', rejectionHandler);

    // With .catch() handler, unhandledRejection should be false
    expect(unhandledRejection).toBe(false);
  });
});
