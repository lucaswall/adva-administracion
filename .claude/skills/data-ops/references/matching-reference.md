# Matching Reference

Detailed column references and procedures for document matching operations.

> **⚠️ ALWAYS verify column letters against the live header row before writing** (`gsheets_metadata` or read row 1). Schemas evolve — ADV-245 inserted `condicionIVAReceptor` at column H of **Facturas Emitidas only**, shifting every later column right by one (a manual match written with the old letters corrupted a production row). The letters below match `src/constants/spreadsheet-headers.ts` as of 2026-06; the header row is the source of truth.

## Column Reference

### Control de Ingresos

| Sheet | matchFileId col | matchConfidence col | Extra cols | Notes |
|-------|----------------|-------------------|-----------|-------|
| Facturas Emitidas | Q (matchedPagoFileId) | R (matchConfidence) | T (pagada) | Links to Pago Recibido. **21 cols (A:U)** — has condicionIVAReceptor at H |
| Pagos Recibidos | N (matchedFacturaFileId) | O (matchConfidence) | | Links to Factura Emitida |
| Retenciones Recibidas | N (matchedFacturaFileId) | O (matchConfidence) | | Links to Factura Emitida |

### Control de Egresos

| Sheet | matchFileId col | matchConfidence col | Extra cols | Notes |
|-------|----------------|-------------------|-----------|-------|
| Facturas Recibidas | P (matchedPagoFileId) | Q (matchConfidence) | S (pagada) | Links to Pago Enviado. 20 cols (A:T) — NO condicionIVAReceptor |
| Pagos Enviados | N (matchedFacturaFileId) | O (matchConfidence) | | Links to Factura/Recibo |
| Recibos | Q (matchedPagoFileId) | R (matchConfidence) | | Links to Pago Enviado |

## Match Procedures

### Ingresos: Factura Emitida <-> Pago Recibido

1. Find the FE row (by fileId, nroFactura, or row number) — note its row number and fileId
2. Find the PR row — note its row number and fileId
3. Update via `gsheets_update`:
   - `'Facturas Emitidas'!Q{row}` = PR fileId
   - `'Facturas Emitidas'!R{row}` = MANUAL
   - `'Facturas Emitidas'!T{row}` = SI
   - `'Pagos Recibidos'!N{row}` = FE fileId
   - `'Pagos Recibidos'!O{row}` = MANUAL

### Ingresos: Retencion Recibida -> Factura Emitida

One-directional (only the retencion side is updated):

1. Find the RR row — note its row number
2. Find the FE row — note its fileId
3. Update:
   - `'Retenciones Recibidas'!N{row}` = FE fileId
   - `'Retenciones Recibidas'!O{row}` = MANUAL

### Egresos: Factura Recibida <-> Pago Enviado

1. Find the FR row — note its row number and fileId
2. Find the PE row — note its row number and fileId
3. Update:
   - `'Facturas Recibidas'!P{row}` = PE fileId
   - `'Facturas Recibidas'!Q{row}` = MANUAL
   - `'Facturas Recibidas'!S{row}` = SI
   - `'Pagos Enviados'!N{row}` = FR fileId
   - `'Pagos Enviados'!O{row}` = MANUAL

### Egresos: Recibo <-> Pago Enviado

1. Find the Recibo row — note its row number and fileId
2. Find the PE row — note its row number and fileId
3. Update:
   - `'Recibos'!Q{row}` = PE fileId
   - `'Recibos'!R{row}` = MANUAL
   - `'Pagos Enviados'!N{row}` = Recibo fileId
   - `'Pagos Enviados'!O{row}` = MANUAL

## Unmatch Procedures

Clear match columns on both sides by writing empty strings.

**The `pagada` column (T on Facturas Emitidas, S on Facturas Recibidas) is intentionally preserved on unmatch** — clearing it would clobber an `'SI'` set by NC-factura matching. This matches the auto-matcher's behavior (`factura-pago-matcher.ts`: the pagada column is intentionally left untouched).

### Factura Emitida <-> Pago Recibido

- `'Facturas Emitidas'!Q{row}` = (empty)
- `'Facturas Emitidas'!R{row}` = (empty)
- *(do not touch column T, pagada)*
- `'Pagos Recibidos'!N{row}` = (empty)
- `'Pagos Recibidos'!O{row}` = (empty)

### Factura Recibida <-> Pago Enviado

- `'Facturas Recibidas'!P{row}` = (empty)
- `'Facturas Recibidas'!Q{row}` = (empty)
- *(do not touch column S, pagada)*
- `'Pagos Enviados'!N{row}` = (empty)
- `'Pagos Enviados'!O{row}` = (empty)

### Recibo <-> Pago Enviado

- `'Recibos'!Q{row}` = (empty)
- `'Recibos'!R{row}` = (empty)
- `'Pagos Enviados'!N{row}` = (empty)
- `'Pagos Enviados'!O{row}` = (empty)

### Retencion Recibida

- `'Retenciones Recibidas'!N{row}` = (empty)
- `'Retenciones Recibidas'!O{row}` = (empty)

## Finding the Other Side

To find the counterpart of a matched document, search the counterpart sheet for the fileId stored in the match column. For example, if a Factura Emitida has `matchedPagoFileId = "abc123"`, search column B (fileId) of the Pagos Recibidos sheet for `"abc123"`.

## All Sheet Column Schemas

For full column schemas of all sheets, refer to `SPREADSHEET_FORMAT.md` in the project root.

### Quick Field Index (for data correction)

**Facturas Emitidas (A:U):** fechaEmision(A), fileId(B), fileName(C), tipoComprobante(D), nroFactura(E), cuitReceptor(F), razonSocialReceptor(G), condicionIVAReceptor(H), importeNeto(I), importeIva(J), importeTotal(K), moneda(L), concepto(M), processedAt(N), confidence(O), needsReview(P), matchedPagoFileId(Q), matchConfidence(R), hasCuitMatch(S), pagada(T), tipoDeCambio(U)

**Pagos Recibidos (A:Q):** fechaPago(A), fileId(B), fileName(C), banco(D), importePagado(E), moneda(F), referencia(G), cuitPagador(H), nombrePagador(I), concepto(J), processedAt(K), confidence(L), needsReview(M), matchedFacturaFileId(N), matchConfidence(O), tipoDeCambio(P), importeEnPesos(Q)

**Retenciones Recibidas (A:O):** fechaEmision(A), fileId(B), fileName(C), nroCertificado(D), cuitAgenteRetencion(E), razonSocialAgenteRetencion(F), impuesto(G), regimen(H), montoComprobante(I), montoRetencion(J), processedAt(K), confidence(L), needsReview(M), matchedFacturaFileId(N), matchConfidence(O)

**Facturas Recibidas (A:T):** fechaEmision(A), fileId(B), fileName(C), tipoComprobante(D), nroFactura(E), cuitEmisor(F), razonSocialEmisor(G), importeNeto(H), importeIva(I), importeTotal(J), moneda(K), concepto(L), processedAt(M), confidence(N), needsReview(O), matchedPagoFileId(P), matchConfidence(Q), hasCuitMatch(R), pagada(S), tipoDeCambio(T)

**Pagos Enviados (A:Q):** fechaPago(A), fileId(B), fileName(C), banco(D), importePagado(E), moneda(F), referencia(G), cuitBeneficiario(H), nombreBeneficiario(I), concepto(J), processedAt(K), confidence(L), needsReview(M), matchedFacturaFileId(N), matchConfidence(O), tipoDeCambio(P), importeEnPesos(Q)

**Recibos (A:S):** fechaPago(A), fileId(B), fileName(C), tipoRecibo(D), nombreEmpleado(E), cuilEmpleado(F), legajo(G), tareaDesempenada(H), cuitEmpleador(I), periodoAbonado(J), subtotalRemuneraciones(K), subtotalDescuentos(L), totalNeto(M), processedAt(N), confidence(O), needsReview(P), matchedPagoFileId(Q), matchConfidence(R), hasCuitMatch(S)
