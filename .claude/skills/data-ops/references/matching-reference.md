# Matching Reference

Detailed column references and procedures for document matching operations.

## Column Reference

### Control de Ingresos

| Sheet | matchFileId col | matchConfidence col | Notes |
|-------|----------------|-------------------|-------|
| Facturas Emitidas | P (matchedPagoFileId) | Q (matchConfidence) | Links to Pago Recibido |
| Pagos Recibidos | N (matchedFacturaFileId) | O (matchConfidence) | Links to Factura Emitida |
| Retenciones Recibidas | N (matchedFacturaFileId) | O (matchConfidence) | Links to Factura Emitida |

### Control de Egresos

| Sheet | matchFileId col | matchConfidence col | Extra cols | Notes |
|-------|----------------|-------------------|-----------|-------|
| Facturas Recibidas | P (matchedPagoFileId) | Q (matchConfidence) | S (pagada) | Links to Pago Enviado |
| Pagos Enviados | N (matchedFacturaFileId) | O (matchConfidence) | | Links to Factura/Recibo |
| Recibos | Q (matchedPagoFileId) | R (matchConfidence) | | Links to Pago Enviado |

## Match Procedures

### Ingresos: Factura Emitida <-> Pago Recibido

1. Find the FE row (by fileId, nroFactura, or row number) — note its row number and fileId
2. Find the PR row — note its row number and fileId
3. Update via `gsheets_update`:
   - `'Facturas Emitidas'!P{row}` = PR fileId
   - `'Facturas Emitidas'!Q{row}` = MANUAL
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

### Factura Emitida <-> Pago Recibido

- `'Facturas Emitidas'!P{row}` = (empty)
- `'Facturas Emitidas'!Q{row}` = (empty)
- `'Pagos Recibidos'!N{row}` = (empty)
- `'Pagos Recibidos'!O{row}` = (empty)

### Factura Recibida <-> Pago Enviado

- `'Facturas Recibidas'!P{row}` = (empty)
- `'Facturas Recibidas'!Q{row}` = (empty)
- `'Facturas Recibidas'!S{row}` = (empty)
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

**Facturas Emitidas (A:T):** fechaEmision(A), fileId(B), fileName(C), tipoComprobante(D), nroFactura(E), cuitReceptor(F), razonSocialReceptor(G), importeNeto(H), importeIva(I), importeTotal(J), moneda(K), concepto(L), processedAt(M), confidence(N), needsReview(O), matchedPagoFileId(P), matchConfidence(Q), hasCuitMatch(R), pagada(S), tipoDeCambio(T)

**Pagos Recibidos (A:Q):** fechaPago(A), fileId(B), fileName(C), banco(D), importePagado(E), moneda(F), referencia(G), cuitPagador(H), nombrePagador(I), concepto(J), processedAt(K), confidence(L), needsReview(M)

**Retenciones Recibidas (A:O):** fechaEmision(A), fileId(B), fileName(C), nroCertificado(D), cuitAgenteRetencion(E), razonSocialAgenteRetencion(F), impuesto(G), regimen(H), montoComprobante(I), montoRetencion(J), processedAt(K), confidence(L), needsReview(M)

**Facturas Recibidas (A:T):** fechaEmision(A), fileId(B), fileName(C), tipoComprobante(D), nroFactura(E), cuitEmisor(F), razonSocialEmisor(G), importeNeto(H), importeIva(I), importeTotal(J), moneda(K), concepto(L), processedAt(M), confidence(N), needsReview(O), matchedPagoFileId(P), matchConfidence(Q), hasCuitMatch(R), pagada(S), tipoDeCambio(T)

**Pagos Enviados (A:Q):** fechaPago(A), fileId(B), fileName(C), banco(D), importePagado(E), moneda(F), referencia(G), cuitBeneficiario(H), nombreBeneficiario(I), concepto(J), processedAt(K), confidence(L), needsReview(M)

**Recibos (A:R):** fechaPago(A), fileId(B), fileName(C), tipoRecibo(D), nombreEmpleado(E), cuilEmpleado(F), legajo(G), tareaDesempenada(H), cuitEmpleador(I), periodoAbonado(J), subtotalRemuneraciones(K), subtotalDescuentos(L), totalNeto(M), processedAt(N), confidence(O), needsReview(P)
