# Spreadsheet Schema

Dual control spreadsheets based on money flow direction:

- **Control de Ingresos** - Money IN to ADVA (facturas emitidas, pagos recibidos)
- **Control de Egresos** - Money OUT from ADVA (facturas recibidas, pagos enviados, recibos)

**Date/Time Formatting:**
- **Dates**: ISO format (YYYY-MM-DD) stored as DATE cells
- **Timestamps**: Datetime cells formatted as "yyyy-mm-dd hh:mm:ss" in spreadsheet's timezone
- All timestamps are automatically converted from UTC to the spreadsheet's configured timezone

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

## Bancos (Bank Statements, Credit Cards, Brokers)

Three types of financial statements, each with its own schema and folder structure.

### 1. Resumen Bancario (Bank Account) - 10 columns, A:J

Folder: `{YYYY}/Bancos/{Bank} {Account} {Currency}/`

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | periodo | string | Statement period in YYYY-MM format (derived from fechaHasta) |
| B | fechaDesde | date | Statement start date (serial format) |
| C | fechaHasta | date | Statement end date (serial format) |
| D | fileId | string | Google Drive file ID |
| E | fileName | hyperlink | Link to Drive file |
| F | banco | string | Bank name (BBVA, Santander, etc.) |
| G | numeroCuenta | string | Account number (10+ digits) |
| H | moneda | enum | ARS\|USD |
| I | saldoInicial | currency | Opening balance (2 decimals) |
| J | saldoFinal | currency | Closing balance (2 decimals) |

**Duplicate Detection**: (banco, numeroCuenta, fechaDesde, fechaHasta, moneda)
**Sorting**: Rows sorted by `periodo` (column A) ascending (oldest first)

### 2. Resumen Tarjeta (Credit Card) - 10 columns, A:J

Folder: `{YYYY}/Bancos/{Bank} {CardType} {LastDigits}/`

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | periodo | string | Statement period in YYYY-MM format (derived from fechaHasta) |
| B | fechaDesde | date | Statement start date (serial format) |
| C | fechaHasta | date | Statement end date (serial format) |
| D | fileId | string | Google Drive file ID |
| E | fileName | hyperlink | Link to Drive file |
| F | banco | string | Bank name (BBVA, Santander, etc.) |
| G | numeroCuenta | string | Last 4-8 digits of card |
| H | tipoTarjeta | enum | Visa\|Mastercard\|Amex\|Naranja\|Cabal |
| I | pagoMinimo | currency | Minimum payment due (2 decimals) |
| J | saldoActual | currency | Current balance owed (2 decimals) |

**Duplicate Detection**: (banco, tipoTarjeta, numeroCuenta, fechaDesde, fechaHasta)
**Sorting**: Rows sorted by `periodo` (column A) ascending (oldest first)

### 3. Resumen Broker (Broker/Investment) - 9 columns, A:I

Folder: `{YYYY}/Bancos/{Broker} {Comitente}/`

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | periodo | string | Statement period in YYYY-MM format (derived from fechaHasta) |
| B | fechaDesde | date | Statement start date (serial format) |
| C | fechaHasta | date | Statement end date (serial format) |
| D | fileId | string | Google Drive file ID |
| E | fileName | hyperlink | Link to Drive file |
| F | broker | string | Broker name (BALANZ, IOL, etc.) |
| G | numeroCuenta | string | Comitente number |
| H | saldoARS | currency | Balance in ARS (2 decimals, optional) |
| I | saldoUSD | currency | Balance in USD (2 decimals, optional) |

**Duplicate Detection**: (broker, numeroCuenta, fechaDesde, fechaHasta)
**Note:** Multi-currency accounts - both ARS and USD balances can be present.
**Sorting**: Rows sorted by `periodo` (column A) ascending (oldest first)

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

### API Mensual (8 columns, A:H)

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | fecha | string | Month in YYYY-MM format |
| B | totalLlamadas | number | Total API calls |
| C | tokensEntrada | number | Input tokens |
| D | tokensCache | number | Cached tokens |
| E | tokensSalida | number | Output tokens |
| F | costoTotalUSD | currency | Total cost USD |
| G | tasaExito | number | Success rate |
| H | duracionPromedio | number | Average duration |

### Uso de API (15 columns, A:O)

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | timestamp | timestamp | Request timestamp |
| B | requestId | string | Unique request ID |
| C | fileId | string | Processed file ID |
| D | fileName | string | Processed file name |
| E | model | string | Gemini model used |
| F | promptTokens | number | New input tokens |
| G | cachedTokens | number | Cached content tokens |
| H | outputTokens | number | Output tokens |
| I | promptCostPerToken | currency | Cost per prompt token at request time |
| J | cachedCostPerToken | currency | Cost per cached token at request time |
| K | outputCostPerToken | currency | Cost per output token at request time |
| L | estimatedCostUSD | formula | `=F*I+G*J+H*K` (auto-calculated) |
| M | durationMs | number | Duration in ms |
| N | success | boolean | Request succeeded |
| O | errorMessage | string | Error message if failed |

**Current Standard tier pricing:** Input $0.30/1M, Cached $0.03/1M, Output $2.50/1M
**Source:** https://ai.google.dev/gemini-api/docs/pricing
**Note:** Cost per token columns (J-L) preserve historical pricing for each request

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
| Resumen Tarjeta | Card Holder | Both | Bancos/ folder |
| Resumen Broker | Investor | Both | Bancos/ folder |
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
