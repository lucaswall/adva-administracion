# Spreadsheet Schema

The system uses **dual control spreadsheets** based on money flow direction:

- **Control de Creditos** - Money coming IN to ADVA (facturas emitidas, pagos recibidos)
- **Control de Debitos** - Money going OUT from ADVA (facturas recibidas, pagos enviados, recibos)

All dates ISO format (YYYY-MM-DD), timestamps ISO datetime.

**IMPORTANT: Counterparty-Only Data Model**
- Spreadsheets only store **counterparty** information (the other party in the transaction)
- ADVA's information (CUIT 30709076783) is NOT stored in spreadsheets
- Role validation ensures ADVA is in the correct role before storing documents

---

## Control de Creditos (Money IN)

Located at root: `Control de Creditos.gsheet`

### Facturas Emitidas

Invoices FROM ADVA (ADVA is emisor). These represent money that ADVA expects to receive.

**Columns (A:R, 18 columns):**
```
fechaEmision | fileId | fileName | tipoComprobante | nroFactura | cuitReceptor |
razonSocialReceptor | importeNeto | importeIva | importeTotal | moneda | concepto |
processedAt | confidence | needsReview | matchedPagoFileId | matchConfidence | hasCuitMatch
```

**Note:** Rows are automatically sorted by `fechaEmision` (column A) in descending order (most recent first) after each insert.

**Key Fields:**
- `cuitReceptor`: Client's CUIT (counterparty - ADVA issued invoice TO this client)
- `razonSocialReceptor`: Client's business name
- `nroFactura`: Full invoice number (format: "XXXXX-XXXXXXXX")
- `tipoComprobante`: A|B|C|E|NC|ND
- `moneda`: ARS|USD
- `matchedPagoFileId`: Links to Pagos Recibidos
- `matchConfidence`: HIGH|MEDIUM|LOW
- `hasCuitMatch`: boolean (whether match was based on CUIT)

**ADVA's role:** Emisor (not stored in spreadsheet)

### Pagos Recibidos

Payments TO ADVA (ADVA is beneficiario). These represent money that ADVA has received.

**Columns (A:O, 15 columns):**
```
fechaPago | fileId | fileName | banco | importePagado | moneda | referencia | cuitPagador |
nombrePagador | concepto | processedAt | confidence | needsReview | matchedFacturaFileId |
matchConfidence
```

**Note:** Rows are automatically sorted by `fechaPago` (column A) in descending order (most recent first) after each insert.

**Key Fields:**
- `cuitPagador`: Client's CUIT (counterparty - who sent the payment)
- `nombrePagador`: Client's name
- `matchedFacturaFileId`: Links to Facturas Emitidas
- `matchConfidence`: HIGH|MEDIUM|LOW

**ADVA's role:** Beneficiario (not stored in spreadsheet)

---

## Control de Debitos (Money OUT)

Located at root: `Control de Debitos.gsheet`

### Facturas Recibidas

Invoices TO ADVA (ADVA is receptor). These represent money that ADVA needs to pay.

**Columns (A:R, 18 columns):**
```
fechaEmision | fileId | fileName | tipoComprobante | nroFactura | cuitEmisor |
razonSocialEmisor | importeNeto | importeIva | importeTotal | moneda | concepto |
processedAt | confidence | needsReview | matchedPagoFileId | matchConfidence | hasCuitMatch
```

**Note:** Rows are automatically sorted by `fechaEmision` (column A) in descending order (most recent first) after each insert.

**Key Fields:**
- `cuitEmisor`: Provider's CUIT (counterparty - who issued the invoice TO ADVA)
- `razonSocialEmisor`: Provider's business name
- `nroFactura`: Full invoice number (format: "XXXXX-XXXXXXXX")
- `tipoComprobante`: A|B|C|E|NC|ND
- `moneda`: ARS|USD
- `matchedPagoFileId`: Links to Pagos Enviados
- `matchConfidence`: HIGH|MEDIUM|LOW
- `hasCuitMatch`: boolean (whether match was based on CUIT)

**ADVA's role:** Receptor (not stored in spreadsheet)

### Pagos Enviados

Payments BY ADVA (ADVA is ordenante/pagador). These represent money that ADVA has paid out.

**Columns (A:O, 15 columns):**
```
fechaPago | fileId | fileName | banco | importePagado | moneda | referencia | cuitBeneficiario |
nombreBeneficiario | concepto | processedAt | confidence | needsReview | matchedFacturaFileId |
matchConfidence
```

**Note:** Rows are automatically sorted by `fechaPago` (column A) in descending order (most recent first) after each insert.

**Key Fields:**
- `cuitBeneficiario`: Provider's CUIT (counterparty - who received the payment)
- `nombreBeneficiario`: Provider's name
- `matchedFacturaFileId`: Links to Facturas Recibidas or Recibos
- `matchConfidence`: HIGH|MEDIUM|LOW

**ADVA's role:** Pagador/Ordenante (not stored in spreadsheet)

### Recibos

Employee salary receipts (sueldo, liquidación final). These represent salary payments made by ADVA.

**Columns (A:R, 18 columns):**
```
fechaPago | fileId | fileName | tipoRecibo | nombreEmpleado | cuilEmpleado | legajo |
tareaDesempenada | cuitEmpleador | periodoAbonado | subtotalRemuneraciones |
subtotalDescuentos | totalNeto | processedAt | confidence | needsReview | matchedPagoFileId |
matchConfidence
```

**Note:** Rows are automatically sorted by `fechaPago` (column A) in descending order (most recent first) after each insert.

**Key Fields:**
- `tipoRecibo`: sueldo|liquidacion_final
- `cuitEmpleador`: ADVA's CUIT (30709076783) - **exception: stored for validation**
- `cuilEmpleado`: Employee's CUIL (11 digits, CUIL format)
- `nombreEmpleado`: Employee's name (counterparty)
- `periodoAbonado`: Payment period (e.g., "diciembre/2024")
- `subtotalRemuneraciones`: Gross salary before deductions
- `subtotalDescuentos`: Total deductions
- `totalNeto`: Net salary (subtotalRemuneraciones - subtotalDescuentos)
- `matchedPagoFileId`: Links to Pagos Enviados
- `matchConfidence`: HIGH|MEDIUM|LOW

**ADVA's role:** Empleador (stored for validation purposes)

---

## Bancos (Bank Statements)

**Note:** Bank statements are stored as individual files in year-based `{YYYY}/Bancos/` folders (no month subfolders), not in spreadsheets.

### ResumenBancario

**Columns:**
```
fileId | fileName | banco | numeroCuenta | fechaDesde | fechaHasta | saldoInicial | saldoFinal |
moneda | cantidadMovimientos | processedAt | confidence | needsReview
```

**Key Fields:**
- `banco`: Bank name (e.g., "BBVA", "Santander", "Galicia")
- `numeroCuenta`: Account number
- `fechaDesde`: Statement start date (ISO format: YYYY-MM-DD)
- `fechaHasta`: Statement end date (ISO format: YYYY-MM-DD)
- `saldoInicial`: Opening balance at start of period
- `saldoFinal`: Closing balance at end of period
- `moneda`: ARS|USD
- `cantidadMovimientos`: Number of movements in the period

---

## Direction-Aware Classification

Documents are classified based on ADVA's role (CUIT: 30709076783):

| Document Type | ADVA's Role | Money Flow | Destination | Counterparty Stored |
|---------------|-------------|------------|-------------|---------------------|
| Factura Emitida | Emisor | IN → ADVA | Control de Creditos | Receptor (client) |
| Factura Recibida | Receptor | OUT ← ADVA | Control de Debitos | Emisor (provider) |
| Pago Recibido | Beneficiario | IN → ADVA | Control de Creditos | Pagador (client) |
| Pago Enviado | Pagador/Ordenante | OUT ← ADVA | Control de Debitos | Beneficiario (provider) |
| Resumen Bancario | Account Holder | Both | Bancos/ folder | N/A |
| Recibo | Empleador | OUT ← ADVA | Control de Debitos | Empleado |

**Role Validation:**
- Parser validates ADVA is in the correct role for each document type
- Documents with invalid ADVA roles are rejected and routed to "Sin Procesar"
- Role validation errors are logged at ERROR level with detailed context

---

## Matching Logic

### Match Confidence Levels

**THREE-TIER DATE RANGES (relative to invoice/recibo date):**
- **HIGH range**: [0, 15] days (payment after invoice, within 15 days)
- **MEDIUM range**: (-3, 30) days (payment 3 days before to 30 days after invoice)
- **LOW range**: (-10, 60) days (payment 10 days before to 60 days after invoice)

**CONFIDENCE CALCULATION:**
- **HIGH**: amount match + date within HIGH/MEDIUM range + CUIT/name match
- **MEDIUM**: amount match + date within HIGH/MEDIUM range, no CUIT/name match
- **LOW**: amount match + date within LOW range only (CUIT/name does NOT boost confidence)

### Cross-References

**Control de Creditos:**
- `Facturas Emitidas.matchedPagoFileId` ↔ `Pagos Recibidos.matchedFacturaFileId` (by fileId)

**Control de Debitos:**
- `Facturas Recibidas.matchedPagoFileId` ↔ `Pagos Enviados.matchedFacturaFileId` (by fileId)
- `Recibos.matchedPagoFileId` ↔ `Pagos Enviados.matchedFacturaFileId` (by fileId)

### Match Upgrading

When a new pago matches a factura/recibo with HIGHER quality, the old match is broken:
1. Match quality order: Confidence (HIGH > MEDIUM > LOW), then CUIT/CUIL match (has > no), then date proximity (closer > farther)
2. Old pago is unmatched (cleared) and attempts to re-match to other facturas/recibos
3. All sheets store matchConfidence for quality tracking
4. Legacy matches without stored confidence are treated as LOW (can be upgraded)

### Cross-Currency Matching (USD→ARS)

- USD facturas can be matched with ARS pagos using historical exchange rates
- Exchange rates fetched from ArgentinaDatos API (`api.argentinadatos.com/v1/cotizaciones/dolares/oficial/{YYYY/MM/DD}`)
- Uses `venta` (sell) rate - what you pay in ARS to settle a USD invoice
- Tolerance of ±5% (configurable via `USD_ARS_RATE_TOLERANCE_PERCENT`)
- **Confidence rules for cross-currency matches:**
  - With CUIT match: capped at MEDIUM (never HIGH)
  - Without CUIT match: always LOW
- API responses cached for 24 hours (rates don't change retroactively)
- If API fails: match returns false, user can manually match in spreadsheet

---

## Common Fields

### File Tracking
- `fileId`: Google Drive file ID
- `fileName`: RichTextValue hyperlink to Drive file (formatted with renamed filename)

### Processing Metadata
- `processedAt`: ISO timestamp, text format (prevents Google Sheets auto-parsing)
- `confidence`: Extraction confidence (0.0 to 1.0)
- `needsReview`: boolean (whether manual review is recommended)

### Comprobante Fields
- `nroFactura`: Full invoice number combining point of sale and invoice number (format: "XXXXX-XXXXXXXX")
- `cuit`/`cuil`: 11 digits (mod11 checksum, no dashes)

---

## Logging

The system uses Pino structured logging with configurable log levels:

**Log Levels** (via `LOG_LEVEL` environment variable):
- `DEBUG`: Detailed classification, extraction, and validation information
- `INFO`: Document storage and processing completion
- `WARN`: Non-critical issues (e.g., sort failures)
- `ERROR`: Critical failures (role validation errors, parsing errors)

**DEBUG Logging Includes:**
- Document classification results with confidence and reason
- Gemini API requests/responses (with preview)
- Role validation results
- Extraction confidence and needsReview status

**ERROR Logging Includes:**
- Role validation failures with expected vs. actual roles
- Parsing errors with raw response preview
- Documents routed to "Sin Procesar" with reason

---

## Notes

- Dual spreadsheet design separates money IN (Creditos) from money OUT (Debitos)
- Direction-aware classification automatically routes documents based on ADVA's role
- **Counterparty-only model**: Only non-ADVA party information is stored in spreadsheets
- All spreadsheets and folders are auto-created if missing
- Month subfolders in Creditos/ and Debitos/ are created on demand
- Optional fields use `?` suffix - empty string if absent
- Date columns are always first (column A) for automatic chronological sorting
- Role validation prevents misclassified documents from being stored
