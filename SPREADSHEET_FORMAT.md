# Spreadsheet Schema

The system uses **dual control spreadsheets** based on money flow direction:

- **Control de Creditos** - Money coming IN to ADVA (facturas emitidas, pagos recibidos)
- **Control de Debitos** - Money going OUT from ADVA (facturas recibidas, pagos enviados, recibos)

All dates ISO format (YYYY-MM-DD), timestamps ISO datetime.

---

## Control de Creditos (Money IN)

Located at root: `Control de Creditos.gsheet`

### Facturas Emitidas

Invoices FROM ADVA (ADVA is emisor). These represent money that ADVA expects to receive.

```
fileId | fileName | tipoComprobante | puntoVenta | numeroComprobante | fechaEmision |
fechaVtoCae | cuitEmisor | razonSocialEmisor | cuitReceptor | cae | importeNeto | importeIva |
importeTotal | moneda | concepto | processedAt | confidence | needsReview | matchedPagoFileId |
matchConfidence | hasCuitMatch
```

**Key Fields:**
- `cuitEmisor`: ADVA's CUIT (30709076783)
- `cuitReceptor`: Client's CUIT (invoice recipient)
- `tipoComprobante`: A|B|C|E|NC|ND
- `moneda`: ARS|USD
- `matchedPagoFileId`: Links to Pagos Recibidos
- `matchConfidence`: HIGH|MEDIUM|LOW
- `hasCuitMatch`: boolean (whether match was based on CUIT)

### Pagos Recibidos

Payments TO ADVA (ADVA is beneficiario). These represent money that ADVA has received.

```
fileId | fileName | banco | fechaPago | importePagado | referencia | cuitPagador |
nombrePagador | cuitBeneficiario | nombreBeneficiario | concepto | processedAt | confidence |
needsReview | matchedFacturaFileId | matchConfidence
```

**Key Fields:**
- `cuitBeneficiario`: ADVA's CUIT (30709076783) - receiver of payment
- `cuitPagador`: Client's CUIT - sender of payment
- `matchedFacturaFileId`: Links to Facturas Emitidas
- `matchConfidence`: HIGH|MEDIUM|LOW

---

## Control de Debitos (Money OUT)

Located at root: `Control de Debitos.gsheet`

### Facturas Recibidas

Invoices TO ADVA (ADVA is receptor). These represent money that ADVA needs to pay.

```
fileId | fileName | tipoComprobante | puntoVenta | numeroComprobante | fechaEmision |
fechaVtoCae | cuitEmisor | razonSocialEmisor | cuitReceptor | cae | importeNeto | importeIva |
importeTotal | moneda | concepto | processedAt | confidence | needsReview | matchedPagoFileId |
matchConfidence | hasCuitMatch
```

**Key Fields:**
- `cuitEmisor`: Provider's CUIT (invoice issuer)
- `cuitReceptor`: ADVA's CUIT (30709076783)
- `tipoComprobante`: A|B|C|E|NC|ND
- `moneda`: ARS|USD
- `matchedPagoFileId`: Links to Pagos Enviados
- `matchConfidence`: HIGH|MEDIUM|LOW
- `hasCuitMatch`: boolean (whether match was based on CUIT)

### Pagos Enviados

Payments BY ADVA (ADVA is ordenante/pagador). These represent money that ADVA has paid out.

```
fileId | fileName | banco | fechaPago | importePagado | referencia | cuitPagador |
nombrePagador | cuitBeneficiario | nombreBeneficiario | concepto | processedAt | confidence |
needsReview | matchedFacturaFileId | matchConfidence
```

**Key Fields:**
- `cuitPagador`: ADVA's CUIT (30709076783) - sender of payment
- `cuitBeneficiario`: Provider's CUIT - receiver of payment
- `matchedFacturaFileId`: Links to Facturas Recibidas or Recibos
- `matchConfidence`: HIGH|MEDIUM|LOW

### Recibos

Employee salary receipts (sueldo, liquidación final). These represent salary payments made by ADVA.

```
fileId | fileName | tipoRecibo | nombreEmpleado | cuilEmpleado | legajo |
tareaDesempenada | cuitEmpleador | periodoAbonado | fechaPago | subtotalRemuneraciones |
subtotalDescuentos | totalNeto | processedAt | confidence | needsReview | matchedPagoFileId |
matchConfidence
```

**Key Fields:**
- `tipoRecibo`: sueldo|liquidacion_final
- `cuitEmpleador`: ADVA's CUIT (30709076783)
- `cuilEmpleado`: Employee's CUIL (11 digits, CUIL format)
- `periodoAbonado`: Payment period (e.g., "diciembre/2024")
- `subtotalRemuneraciones`: Gross salary before deductions
- `subtotalDescuentos`: Total deductions
- `totalNeto`: Net salary (subtotalRemuneraciones - subtotalDescuentos)
- `matchedPagoFileId`: Links to Pagos Enviados
- `matchConfidence`: HIGH|MEDIUM|LOW

---

## Bancos (Bank Statements)

**Note:** Bank statements are stored as individual files in year-based `{YYYY}/Bancos/` folders (no month subfolders), not in spreadsheets.

### ResumenBancario

```
fileId | fileName | banco | fechaDesde | fechaHasta | saldoInicial | saldoFinal |
moneda | cantidadMovimientos | processedAt | confidence | needsReview
```

**Key Fields:**
- `banco`: Bank name (e.g., "BBVA", "Santander", "Galicia")
- `fechaDesde`: Statement start date (ISO format: YYYY-MM-DD)
- `fechaHasta`: Statement end date (ISO format: YYYY-MM-DD)
- `saldoInicial`: Opening balance at start of period
- `saldoFinal`: Closing balance at end of period
- `moneda`: ARS|USD
- `cantidadMovimientos`: Number of movements in the period

---

## Direction-Aware Classification

Documents are classified based on ADVA's role (CUIT: 30709076783):

| Document Type | ADVA's Role | Money Flow | Destination |
|---------------|-------------|------------|-------------|
| Factura Emitida | Emisor | IN → ADVA | Control de Creditos |
| Factura Recibida | Receptor | OUT ← ADVA | Control de Debitos |
| Pago Recibido | Beneficiario | IN → ADVA | Control de Creditos |
| Pago Enviado | Pagador/Ordenante | OUT ← ADVA | Control de Debitos |
| Resumen Bancario | Account Holder | Both | Bancos/ folder |
| Recibo | Empleador | OUT ← ADVA | Control de Debitos |

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
- `fileName`: RichTextValue hyperlink to Drive file

### Processing Metadata
- `processedAt`: ISO timestamp, text format (prevents Google Sheets auto-parsing)
- `confidence`: Extraction confidence (0.0 to 1.0)
- `needsReview`: boolean (whether manual review is recommended)

### Comprobante Fields
- `puntoVenta`: 4-5 digits zero-padded
- `numeroComprobante`: 8 digits zero-padded
- `cae`: 14 digits
- `cuit`/`cuil`: 11 digits (mod11 checksum, no dashes)

---

## Notes

- Dual spreadsheet design separates money IN (Creditos) from money OUT (Debitos)
- Direction-aware classification automatically routes documents based on ADVA's role
- All spreadsheets and folders are auto-created if missing
- Month subfolders in Creditos/ and Debitos/ are created on demand
- Optional fields use `?` suffix - empty string if absent
