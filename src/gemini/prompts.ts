/**
 * Gemini API prompt templates for document extraction
 */

/** ADVA's CUIT - used for direction detection in prompts */
const ADVA_CUIT = '30709076783';

/**
 * Formats a date for use in prompts with month name, year, and month number
 * @param date - Date to format
 * @returns Formatted string like "January 2025 (month 1)"
 */
export function formatCurrentDateForPrompt(date: Date): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[date.getMonth()]} ${date.getFullYear()} (month ${date.getMonth() + 1})`;
}

/**
 * Prompt for classifying document type before extraction
 * Returns classification to determine which extraction prompt to use
 */
export const CLASSIFICATION_PROMPT = `Classify this Argentine document. ADVA (CUIT ${ADVA_CUIT}) is the organization using this system.

DOCUMENT TYPES:

1. "factura_emitida" - Invoice ISSUED BY ADVA (ARCA factura)
   - CUIT ${ADVA_CUIT} at TOP as issuer
   - Money flows IN to ADVA

2. "factura_recibida" - Invoice RECEIVED BY ADVA (ARCA factura)
   - Another company's CUIT at TOP
   - CUIT ${ADVA_CUIT} in client section
   - Money flows OUT from ADVA

3. "pago_enviado" - Payment SENT BY ADVA
   - ADVA in "Ordenante"/"cuenta débito" section
   - Banks: BBVA, Santander, Galicia, Macro
   - Transferencia, Comprobante
   - Money flows OUT from ADVA

4. "pago_recibido" - Payment RECEIVED BY ADVA
   - ADVA in "Beneficiario"/"cuenta crédito" section
   - Banks: BBVA, Santander, Galicia, Macro
   - Transferencia, Comprobante
   - Money flows IN to ADVA

5. "resumen_bancario" - Bank account statement
   - "Movimientos en cuentas", "CC $", "CA $"
   - DÉBITO/CRÉDITO/SALDO columns
   - Account numbers with formatting (e.g., "007-009364/1", "0003043/0")
   - Banks: BBVA, Santander, Galicia, Banco Ciudad, Credicoop

6. "resumen_tarjeta" - Credit card statement
   - "Tarjetas de Crédito", "Resumen de Tarjeta"
   - Card type visible: Visa, Mastercard, Amex, Naranja, Cabal
   - CIERRE ACTUAL, VENCIMIENTO, PAGO MÍNIMO, SALDO ACTUAL
   - Last 4-8 digits of card number

7. "resumen_broker" - Broker/investment statement
   - "Cuenta Corriente por Concertación"
   - "Comitente" number (client account)
   - "Cartera disponible" (available portfolio)
   - Instruments list (bonds, stocks, FCI)
   - Multiple currency sections (Pesos and Dólar MEP)

8. "recibo" - Salary slip
   - "RECIBO DE HABERES", employee CUIL, employer CUIT

9. "certificado_retencion" - Tax withholding certificate
   - "CERTIFICADO DE RETENCIÓN" in header
   - "Agente de Retención" section (who withheld)
   - "Sujeto Retenido" section (ADVA - who received less)
   - ADVA's CUIT ${ADVA_CUIT} appears in "Sujeto Retenido" section
   - Contains: Impuesto, Régimen, Monto de Retención

10. "unrecognized" - None of the above

CRITICAL - HOW TO DETERMINE ADVA's POSITION IN FACTURAS:

Argentine ARCA facturas have TWO distinct sections with CUITs. You MUST identify which section contains ADVA's CUIT ${ADVA_CUIT}.

SECTION 1: ISSUER/EMISOR (Top Left Box)
Contains these fields IN ORDER within the top left bordered box:
- Company name (large text)
- "Razón Social:" followed by company name
- "Domicilio Comercial:" followed by address
- "Condición frente al IVA:" followed by tax status
- Later, there's a "CUIT:" field with 11-digit number

SECTION 2: CLIENT/RECEPTOR (Middle of page)
Contains these fields IN ORDER in the middle area of the document:
- "CUIT:" followed by 11-digit number (appears FIRST in this section)
- "Apellido y Nombre / Razón Social:" followed by client name
- "Domicilio:" followed by client address
- "Condición frente al IVA:" followed by tax status

CRITICAL DECISION RULE:
1. Find the line "Apellido y Nombre / Razón Social:" - this marks the CLIENT section
2. Look ABOVE this line for "CUIT:" - this is the CLIENT's CUIT
3. If that CUIT is ${ADVA_CUIT} → "factura_recibida" (ADVA is the client/buyer)
4. If that CUIT is NOT ${ADVA_CUIT} → Check the top left box for ADVA's CUIT
5. If ADVA's CUIT is in top left box → "factura_emitida" (ADVA is the issuer)

KEY DISTINCTION:
- "Razón Social:" (without "Apellido y Nombre /") = ISSUER
- "Apellido y Nombre / Razón Social:" (with "Apellido y Nombre /") = CLIENT

The CUIT that appears immediately ABOVE "Apellido y Nombre / Razón Social:" is ALWAYS the client's CUIT.

RECOGNIZING FACTURAS:

An Argentine factura (fiscal invoice document) typically has these characteristics:
- Large letter in header: "A", "B", "C", "E" (sometimes with "COD. 011" for C)
- "FACTURA" or "FACTURA ORIGINAL" text prominently displayed
- "Punto de Venta" and "Comp. Nro" fields (for standard ARCA facturas)
- "CAE N°:" or "CAE:" followed by 14-digit number (most standard ARCA facturas)
- "Fecha de Vto. de CAE:" (most standard ARCA facturas)
- ARCA/AFIP logo or text at bottom
- "Comprobante Autorizado" text

INSURANCE DOCUMENTS (Liquidación de Premio):
Insurance companies are legally exempt from CAE requirement (RG AFIP 1415/03, Inciso d, Anexo I).
Insurance invoices have:
- "LIQUIDACIÓN DE PREMIO" or "FACTURA ORIGINAL" header
- "PÓLIZA" number instead of standard invoice number
- Text stating: "Las compañías de seguros se encuentran exceptuadas..."
- Full CUIT structure with issuer and client sections
These ARE valid facturas - classify based on ADVA's CUIT position (emitida or recibida).

If a document has the factura characteristics above, classify it as factura_emitida or factura_recibida based on ADVA's position.

Return ONLY valid JSON, no additional text:
{
  "documentType": "...",
  "confidence": 0.95,
  "reason": "Brief explanation of ADVA position",
  "indicators": ["key evidence found"]
}`;

/**
 * Prompt for extracting data from Argentine ARCA facturas
 *
 * IMPORTANT: This prompt extracts issuerName, clientName, and allCuits SEPARATELY.
 * The code then assigns CUITs based on ADVA name matching, because Gemini
 * correctly identifies names but cannot reliably pair CUITs with their names.
 */
export const FACTURA_PROMPT = `You are analyzing an Argentine ARCA invoice (factura). Extract data and return it as JSON.

CRITICAL - NAME AND CUIT EXTRACTION:
Extract the NAMES of issuer and client based on their POSITION in the document.
Extract ALL CUITs found as a separate list - do NOT try to pair them with names.

DOCUMENT STRUCTURE:
1. ISSUER (Emisor): Company at TOP/HEADER section - the one ISSUING the invoice
   - LOCATION: Physically at the TOP of the document, in the header/letterhead area
   - Extract the NAME of this company/person

2. CLIENT (Receptor): Company in CLIENT section below - labeled "Razón Social", "Cliente", "Señor/es", "Apellido y Nombre"
   - LOCATION: In the CLIENT/BUYER section below the header, typically mid-page
   - Extract the NAME of this company/person

3. ALL CUITs: Find ALL CUITs anywhere in the document
   - List each unique CUIT found (11 digits, formatted as XX-XXXXXXXX-X or XXXXXXXXXXX)
   - Do NOT assign CUITs to specific parties - just list them all

## INSURANCE DOCUMENTS (Liquidación de Premio)

Insurance companies in Argentina are exempt from standard AFIP invoice requirements
(RG AFIP 1415/03, Inciso d, Anexo I). Their settlement documents use different numbering.

DETECTING INSURANCE DOCUMENTS:
- Header contains "SEGUROS", "ASEGURADORA", or insurance company name
- Document labeled "LIQUIDACIÓN DE PREMIO", "ENDOSO", "PÓLIZA"
- No CAE authorization code
- Contains "PÓLIZA" number instead of standard invoice number

FOR INSURANCE DOCUMENTS:
- Extract the PÓLIZA number from the header
- Format nroFactura as "POL-{poliza_number}" (e.g., "POL-10028114")
- Set tipoComprobante to "LP" (Liquidación de Premio)
- These are valid fiscal documents for accounting purposes

Required fields to extract:
- issuerName: The NAME of the company/person at the TOP of the document (issuer/emisor)
- clientName: The NAME of the company/person in the CLIENT section (receptor)
- allCuits: Array of ALL CUITs found in the document (as strings, 11 digits each, no dashes)
- tipoComprobante: ONLY the single letter code (A, B, C, E) or two-letter code (NC for Nota de Crédito, ND for Nota de Débito, LP for Liquidación de Premio). DO NOT include the word "FACTURA" - extract ONLY the letter code that follows it. Examples: if the document shows "FACTURA C", extract "C"; if it shows "FACTURA B", extract "B".
- nroFactura: Full invoice number combining point of sale and invoice number (format: "XXXXX-XXXXXXXX" or "XXXX-XXXXXXXX"). Example: "00003-00001957" or "0003-00001957". For insurance documents, use "POL-{poliza_number}" format.
- fechaEmision: Issue date (format as YYYY-MM-DD)
- importeNeto: Net amount before tax (number)
- importeIva: IVA/VAT amount (number). For Type C invoices, set to 0 if not itemized.
- importeTotal: Total amount (number)
- moneda: Currency (ARS or USD)

Optional fields:
- concepto: Brief one-line summary describing what the invoice is for. Analyze the line items/services listed in the invoice and summarize them (e.g., "Desarrollo de software para pagina web de ADVA", "Alojamiento y comidas para viaje a Tierra del Fuego", "Servicios de hosting y dominio para portal institucional"). IMPORTANT: Do NOT use tax category labels like "EXENTO", "GRAVADO", "NO GRAVADO" as the concepto - these are tax classifications, not descriptions.

Return ONLY valid JSON in this exact format:
{
  "issuerName": "EMPRESA SA",
  "clientName": "CLIENTE SA",
  "allCuits": ["20123456786", "30712345678"],
  "tipoComprobante": "A",
  "nroFactura": "00001-00000123",
  "fechaEmision": "2024-01-15",
  "importeNeto": 1000.00,
  "importeIva": 210.00,
  "importeTotal": 1210.00,
  "moneda": "ARS",
  "concepto": "Servicios profesionales"
}

Important:
- Return ONLY the JSON object, no additional text
- If a field is not visible, omit it from the JSON (except importeIva - set to 0 if not itemized)
- CRITICAL: tipoComprobante must be ONLY the letter code (A, B, C, E, NC, ND), NOT "FACTURA" or "FACTURA A" - just the letter(s)
- Ensure all dates are in YYYY-MM-DD format
- Remove dashes, spaces and slashes from CUIT numbers in allCuits array
- CRITICAL: Argentine number format uses DOTS (.) as thousand separators and COMMA (,) as decimal separator
  Example: "2.917.310,00" or "2917310,00" both mean 2917310.00 (two million nine hundred seventeen thousand)
  Example: "439.200,00" or "439200,00" both mean 439200.00 (four hundred thirty-nine thousand)
- Convert all amounts to standard numeric format (remove thousand separators, convert comma to decimal point)
- Ensure numeric fields are numbers, not strings
- REMEMBER: issuerName is at the TOP of the document, clientName is in the client/buyer section below
- For allCuits: Include ALL CUITs found anywhere in the document, do not try to associate them with parties`;

/**
 * Prompt for extracting data from BBVA and other bank payment slips
 */
export const PAGO_BBVA_PROMPT = `Extract data from this Argentine bank payment slip (BBVA, Santander, etc).

IMPORTANT - ADVA IDENTIFICATION:
ADVA's CUIT is ${ADVA_CUIT}. Based on the classification you received:

FOR PAGOS ENVIADOS (ADVA is pagador):
- ADVA sent this payment, so pagador should be ADVA
- Extract ONLY beneficiario information: cuitBeneficiario, nombreBeneficiario
- You may extract pagador fields to validate ADVA's position, but focus on beneficiario

FOR PAGOS RECIBIDOS (ADVA is beneficiario):
- ADVA received this payment, so beneficiario should be ADVA
- Extract ONLY pagador information: cuitPagador, nombrePagador
- You may extract beneficiario fields to validate ADVA's position, but focus on pagador

VALIDATION:
- Extract the CUIT from the position that should contain ADVA
- If it's NOT ${ADVA_CUIT}, this document may be misclassified

PAYMENT STRUCTURE - look for these section labels:
- PAYER: "Ordenante", "Datos del Ordenante", "cuenta débito" = who SENDS money
- BENEFICIARY: "Beneficiario", "Destinatario", "cuenta crédito" = who RECEIVES money

Required fields:
- banco: Bank name (e.g., "BBVA", "Santander", "Galicia")
- fechaPago: YYYY-MM-DD
- importePagado: number (amount paid)
- moneda: ARS or USD (default ARS)

Optional fields:
- referencia: Transaction ID
- cuitPagador: Payer CUIT (11 digits) or DNI (7-8 digits). Remove dashes.
- nombrePagador: Payer name
- cuitBeneficiario: Beneficiary CUIT (11 digits) or DNI (7-8 digits). Remove dashes.
- nombreBeneficiario: Beneficiary name
- concepto: Payment description

NUMBER FORMAT: "2.917.310,00" = 2917310.00 (dots=thousands, comma=decimal)

Return ONLY valid JSON, no additional text. If a field is not visible, omit it:
{
  "banco": "BBVA",
  "fechaPago": "2024-01-18",
  "importePagado": 1210.00,
  "moneda": "ARS",
  "cuitPagador": "30709076783",
  "nombrePagador": "ADVA",
  "cuitBeneficiario": "30712345678",
  "nombreBeneficiario": "EMPRESA SA"
}`;

/**
 * Prompt for extracting data from Argentine salary payment slips
 */
export const RECIBO_PROMPT = `Extract data from this Argentine salary payment slip (Recibo de Sueldo).

VALIDATION - ADVA IS EMPLOYER:
- cuitEmpleador MUST be ${ADVA_CUIT} (ADVA is the employer)
- If cuitEmpleador is different, this document is misclassified

Required fields:
- tipoRecibo: "sueldo" (regular) or "liquidacion_final" (severance)
- nombreEmpleado: Employee name
- cuilEmpleado: 11 digits, no dashes
- legajo: Employee number
- cuitEmpleador: 11 digits, no dashes
- periodoAbonado: Payment period (e.g., "diciembre/2024")
- fechaPago: YYYY-MM-DD
- subtotalRemuneraciones: Gross salary (total haberes)
- subtotalDescuentos: Total deductions
- totalNeto: Net amount

Optional:
- tareaDesempenada: Job title

NUMBER FORMAT: "2.346.822,36" = 2346822.36

Return JSON only:
{
  "tipoRecibo": "sueldo",
  "nombreEmpleado": "MARTIN, Miguel",
  "cuilEmpleado": "20271190523",
  "legajo": "1",
  "cuitEmpleador": "30709076783",
  "periodoAbonado": "diciembre/2024",
  "fechaPago": "2024-12-30",
  "subtotalRemuneraciones": 2346822.36,
  "subtotalDescuentos": 398959.80,
  "totalNeto": 1947863.00
}`;

/**
 * Generates prompt for extracting data from bank account statements (Resumen/Extracto Bancario)
 * For bank accounts only - NOT credit cards or broker statements
 *
 * @param currentDate - Date to use for dynamic inference (defaults to now)
 * @returns Prompt string with dynamic date for year inference
 */
export function getResumenBancarioPrompt(currentDate: Date = new Date()): string {
  const dateInfo = formatCurrentDateForPrompt(currentDate);

  return `Extract data from this Argentine bank account statement (Resumen/Extracto Bancario).

This is a BANK ACCOUNT statement (not credit card, not broker).
Look for: DÉBITO/CRÉDITO columns, Saldo Inicial/Final.

Required fields:
- banco: Bank name (e.g., "BBVA", "Santander", "Galicia", "Banco Ciudad", "Credicoop")
- numeroCuenta: Bank account number WITH its formatting (NOT the CBU!)
  - CRITICAL: CBU is 22 digits - DO NOT extract this as the account number
  - Account numbers are SHORT (4-10 digits) and include slashes, dots, dashes - preserve these!
  - Examples of what TO extract:
    - BBVA: "CC $ 007-009364/1" → extract "007-009364/1"
    - Banco Ciudad: "CUENTA NÚMERO: 0003043/0" → extract "0003043/0"
    - Credicoop: "Cta. 191.001.066458.4" → extract "191.001.066458.4"
    - Santander: "Nro. Cuenta: 123-456789/0" → extract "123-456789/0"
  - Look for labels like "Cta.", "CUENTA", "CC $", "CA $", "Nro. Cuenta"
  - The CBU is usually labeled separately as "CBU" - ignore it
- fechaDesde: YYYY-MM-DD - The date of the FIRST transaction in the FECHA column
- fechaHasta: YYYY-MM-DD - The date from the "SALDO AL" closing line
- saldoInicial: The "SALDO ANTERIOR" amount (balance before first transaction)
- saldoFinal: The "SALDO AL" amount (closing balance)
- moneda: ARS or USD (look for "u$s", "USD", "U$S" for USD)
- cantidadMovimientos: Count of transactions (0 if "SIN MOVIMIENTOS")

CRITICAL DATE EXTRACTION RULES:

1. fechaDesde = Date of the FIRST transaction in the movement table
   - Look at the FECHA column in "Movimientos en cuentas" section
   - Find the very first date listed AFTER "SALDO ANTERIOR"
   - Example: If first transaction row shows "31/03" → fechaDesde is that date
   - DO NOT use the first day of the month - use the ACTUAL first transaction date

2. fechaHasta = Date from the "SALDO AL" closing line
   - Look for text like "SALDO AL 30 DE ABRIL" or "SALDO AL 31 DE MARZO"
   - Extract this date exactly as stated
   - Example: "SALDO AL 30 DE ABRIL" → fechaHasta is April 30

3. For "SIN MOVIMIENTOS" statements (no transactions):
   - fechaDesde: Use first day of the month from "SALDO AL" text
   - fechaHasta: Use the "SALDO AL" date

YEAR INFERENCE (when only DD/MM is shown):

TIER 1 - Look for explicit years in document:
- Barcode contains YYYYMMDD (e.g., "110074769202505052DIGITAL" → 20250505)
- "información al:" dates (e.g., "información al: 01/04/2025")
- Tax sections: "MARZO 2025", "ABRIL 2025"
- Full dates: DD/MM/YYYY anywhere in document

TIER 2 - Transaction dates with years:
- Tax lines: "IMP.LEY 25413 01/12/25" → year is 2025
- Short year format: DD/MM/YY where YY = 20YY

TIER 3 - Dynamic inference (only if NO year found):
- Current date: ${dateInfo}
- If document month > current month → use previous year
- If document month <= current month → use current year

NUMBER FORMAT: "2.917.310,00" = 2917310.00

TRANSACTION EXTRACTION:
Extract ALL individual transactions from the movements table.

For each transaction:
- fecha: Transaction date (YYYY-MM-DD)
- origenConcepto: Full description combining origin and concept (e.g., "D 500 TRANSFERENCIA RECIBIDA")
- debito: Debit amount or null (if this is a credit transaction)
- credito: Credit amount or null (if this is a debit transaction)
- saldo: Running balance after this transaction

Include in response:
"movimientos": [
  {"fecha": "2024-01-02", "origenConcepto": "D 500 TRANSFERENCIA RECIBIDA", "debito": null, "credito": 50000.00, "saldo": 200000.00},
  {"fecha": "2024-01-05", "origenConcepto": "D 003 PAGO TARJETA VISA", "debito": 15000.00, "credito": null, "saldo": 185000.00}
]

If statement shows "SIN MOVIMIENTOS" or no transactions: return "movimientos": []

Return ONLY valid JSON:
{
  "banco": "BBVA",
  "numeroCuenta": "007-009364/1",
  "fechaDesde": "2024-01-02",
  "fechaHasta": "2024-01-31",
  "saldoInicial": 150000.00,
  "saldoFinal": 185000.00,
  "moneda": "ARS",
  "cantidadMovimientos": 47,
  "movimientos": [
    {"fecha": "2024-01-02", "origenConcepto": "D 500 TRANSFERENCIA", "debito": null, "credito": 50000.00, "saldo": 200000.00}
  ]
}`;
}

/**
 * Generates prompt for extracting data from credit card statements (Resumen de Tarjeta)
 *
 * @param currentDate - Date to use for dynamic inference (defaults to now)
 * @returns Prompt string with dynamic date for year inference
 */
export function getResumenTarjetaPrompt(currentDate: Date = new Date()): string {
  const dateInfo = formatCurrentDateForPrompt(currentDate);

  return `Extract data from this Argentine credit card statement (Resumen de Tarjeta de Crédito).

Look for: card type (Visa, Mastercard, Amex, Naranja, Cabal), last 4-8 digits, PAGO MÍNIMO, SALDO ACTUAL.

Required fields:
- banco: Bank name (e.g., "BBVA", "Santander", "Galicia")
- tipoTarjeta: One of: Visa, Mastercard, Amex, Naranja, Cabal
- numeroCuenta: Last 4-8 digits of card number (e.g., "65656454")
- fechaDesde, fechaHasta: YYYY-MM-DD (statement period - look for "CIERRE ANTERIOR" and "CIERRE ACTUAL")
- pagoMinimo: Minimum payment due (may be labeled "PAGO MÍNIMO")
- saldoActual: Current balance owed (may be labeled "SALDO ACTUAL", "TOTAL A PAGAR")
- cantidadMovimientos: Count of transactions

DATE EXTRACTION (CRITICAL - THREE-TIER APPROACH):

TIER 1 - CLEAR LABELS (always try this first):
Look for explicit closing dates with years:
- CIERRE ACTUAL with year: "CIERRE ACTUAL 30-Oct-25" → 2025-10-30
- CIERRE ANTERIOR with year: "CIERRE ANTERIOR 30-Sep-25" → 2025-09-30
- Full date format: "02-Oct-25", "13-Oct-25" → 2025-10-02, 2025-10-13
- Text dates: "1 de septiembre de 2025" → 2025-09-01
If you find years in DD-MMM-YY format, YY = 20YY (e.g., 25 = 2025).

TIER 2 - TRANSACTION DATES (if no clear closing date with year):
Infer year from transaction dates in the document:
- Transaction lines often show dates like "02-Oct-25" or "13/10/25"
- Use the most common year found in transactions.

TIER 3 - DYNAMIC INFERENCE (only for statements without explicit years):
ONLY use this if the document has NO year information:
- Current date: ${dateInfo}
- If document month > current month → use previous year
- If document month <= current month → use current year
Example: If current date is January and document shows "CIERRE ACTUAL 30-Oct", October > January, so use previous year.

NUMBER FORMAT: "2.917.310,00" = 2917310.00

TRANSACTION EXTRACTION:
Extract ALL transactions from the credit card statement.

For each transaction:
- fecha: Transaction date (YYYY-MM-DD)
- descripcion: Full description (e.g., "ZOOM.COM 888-799 P38264908USD 16,99")
- nroCupon: Receipt/coupon number or null if not present
- pesos: ARS amount or null (for USD transactions)
- dolares: USD amount or null (for ARS transactions)

Include in response:
"movimientos": [
  {"fecha": "2024-10-11", "descripcion": "ZOOM.COM 888-799", "nroCupon": "12345678", "pesos": 1500.00, "dolares": null},
  {"fecha": "2024-10-13", "descripcion": "AMAZON.COM", "nroCupon": null, "pesos": null, "dolares": 25.99}
]

If no transactions or empty statement: return "movimientos": []

Return ONLY valid JSON:
{
  "banco": "BBVA",
  "tipoTarjeta": "Visa",
  "numeroCuenta": "65656454",
  "fechaDesde": "2024-01-01",
  "fechaHasta": "2024-01-31",
  "pagoMinimo": 25000.00,
  "saldoActual": 125000.00,
  "cantidadMovimientos": 12,
  "movimientos": [
    {"fecha": "2024-10-11", "descripcion": "ZOOM.COM", "nroCupon": "12345678", "pesos": 1500.00, "dolares": null}
  ]
}`;
}

/**
 * Generates prompt for extracting data from broker/investment statements (Resumen de Broker)
 *
 * @param currentDate - Date to use for dynamic inference (defaults to now)
 * @returns Prompt string with dynamic date for year inference
 */
export function getResumenBrokerPrompt(currentDate: Date = new Date()): string {
  const dateInfo = formatCurrentDateForPrompt(currentDate);

  return `Extract data from this Argentine broker/investment account statement.

Look for: "Comitente" number, "Cartera disponible", portfolio instruments, multiple currency sections.

Required fields:
- broker: Broker name (e.g., "BALANZ CAPITAL VALORES SAU", "IOL INVERTIRONLINE", "PPI")
- numeroCuenta: Comitente number (client account number)
- fechaDesde, fechaHasta: YYYY-MM-DD (statement period)
- cantidadMovimientos: Count of movements/transactions

Optional fields (extract if visible):
- saldoARS: Balance in ARS (Pesos) - look for "Saldo en Pesos", "ARS"
- saldoUSD: Balance in USD (Dólares) - look for "Saldo en Dólares", "USD", "Dólar MEP"

NOTE: Broker accounts are multi-currency. Extract both ARS and USD balances if available.

DATE EXTRACTION (CRITICAL - THREE-TIER APPROACH):

TIER 1 - CLEAR LABELS (always try this first):
Look for explicit Period headers with years:
- Period headers: "del 1/7/2025 al 31/7/2025" or "del 1/12/2025 al 31/12/2025"
- Balance dates: "Saldo al 31/07/2025", "Saldo al 31/12/2025"
- Date ranges with D/M/YYYY or DD/MM/YYYY format
If you find years in the document, use them directly.

TIER 2 - TRANSACTION DATES (if no clear period label with year):
Infer year from transaction dates or holdings dates:
- Transaction dates in D/M/YYYY format
- Settlement dates, purchase dates
Use the most common year found.

TIER 3 - DYNAMIC INFERENCE (only for statements without explicit years):
ONLY use this if the document has NO year information:
- Current date: ${dateInfo}
- If document month > current month → use previous year
- If document month <= current month → use current year
Example: If current date is January and document shows "del 1/12 al 31/12", December > January, so use previous year.

NUMBER FORMAT: "2.917.310,00" = 2917310.00

TRANSACTION EXTRACTION:
Extract ALL movements from the broker statement.

For each movement:
- descripcion: Transaction description (e.g., "Boleto / VENTA / ZZC1O")
- cantidadVN: Quantity/Nominal Value or null if not applicable
- saldo: Balance after this transaction
- precio: Price per unit or null if not applicable
- bruto: Gross amount or null if not applicable
- arancel: Fee/tariff amount or null if not applicable
- iva: VAT amount or null if not applicable
- neto: Net amount or null if not applicable
- fechaConcertacion: Trade date (YYYY-MM-DD)
- fechaLiquidacion: Settlement date (YYYY-MM-DD)

Include in response:
"movimientos": [
  {
    "descripcion": "Boleto / VENTA / ZZC1O",
    "cantidadVN": 100.00,
    "saldo": 500000.00,
    "precio": 1250.00,
    "bruto": 125000.00,
    "arancel": 50.00,
    "iva": 10.50,
    "neto": 124939.50,
    "fechaConcertacion": "2024-07-07",
    "fechaLiquidacion": "2024-07-09"
  }
]

If no movements or empty statement: return "movimientos": []

Return ONLY valid JSON:
{
  "broker": "BALANZ CAPITAL VALORES SAU",
  "numeroCuenta": "123456",
  "fechaDesde": "2024-01-01",
  "fechaHasta": "2024-01-31",
  "saldoARS": 500000.00,
  "saldoUSD": 1500.00,
  "cantidadMovimientos": 8,
  "movimientos": [
    {
      "descripcion": "Boleto / VENTA / ZZC1O",
      "cantidadVN": 100.00,
      "saldo": 500000.00,
      "precio": 1250.00,
      "bruto": 125000.00,
      "arancel": 50.00,
      "iva": 10.50,
      "neto": 124939.50,
      "fechaConcertacion": "2024-07-07",
      "fechaLiquidacion": "2024-07-09"
    }
  ]
}`;
}

/**
 * Prompt for extracting data from Argentine tax withholding certificates
 */
export const CERTIFICADO_RETENCION_PROMPT = `Extract data from this Argentine tax withholding certificate (Certificado de Retención).

VALIDATION - ADVA IS THE SUBJECT OF WITHHOLDING:
- cuitSujetoRetenido MUST be ${ADVA_CUIT} (ADVA is the one who had taxes withheld)
- If cuitSujetoRetenido is different, this document is misclassified

Required fields:
- nroCertificado: Certificate number (e.g., "000000009185")
- fechaEmision: Issue date (YYYY-MM-DD)
- cuitAgenteRetencion: CUIT of withholding agent (11 digits, no dashes)
- razonSocialAgenteRetencion: Name of withholding agent
- cuitSujetoRetenido: CUIT of subject (should be ADVA: ${ADVA_CUIT})
- impuesto: Tax type (e.g., "Impuesto a las Ganancias", "IVA", "IIBB")
- regimen: Tax regime description
- montoComprobante: Original invoice amount (number)
- montoRetencion: Amount withheld (number)

Optional fields:
- ordenPago: Payment order number if present

NUMBER FORMAT: "12.000.000,00" = 12000000.00 (dots=thousands, comma=decimal)

Return ONLY valid JSON:
{
  "nroCertificado": "000000009185",
  "fechaEmision": "2025-11-27",
  "cuitAgenteRetencion": "30546659670",
  "razonSocialAgenteRetencion": "CONSEJO FEDERAL DE INVERSIONES",
  "cuitSujetoRetenido": "30709076783",
  "impuesto": "Impuesto a las Ganancias",
  "regimen": "Gcias. Alquileres de Bienes",
  "ordenPago": "000000027295",
  "montoComprobante": 12000000.00,
  "montoRetencion": 719328.00
}`;
