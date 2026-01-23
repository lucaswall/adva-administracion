# Spreadsheet Schema

Dual control spreadsheets based on money flow direction:

- **Control de Ingresos** - Money IN to ADVA (facturas emitidas, pagos recibidos)
- **Control de Egresos** - Money OUT from ADVA (facturas recibidas, pagos enviados, recibos)

All dates ISO format (YYYY-MM-DD), timestamps ISO datetime.

---

## Control de Ingresos (Money IN)

Located at root: `Control de Ingresos.gsheet`

### Facturas Emitidas (18 columns, A:R)

Invoices FROM ADVA (ADVA is emisor). ADVA info is implicit; only receptor (counterparty) stored.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | fechaEmision | date | Issue date (YYYY-MM-DD) |
| B | fileId | string | Google Drive file ID |
| C | fileName | hyperlink | Link to Drive file |
| D | tipoComprobante | enum | A\|B\|C\|E\|NC\|ND |
| E | nroFactura | string | Full invoice number (e.g., "00003-00001957") |
| F | cuitReceptor | string | Client CUIT (11 digits) |
| G | razonSocialReceptor | string | Client business name |
| H | importeNeto | currency | Net amount before tax |
| I | importeIva | currency | IVA/VAT amount |
| J | importeTotal | currency | Total amount |
| K | moneda | enum | ARS\|USD |
| L | concepto | string | Brief description (optional) |
| M | processedAt | timestamp | Processing timestamp |
| N | confidence | number | Extraction confidence (0.0-1.0) |
| O | needsReview | boolean | Manual review needed |
| P | matchedPagoFileId | string | Linked Pago Recibido fileId |
| Q | matchConfidence | enum | HIGH\|MEDIUM\|LOW |
| R | hasCuitMatch | boolean | Match based on CUIT |

Rows sorted by `fechaEmision` descending after insert.

### Pagos Recibidos (15 columns, A:O)

Payments TO ADVA (ADVA is beneficiario). ADVA info is implicit; only pagador (counterparty) stored.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | fechaPago | date | Payment date (YYYY-MM-DD) |
| B | fileId | string | Google Drive file ID |
| C | fileName | hyperlink | Link to Drive file |
| D | banco | string | Bank name |
| E | importePagado | currency | Amount paid |
| F | moneda | enum | ARS\|USD |
| G | referencia | string | Transaction reference (optional) |
| H | cuitPagador | string | Client CUIT (11 digits) |
| I | nombrePagador | string | Client name |
| J | concepto | string | Payment description (optional) |
| K | processedAt | timestamp | Processing timestamp |
| L | confidence | number | Extraction confidence (0.0-1.0) |
| M | needsReview | boolean | Manual review needed |
| N | matchedFacturaFileId | string | Linked Factura Emitida fileId |
| O | matchConfidence | enum | HIGH\|MEDIUM\|LOW |

Rows sorted by `fechaPago` descending after insert.

### Retenciones Recibidas (15 columns, A:O)

Tax withholding certificates received when ADVA is paid (ADVA is sujeto retenido). ADVA info is implicit; only agente de retencion (withholding agent) stored.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | fechaEmision | date | Certificate issue date (YYYY-MM-DD) |
| B | fileId | string | Google Drive file ID |
| C | fileName | hyperlink | Link to Drive file |
| D | nroCertificado | string | Certificate number |
| E | cuitAgenteRetencion | string | Withholding agent CUIT (11 digits) |
| F | razonSocialAgenteRetencion | string | Withholding agent business name |
| G | impuesto | string | Tax type (e.g., "IVA", "Ganancias") |
| H | regimen | string | Tax regime/code |
| I | montoComprobante | currency | Original invoice amount |
| J | montoRetencion | currency | Amount withheld |
| K | processedAt | timestamp | Processing timestamp |
| L | confidence | number | Extraction confidence (0.0-1.0) |
| M | needsReview | boolean | Manual review needed |
| N | matchedFacturaFileId | string | Linked Factura Emitida fileId |
| O | matchConfidence | enum | HIGH\|MEDIUM\|LOW |

Rows sorted by `fechaEmision` descending after insert.

---

## Control de Egresos (Money OUT)

Located at root: `Control de Egresos.gsheet`

### Facturas Recibidas (19 columns, A:S)

Invoices TO ADVA (ADVA is receptor). ADVA info is implicit; only emisor (counterparty) stored.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | fechaEmision | date | Issue date (YYYY-MM-DD) |
| B | fileId | string | Google Drive file ID |
| C | fileName | hyperlink | Link to Drive file |
| D | tipoComprobante | enum | A\|B\|C\|E\|NC\|ND |
| E | nroFactura | string | Full invoice number (e.g., "00003-00001957") |
| F | cuitEmisor | string | Provider CUIT (11 digits) |
| G | razonSocialEmisor | string | Provider business name |
| H | importeNeto | currency | Net amount before tax |
| I | importeIva | currency | IVA/VAT amount |
| J | importeTotal | currency | Total amount |
| K | moneda | enum | ARS\|USD |
| L | concepto | string | Brief description (optional) |
| M | processedAt | timestamp | Processing timestamp |
| N | confidence | number | Extraction confidence (0.0-1.0) |
| O | needsReview | boolean | Manual review needed |
| P | matchedPagoFileId | string | Linked Pago Enviado fileId |
| Q | matchConfidence | enum | HIGH\|MEDIUM\|LOW |
| R | hasCuitMatch | boolean | Match based on CUIT |
| S | pagada | enum | SI\|NO - Payment status |

Rows sorted by `fechaEmision` descending after insert.

### Pagos Enviados (15 columns, A:O)

Payments BY ADVA (ADVA is pagador). ADVA info is implicit; only beneficiario (counterparty) stored.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | fechaPago | date | Payment date (YYYY-MM-DD) |
| B | fileId | string | Google Drive file ID |
| C | fileName | hyperlink | Link to Drive file |
| D | banco | string | Bank name |
| E | importePagado | currency | Amount paid |
| F | moneda | enum | ARS\|USD |
| G | referencia | string | Transaction reference (optional) |
| H | cuitBeneficiario | string | Provider CUIT (11 digits) |
| I | nombreBeneficiario | string | Provider name |
| J | concepto | string | Payment description (optional) |
| K | processedAt | timestamp | Processing timestamp |
| L | confidence | number | Extraction confidence (0.0-1.0) |
| M | needsReview | boolean | Manual review needed |
| N | matchedFacturaFileId | string | Linked Factura/Recibo fileId |
| O | matchConfidence | enum | HIGH\|MEDIUM\|LOW |

Rows sorted by `fechaPago` descending after insert.

### Recibos (18 columns, A:R)

Employee salary receipts (ADVA is empleador). ADVA info is implicit; only employee stored.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | fechaPago | date | Payment date (YYYY-MM-DD) |
| B | fileId | string | Google Drive file ID |
| C | fileName | hyperlink | Link to Drive file |
| D | tipoRecibo | enum | sueldo\|liquidacion_final |
| E | nombreEmpleado | string | Employee name |
| F | cuilEmpleado | string | Employee CUIL (11 digits) |
| G | legajo | string | Employee number |
| H | tareaDesempenada | string | Job title (optional) |
| I | cuitEmpleador | string | ADVA CUIT (30709076783) |
| J | periodoAbonado | string | Period (e.g., "diciembre/2024") |
| K | subtotalRemuneraciones | currency | Gross salary |
| L | subtotalDescuentos | currency | Total deductions |
| M | totalNeto | currency | Net salary |
| N | processedAt | timestamp | Processing timestamp |
| O | confidence | number | Extraction confidence (0.0-1.0) |
| P | needsReview | boolean | Manual review needed |
| Q | matchedPagoFileId | string | Linked Pago Enviado fileId |
| R | matchConfidence | enum | HIGH\|MEDIUM\|LOW |

Rows sorted by `fechaPago` descending after insert.

---

## Bancos (Bank Statements)

Bank statements stored as files in `{YYYY}/Bancos/` folders (no month subfolders).

### ResumenBancario (13 columns, A:M)

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | fileId | string | Google Drive file ID |
| B | fileName | hyperlink | Link to Drive file |
| C | banco | string | Bank name |
| D | numeroCuenta | string | Account number or card brand |
| E | fechaDesde | date | Statement start date |
| F | fechaHasta | date | Statement end date |
| G | saldoInicial | currency | Opening balance |
| H | saldoFinal | currency | Closing balance |
| I | moneda | enum | ARS\|USD |
| J | cantidadMovimientos | number | Movement count |
| K | processedAt | timestamp | Processing timestamp |
| L | confidence | number | Extraction confidence (0.0-1.0) |
| M | needsReview | boolean | Manual review needed |

---

## Dashboard Operativo Contable

Located at root: `Dashboard Operativo Contable.gsheet`

### Pagos Pendientes (10 columns, A:J)

Unpaid invoices from Control de Egresos. Automatically synced after matching.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | fechaEmision | date | Issue date (YYYY-MM-DD) |
| B | fileId | string | Google Drive file ID |
| C | fileName | string | File name |
| D | tipoComprobante | enum | A\|B\|C\|E\|NC\|ND |
| E | nroFactura | string | Full invoice number |
| F | cuitEmisor | string | Provider CUIT (11 digits) |
| G | razonSocialEmisor | string | Provider business name |
| H | importeTotal | currency | Total amount |
| I | moneda | enum | ARS\|USD |
| J | concepto | string | Brief description (optional) |

Auto-synced from Facturas Recibidas where `pagada != "SI"`.

### Resumen Mensual (7 columns, A:G)

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | fecha | string | Month in YYYY-MM format |
| B | totalLlamadas | number | Total API calls |
| C | tokensEntrada | number | Input tokens |
| D | tokensSalida | number | Output tokens |
| E | costoTotalUSD | currency | Total cost USD |
| F | tasaExito | number | Success rate |
| G | duracionPromedio | number | Average duration |

### Uso de API (12 columns, A:L)

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | timestamp | timestamp | Request timestamp |
| B | requestId | string | Unique request ID |
| C | fileId | string | Processed file ID |
| D | fileName | string | Processed file name |
| E | model | string | Gemini model used |
| F | promptTokens | number | Input tokens |
| G | outputTokens | number | Output tokens |
| H | totalTokens | number | Total tokens |
| I | estimatedCostUSD | currency | Estimated cost |
| J | durationMs | number | Duration in ms |
| K | success | boolean | Request succeeded |
| L | errorMessage | string | Error message if failed |

---

## Direction-Aware Classification

Documents classified by ADVA's role (CUIT: 30709076783):

| Document Type | ADVA's Role | Money Flow | Destination |
|---------------|-------------|------------|-------------|
| Factura Emitida | Emisor | IN → ADVA | Control de Ingresos |
| Factura Recibida | Receptor | OUT ← ADVA | Control de Egresos |
| Pago Recibido | Beneficiario | IN → ADVA | Control de Ingresos |
| Pago Enviado | Pagador | OUT ← ADVA | Control de Egresos |
| Certificado de Retencion | Sujeto Retenido | IN → ADVA | Control de Ingresos |
| Resumen Bancario | Account Holder | Both | Bancos/ folder |
| Recibo | Empleador | OUT ← ADVA | Control de Egresos |

---

## Matching Logic

### Confidence Levels

**Date ranges (relative to invoice/recibo date):**
- **HIGH range**: [0, 15] days after
- **MEDIUM range**: (-3, 30) days
- **LOW range**: (-10, 60) days

**Confidence calculation:**
- **HIGH**: amount match + date in HIGH/MEDIUM range + CUIT/name match
- **MEDIUM**: amount match + date in HIGH/MEDIUM range, no CUIT/name match
- **LOW**: amount match + date in LOW range only

### Cross-References

**Control de Ingresos:**
- `Facturas Emitidas.matchedPagoFileId` ↔ `Pagos Recibidos.matchedFacturaFileId`

**Control de Egresos:**
- `Facturas Recibidas.matchedPagoFileId` ↔ `Pagos Enviados.matchedFacturaFileId`
- `Recibos.matchedPagoFileId` ↔ `Pagos Enviados.matchedFacturaFileId`

### Cross-Currency Matching (USD→ARS)

- USD facturas matched with ARS pagos using historical exchange rates
- Exchange rates from ArgentinaDatos API (official `venta` rate)
- Tolerance: ±5% (configurable via `USD_ARS_TOLERANCE_PERCENT`)
- Confidence: With CUIT match → MEDIUM max; Without CUIT → LOW
- API cache: 24 hours
