# Spreadsheet Schema

7 sheets: Config, Facturas, Pagos, Recibos, Processed, Errors, Logs. All dates ISO (YYYY-MM-DD), timestamps ISO datetime.

## Config

Key-value configuration storage for non-sensitive settings:

```
Key | Value | LastUpdated
```

- **Key**: Configuration identifier (e.g., "SCAN_ROOT_FOLDER")
- **Value**: Configuration value (folder ID, string, etc.)
- **LastUpdated**: ISO timestamp of last modification

**Current Keys:**
- `SCAN_ROOT_FOLDER`: Google Drive folder ID to scan recursively for invoices, payments, and receipts
- `MOVIMIENTOS_SPREADSHEET_ID`: Google Spreadsheet ID for external bank movements (for auto-fill feature)
- `SUBDIARIO_VENTAS_SPREADSHEET_ID`: Google Spreadsheet ID for external Subdiario de Ventas (for matching bank credits against collections)
- `USD_ARS_RATE_TOLERANCE_PERCENT`: Tolerance percentage for cross-currency matching (default: 5). When matching a USD factura with an ARS pago, allows ±X% variance from the expected amount calculated using historical exchange rate from ArgentinaDatos API

**Notes:**
- Simple key-value design allows extensibility for future config items
- Folder IDs and other non-sensitive config stored here (visible, auditable)
- API keys stored separately in user properties (secure, not visible in spreadsheet)
- Created automatically on first configuration via ADVA > Configuración menu

## Movimientos (External Bank Movements Spreadsheet)

**Note:** This is an EXTERNAL spreadsheet (not part of the main 7-sheet workbook), referenced by `MOVIMIENTOS_SPREADSHEET_ID` in Config.

Stores bank account movements imported from BBVA export files. Used for auto-filling payment information.

### Target Format (User's Movimientos Spreadsheet)

```
FECHA | FECHA_VALOR | CONCEPTO | CODIGO | OFICINA | AREA_ADVA | CREDITO | DEBITO | DETALLE
```

**Structure:**
- **Rows 1-11**: Header information (metadata, bank account details, etc.)
- **Row 12**: Column headers (FECHA, FECHA_VALOR, etc.)
- **Rows 13+**: Data rows (movements)

**Columns:**
1. **FECHA** (Column A): Transaction date (Argentine format: D/M/YYYY or DD/MM/YYYY)
2. **FECHA_VALOR** (Column B): Value date (when transaction takes effect)
3. **CONCEPTO** (Column C): Transaction concept/description (e.g., "TRANSFERENCI 30709076783")
4. **CODIGO** (Column D): Transaction code (e.g., "319")
5. **OFICINA** (Column E): Bank branch/office code (e.g., "500")
6. **AREA_ADVA** (Column F): ADVA area assignment (left empty on import, user fills manually)
7. **CREDITO** (Column G): Credit amount (Argentine format with comma decimal: "1.234,56")
8. **DEBITO** (Column H): Debit amount (Argentine format with comma decimal: "1.234,56")
9. **DETALLE** (Column I): Additional details

**Sorting:** After import, all movements are sorted by FECHA in descending order (newest first).

### Source Format (BBVA Bank Export)

The importer expects BBVA export files with this structure:

**Structure:**
- **Rows 1-6**: Metadata (Empresa, Cuenta, Sucursal, etc.)
- **Row 7**: Column headers
- **Rows 8+**: Data rows

**Source Columns:**
1. Fecha (Column A)
2. Fecha Valor (Column B)
3. Concepto (Column C)
4. Codigo (Column D)
5. Numero Documento (Column E) - NOT imported to target
6. Oficina (Column F)
7. Credito (Column G)
8. Debito (Column H)
9. Detalle (Column I)

### Import Process

1. **Validation**: Checks row 7, column A contains "Fecha" (case-insensitive)
2. **Reading**: Reads all rows from row 8 onwards, skips empty rows (where FECHA is empty)
3. **Deduplication**:
   - Generates deduplication key from: `fecha + fechaValor + concepto + codigo + amount`
   - Dates normalized to ISO format (YYYY-MM-DD)
   - Amounts normalized to absolute value with 2 decimals
   - Concepto lowercased and trimmed
   - Skips movements that already exist in target (same key)
   - Prevents duplicates within import batch
4. **Transformation**:
   - Maps source columns to target columns
   - Omits Numero Documento
   - Sets AREA_ADVA to empty string
   - Preserves original date and amount formats
5. **Appending**: Appends new movements to target starting at row 13 (or last row + 1)
6. **Sorting**: Sorts all data rows by FECHA descending (newest first)

**Deduplication Key Details:**
- Based on: `fecha | fechaValor | concepto | codigo | amount`
- Example: `2025-01-15|2025-01-15|transferenci 30709076783|319|100000.00`
- Amount uses whichever is present: credito or debito
- Ignores: Numero Documento, Oficina, Detalle, AREA_ADVA

**Import Result:**
- `totalSourceRows`: Total movements read from source
- `duplicateRows`: Movements skipped (already exist)
- `newRowsImported`: New movements appended
- `errors`: Array of error messages (empty on success)
- `duration`: Import time in milliseconds

## Facturas
```
fileId fileName folderPath tipoComprobante puntoVenta numeroComprobante fechaEmision
cuitEmisor razonSocialEmisor cuitReceptor? cae fechaVtoCae importeNeto importeIva importeTotal
moneda concepto? processedAt confidence needsReview matchedPagoFileId? matchConfidence? hasCuitMatch?
```
- tipoComprobante: A|B|C|E|NC|ND
- moneda: ARS|USD
- puntoVenta: 4-5 digits zero-padded; numeroComprobante: 8 digits zero-padded
- cae: 14 digits; cuit: 11 digits (mod11 checksum)
- matchConfidence: HIGH|MEDIUM|LOW (tracks quality of match with pago)
- hasCuitMatch: boolean (whether match was based on CUIT match)

## Pagos
```
fileId fileName folderPath banco fechaPago importePagado referencia? cuitPagador?
nombrePagador? cuitBeneficiario? nombreBeneficiario? concepto? processedAt confidence needsReview matchedFacturaFileId? matchConfidence?
```
- cuitBeneficiario: Beneficiary CUIT (receiver of payment) - prioritized for matching with factura emisor
- nombreBeneficiario: Beneficiary name (receiver of payment) - prioritized for matching with factura emisor
- matchConfidence: HIGH|MEDIUM|LOW
  - THREE-TIER DATE RANGES (relative to invoice date):
    - HIGH range: [0, 15] days (payment after invoice, within 15 days)
    - MEDIUM range: (-3, 30) days (payment 3 days before to 30 days after invoice)
    - LOW range: (-10, 60) days (payment 10 days before to 60 days after invoice)
  - CONFIDENCE CALCULATION:
    - HIGH: amount match + date within HIGH/MEDIUM range + CUIT/name match (beneficiary or payer)
    - MEDIUM: amount match + date within HIGH/MEDIUM range, no CUIT/name match
    - LOW: amount match + date within LOW range only (CUIT/name does NOT boost confidence)

## Recibos
```
fileId fileName folderPath tipoRecibo nombreEmpleado cuilEmpleado legajo
cuitEmpleador periodoAbonado fechaPago subtotalRemuneraciones subtotalDescuentos totalNeto
tareaDesempenada? processedAt confidence needsReview matchedPagoFileId? matchConfidence?
```
- tipoRecibo: sueldo|liquidacion_final
- cuilEmpleado: 11 digits (CUIL format, same checksum as CUIT)
- periodoAbonado: Payment period (e.g., "diciembre/2024")
- subtotalRemuneraciones: Gross salary before deductions
- subtotalDescuentos: Total deductions
- totalNeto: Net salary (subtotalRemuneraciones - subtotalDescuentos)
- matchConfidence: HIGH|MEDIUM|LOW
  - Matching logic uses same three-tier date ranges as Facturas (see Pagos section)
  - HIGH: amount (totalNeto) + date within HIGH/MEDIUM range + employee CUIL/name match in pago beneficiary
  - MEDIUM: amount + date within HIGH/MEDIUM range, no CUIL/name match
  - LOW: amount + date within LOW range only (CUIL/name does NOT boost confidence)

## Processed
```
fileId fileName folderPath lastModified processedAt documentType status
```
- documentType: factura|pago|recibo|unrecognized|unknown
- status: processed|pending|error
- Idempotency: skip if fileId+lastModified unchanged and status=processed

## Errors
```
fileId fileName timestamp errorType errorMessage rawResponse?
```
- errorType: DRIVE_ACCESS|GEMINI_API|QUOTA_EXCEEDED|PARSE_ERROR|VALIDATION|SHEET_WRITE

## Logs
```
timestamp level message details?
```
- level: DEBUG|INFO|WARN|ERROR (frozen header row)

## Notes
- fileName: RichTextValue hyperlink to Drive file
- folderPath: relative path from source folder, text format (preserves leading zeros)
- lastModified: text format (preserves ISO string format, prevents Google Sheets auto-parsing)
- ? suffix = optional field (empty string if absent)

### Unified Matching
- Pagos are matched with BOTH Facturas and Recibos in a single pool:
  - Each unmatched Pago is compared against ALL Facturas and ALL Recibos
  - If viable matches exist in both pools, the best match (by quality) is selected
  - Match quality order: Confidence (HIGH > MEDIUM > LOW), then CUIT/CUIL match (has > no), then date proximity (closer > farther)
- Cross-references:
  - Facturas.matchedPagoFileId <-> Pagos.matchedFacturaFileId (by fileId, not row)
  - Recibos.matchedPagoFileId <-> Pagos (outgoing payments where ADVA is payer)

### Match Upgrading
- When a new pago matches a factura/recibo with HIGHER quality, the old match is broken:
  1. Match quality order: Confidence (HIGH > MEDIUM > LOW), then CUIT/CUIL match (has > no), then date proximity (closer > farther)
  2. Old pago is unmatched (cleared) and attempts to re-match to other facturas/recibos
  3. All sheets (Facturas, Pagos, Recibos) store matchConfidence for quality tracking
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

## Subdiario de Ventas (External Spreadsheet)

**Note:** This is an EXTERNAL spreadsheet (not part of the main 7-sheet workbook), referenced by `SUBDIARIO_VENTAS_SPREADSHEET_ID` in Config.

Contains collections (cobros) from clients. Used for matching bank credit movements against expected incoming payments.

### Cobros Sheet Format

**Structure:**
- **Row 15**: Column headers (FECHA DE COBRO, FECHA Fc, COD, TIPO DE COMP, COMPROBANTE N°, CLIENTE, CUIT, CONDICION, TOTAL, CONCEPTO, CATEGORÍA, COMENTARIOS)
- **Row 17+**: Data rows (some rows may be month summaries like "ENERO", "FEBRERO" which are skipped)

**Columns:**
1. **FECHA DE COBRO** (Column A): Collection date (Argentine format: D/M/YYYY)
2. **FECHA Fc** (Column B): Invoice date (Argentine format: D/M/YYYY)
3. **COD** (Column C): Document code (e.g., "FC")
4. **TIPO DE COMP** (Column D): Comprobante type (e.g., "FACTURA")
5. **COMPROBANTE N°** (Column E): Invoice number (e.g., "00003-00001957")
6. **CLIENTE** (Column F): Client name
7. **CUIT** (Column G): Client CUIT (11 digits, may include dashes)
8. **CONDICION** (Column H): Payment condition (e.g., "CUENTA CORRIENTE", "CONTADO")
9. **TOTAL** (Column I): Total amount (Argentine format: "1.234,56")
10. **CONCEPTO** (Column J): Payment concept/description
11. **CATEGORÍA** (Column K): Category
12. **COMENTARIOS** (Column L): Comments

**Month Summary Rows:**
- Rows where the first column contains a month name (ENERO, FEBRERO, MARZO, etc.) are summary rows and are skipped during processing.

### Matching Logic (Two-Pass)

Bank credit movements are matched against Cobros using two passes:

| Pass | Criteria | Confidence |
|------|----------|------------|
| 1 | CUIT extracted from bank Concepto matches Cobros CUIT + amount within ±1 peso + date within ±30 days | HIGH |
| 2 | Amount within ±1 peso + date within ±15 days | MEDIUM |
| 2 | Amount within ±1 peso + date within ±30 days | LOW |

**Important:** Pass 2 runs even if a CUIT was extracted in Pass 1 but didn't match. This allows movements with incorrect/mismatched CUITs to still match based on amount and date.

**Detalle Output Format:**
```
Cobro [CLIENTE] - Fc [COMPROBANTE N°] - [CONCEPTO]
```
Example: `Cobro ECLIPSE ENTERTAINMENT SRL - Fc 00003-00001957 - CUOTA 12/24`
