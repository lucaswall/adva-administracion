/**
 * Gemini API prompt templates for document extraction
 */

/** ADVA's CUIT - used for direction detection in prompts */
const ADVA_CUIT = '30709076783';

/**
 * Prompt for classifying document type before extraction
 * Returns classification to determine which extraction prompt to use
 */
export const CLASSIFICATION_PROMPT = `Classify this Argentine document. ADVA (CUIT ${ADVA_CUIT}) is the organization using this system.

DOCUMENT TYPES:

1. "factura_emitida" - Invoice ISSUED BY ADVA (ARCA factura)
   - CUIT ${ADVA_CUIT} at TOP as issuer
   - Has CAE authorization code
   - Money flows IN to ADVA

2. "factura_recibida" - Invoice RECEIVED BY ADVA (ARCA factura)
   - Another company's CUIT at TOP
   - CUIT ${ADVA_CUIT} in client section
   - Has CAE authorization code
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

5. "resumen_bancario" - Bank statement
   - Shows date range, balances, transactions
   - "Extracto", "Resumen de Cuenta", "Estado de Cuenta"

6. "recibo" - Salary slip
   - "RECIBO DE HABERES", employee CUIL, employer CUIT

7. "unrecognized" - None of the above

DETERMINE DIRECTION BY FINDING CUIT ${ADVA_CUIT}:
- If at TOP/header → ADVA is issuer/sender
- If in client/beneficiary section → ADVA is receiver

Return ONLY valid JSON, no additional text:
{
  "documentType": "...",
  "confidence": 0.95,
  "reason": "Brief explanation of ADVA position",
  "indicators": ["key evidence found"]
}`;

/**
 * Prompt for extracting data from Argentine ARCA facturas
 */
export const FACTURA_PROMPT = `You are analyzing an Argentine ARCA invoice (factura). Extract all available data and return it as JSON.

DOCUMENT STRUCTURE - Extract based on document POSITION, NOT assumptions:
1. ISSUER (Emisor): Company at TOP/HEADER section - the one ISSUING the invoice
2. RECEPTOR (Cliente): Company in CLIENT section below - labeled "Razón Social", "Cliente", "Señor/es"

EXTRACTION RULES:
- cuitEmisor: CUIT from the TOP/HEADER section (the company issuing the invoice)
- cuitReceptor: CUIT from the CLIENT section below
- Do NOT assume which company should be in which field
- Simply extract what you see in each position

Required fields to extract:
- tipoComprobante: ONLY the single letter code (A, B, C, E) or two-letter code (NC for Nota de Crédito, ND for Nota de Débito). DO NOT include the word "FACTURA" - extract ONLY the letter code that follows it. Examples: if the document shows "FACTURA C", extract "C"; if it shows "FACTURA B", extract "B".
- nroFactura: Full invoice number combining point of sale and invoice number (format: "XXXXX-XXXXXXXX" or "XXXX-XXXXXXXX"). Example: "00003-00001957" or "0003-00001957"
- fechaEmision: Issue date (format as YYYY-MM-DD)
- cuitEmisor: Issuer CUIT - the CUIT of the company at the TOP billing for services (11 digits, no dashes). May be formatted as XX-XXXXXXXX-X or XXXXXXXXXXX.
- razonSocialEmisor: Issuer business name - the company name at the TOP
- importeNeto: Net amount before tax (number)
- importeIva: IVA/VAT amount (number). For Type C invoices, set to 0 if not itemized.
- importeTotal: Total amount (number)
- moneda: Currency (ARS or USD)

Optional fields:
- cuitReceptor: Receptor CUIT - the CUIT in the "Razón Social" or client section (11 digits, no dashes). May be formatted as XX-XXXXXXXX-X or XXXXXXXXXXX.
- razonSocialReceptor: Receptor business name - the company/person name in the "Razón Social" or client section
- concepto: Brief one-line summary describing what the invoice is for. Analyze the line items/services listed in the invoice and summarize them (e.g., "Desarrollo de software para pagina web de ADVA", "Alojamiento y comidas para viaje a Tierra del Fuego", "Servicios de hosting y dominio para portal institucional"). IMPORTANT: Do NOT use tax category labels like "EXENTO", "GRAVADO", "NO GRAVADO" as the concepto - these are tax classifications, not descriptions.

Return ONLY valid JSON in this exact format:
{
  "tipoComprobante": "A",
  "nroFactura": "00001-00000123",
  "fechaEmision": "2024-01-15",
  "cuitEmisor": "20123456786",
  "razonSocialEmisor": "EMPRESA SA",
  "cuitReceptor": "30712345678",
  "razonSocialReceptor": "CLIENTE SA",
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
- Remove dashes and spaces from CUIT numbers (accept formats: "30-71873398-3", "30 71873398 3", or "30718733983")
- CRITICAL: Argentine number format uses DOTS (.) as thousand separators and COMMA (,) as decimal separator
  Example: "2.917.310,00" or "2917310,00" both mean 2917310.00 (two million nine hundred seventeen thousand)
  Example: "439.200,00" or "439200,00" both mean 439200.00 (four hundred thirty-nine thousand)
- Convert all amounts to standard numeric format (remove thousand separators, convert comma to decimal point)
- Ensure numeric fields are numbers, not strings
- REMEMBER: The issuer is at the TOP of the document, the receptor is in the client/buyer section below`;

/**
 * Prompt for extracting data from BBVA and other bank payment slips
 */
export const PAGO_BBVA_PROMPT = `Extract data from this Argentine bank payment slip (BBVA, Santander, etc).

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
 * Prompt for extracting data from bank statements (Resumen/Extracto Bancario)
 */
export const RESUMEN_BANCARIO_PROMPT = `Extract data from this Argentine bank statement (Resumen/Extracto Bancario).

Required fields:
- banco: Bank name
- numeroCuenta: Account number or card brand (VISA, Mastercard, etc.)
- fechaDesde, fechaHasta: YYYY-MM-DD (statement period)
- saldoInicial, saldoFinal: Numbers (may be labeled "Saldo Inicial", "Saldo Final", "Saldo Anterior", "Saldo al")
- moneda: ARS or USD (look for "u$s", "USD", "U$S" for USD)
- cantidadMovimientos: Count of transactions (0 if "SIN MOVIMIENTOS")

DATE YEAR INFERENCE (when year not explicit):
If month number is GREATER THAN the current month number, use LAST YEAR to avoid future dates.
- Current date: January 2026 (month 1)
- "30 DE DICIEMBRE" → December (month 12) > current month (month 1) → Use LAST YEAR → 2025-12-30
- "20 DE ENERO" → January (month 1) = current month (1) → Use THIS YEAR → 2026-01-20

NUMBER FORMAT: "2.917.310,00" = 2917310.00

Return ONLY valid JSON, no additional text:
{
  "banco": "BBVA",
  "numeroCuenta": "1234567890",
  "fechaDesde": "2024-01-01",
  "fechaHasta": "2024-01-31",
  "saldoInicial": 150000.00,
  "saldoFinal": 185000.00,
  "moneda": "ARS",
  "cantidadMovimientos": 47
}`;
