/**
 * Gemini API prompt templates for document extraction
 */

/** ADVA's CUIT - used for direction detection in prompts */
const ADVA_CUIT = '30709076783';

/**
 * Prompt for classifying document type before extraction
 * Returns classification to determine which extraction prompt to use
 *
 * IMPORTANT: This prompt must classify documents by DIRECTION relative to ADVA:
 * - Creditos (money IN): factura_emitida, pago_recibido
 * - Debitos (money OUT): factura_recibida, pago_enviado, recibo
 */
export const CLASSIFICATION_PROMPT = `Analyze this document and classify it as one of the following types.

CRITICAL: ADVA (CUIT ${ADVA_CUIT} - "ASOCIACION CIVIL DE DESARROLLADORES") is the organization using this system.
You MUST determine the DIRECTION of money flow relative to ADVA.

## Document Types:

### INVOICES (Facturas) - Look for CAE, ARCA, and CUIT positions

1. "factura_emitida" - Invoice ISSUED BY ADVA (ADVA sells/bills others)
   ADVA is the ISSUER (emisor) - money flows IN to ADVA
   Key indicators:
   - CUIT ${ADVA_CUIT} appears at the TOP as the ISSUER
   - "ASOCIACION CIVIL DE DESARROLLADORES" in the header/issuer section
   - ADVA's address and business details in the header
   - Another company/person in the "Razón Social" or client section below

2. "factura_recibida" - Invoice RECEIVED BY ADVA (ADVA is billed by others)
   ADVA is the RECEPTOR (client) - money flows OUT from ADVA
   Key indicators:
   - Another company's CUIT at the TOP as the ISSUER
   - CUIT ${ADVA_CUIT} or "ASOCIACION CIVIL DE DESARROLLADORES" in the client/receptor section
   - ADVA appears in "Razón Social", "Cliente", or "Señor/es" section below the header

Common factura indicators (both types):
- Contains "FACTURA" with type code (A, B, C, E)
- Has CAE number (14-digit authorization code)
- Contains "ARCA", "AFIP", or "Comprobante Autorizado"
- Has "Punto de Venta" and "Comp. Nro"
- Shows multiple tax amounts (Subtotal, IVA, Total)

### PAYMENTS (Pagos) - Look for Ordenante/Beneficiario sections

3. "pago_enviado" - Payment SENT BY ADVA (ADVA pays others)
   ADVA is the PAYER (ordenante) - money flows OUT from ADVA
   Key indicators:
   - CUIT ${ADVA_CUIT} or "ASOCIACION CIVIL DE DESARROLLADORES" in the "Ordenante" or "Datos del Ordenante" section
   - Another company/person in the "Beneficiario" or "Destinatario" section

4. "pago_recibido" - Payment RECEIVED BY ADVA (others pay ADVA)
   ADVA is the BENEFICIARY (beneficiario) - money flows IN to ADVA
   Key indicators:
   - Another company/person in the "Ordenante" section
   - CUIT ${ADVA_CUIT} or "ASOCIACION CIVIL DE DESARROLLADORES" in the "Beneficiario" or "Destinatario" section

Common payment indicators (both types):
- Contains bank names: "BBVA", "Santander", "Galicia", "Macro", etc.
- Has "Transferencia", "Comprobante de Transferencia", "Transferencias Inmediatas"
- Shows "N° de Referencia" or "Número de Operación"
- Shows single "Importe" amount
- May contain CBU/CVU account numbers

### BANK STATEMENTS

5. "resumen_bancario" - Bank statement (Resumen/Extracto Bancario)
   Key indicators:
   - Contains "Extracto Bancario", "Resumen de Cuenta", "Estado de Cuenta"
   - Shows a DATE RANGE (período, desde/hasta, fechas)
   - Has "Saldo Inicial" and "Saldo Final" (opening/closing balance)
   - Lists multiple transactions/movements
   - Bank name prominent in header
   - May show "Total Débitos" and "Total Créditos"

### SALARY RECEIPTS

6. "recibo" - Salary payment slip (Recibo de Sueldo)
   Money flows OUT from ADVA (ADVA pays employee salaries)
   Key indicators:
   - Contains "RECIBO DE HABERES", "RECIBO DE SUELDO", "LIQUIDACIÓN DE SUELDOS"
   - Has "CUIL" (employee tax ID, starts with 20-, 23-, 24-, or 27-)
   - Shows "Legajo" (employee number)
   - Contains "Haberes/Remuneraciones" and "Descuentos"
   - Shows "Total Neto" or "Neto a Cobrar"
   - Has "Período Abonado" (payment period)
   - CUIT ${ADVA_CUIT} typically at top as employer

### FALLBACK

7. "unrecognized" - Document does not match any of the above types
   Examples: contracts, reports, images, receipts without clear structure

## Response Format

Return ONLY valid JSON in this exact format:
{
  "documentType": "factura_emitida" | "factura_recibida" | "pago_enviado" | "pago_recibido" | "resumen_bancario" | "recibo" | "unrecognized",
  "confidence": 0.95,
  "reason": "Brief explanation including who is the emisor/ordenante and who is receptor/beneficiario",
  "indicators": ["ADVA CUIT in receptor section", "CAE found", "Other company at top"]
}

CRITICAL RULES:
- Return ONLY the JSON object, no additional text
- confidence should be 0.0 to 1.0
- indicators should list 2-5 specific elements found
- ALWAYS identify ADVA's position (emisor/receptor, ordenante/beneficiario) in your reason
- If uncertain about direction but document type is clear, use lower confidence
- If completely uncertain, use "unrecognized"`;

/**
 * Prompt for extracting data from Argentine ARCA facturas
 */
export const FACTURA_PROMPT = `You are analyzing an Argentine ARCA invoice (factura). Extract all available data and return it as JSON.

CRITICAL - Invoice Structure (WHO is WHO):
In Argentine invoices, there are TWO parties:
1. ISSUER (Emisor): The company/person PROVIDING the service or goods and BILLING. This is typically at the TOP of the invoice with their company name, address, and CUIT prominently displayed in the header section.
2. RECEPTOR (Cliente/Destinatario): The company/person RECEIVING the service or goods and BEING BILLED. This appears BELOW the issuer, usually in a section labeled "Razón Social", "Cliente", "Señor/es", or similar.

IMPORTANT: Do NOT confuse them. The issuer is at the TOP, the receptor is in the CLIENT/BUYER section.

IMPORTANT - ADVA IDENTIFICATION:
ADVA's CUIT is ${ADVA_CUIT}. Based on the classification you received, ADVA is either the emisor or receptor:

FOR FACTURAS EMITIDAS (ADVA is emisor):
- ADVA issued this invoice to bill a client, so cuitEmisor MUST be ${ADVA_CUIT}
- Extract ONLY receptor information: cuitReceptor, razonSocialReceptor (the counterparty being billed)
- You may extract emisor fields to validate, but FOCUS on extracting complete receptor information

FOR FACTURAS RECIBIDAS (ADVA is receptor):
- ADVA received this invoice from a supplier, so cuitReceptor should be ${ADVA_CUIT}
- Extract ONLY emisor information: cuitEmisor, razonSocialEmisor (the counterparty billing ADVA)
- You may extract receptor fields to validate, but FOCUS on extracting complete emisor information

VALIDATION:
- Extract the CUIT from the position that should contain ADVA
- If it's NOT ${ADVA_CUIT}, flag this in your response - the document may be misclassified
- This helps catch classification errors before documents are stored

Required fields to extract:
- tipoComprobante: ONLY the single letter code (A, B, C, E) or two-letter code (NC for Nota de Crédito, ND for Nota de Débito). DO NOT include the word "FACTURA" - extract ONLY the letter code that follows it. Examples: if the document shows "FACTURA C", extract "C"; if it shows "FACTURA B", extract "B".
- puntoVenta: Point of sale number (4-5 digits)
- numeroComprobante: Invoice number (8 digits)
- fechaEmision: Issue date (format as YYYY-MM-DD)
- cuitEmisor: Issuer CUIT - the CUIT of the company at the TOP billing for services (11 digits, no dashes). May be formatted as XX-XXXXXXXX-X or XXXXXXXXXXX.
- razonSocialEmisor: Issuer business name - the company name at the TOP
- cae: CAE authorization code (14 digits)
- fechaVtoCae: CAE expiration date (format as YYYY-MM-DD)
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
  "puntoVenta": "00001",
  "numeroComprobante": "00000123",
  "fechaEmision": "2024-01-15",
  "cuitEmisor": "20123456786",
  "razonSocialEmisor": "EMPRESA SA",
  "cuitReceptor": "30712345678",
  "razonSocialReceptor": "CLIENTE SA",
  "cae": "12345678901234",
  "fechaVtoCae": "2024-01-25",
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
 * Prompt for extracting data from BBVA payment slips
 */
export const PAGO_BBVA_PROMPT = `You are analyzing a bank payment slip (comprobante de pago/transferencia) from Argentina. Extract all available data and return it as JSON.

CRITICAL - Payment Structure (WHO is WHO):
Argentine payment slips typically show:
1. PAYER (Ordenante/Pagador): The person/company SENDING the money. Usually in a section labeled "Ordenante", "Datos del Ordenante", or similar.
2. BENEFICIARY (Beneficiario/Destinatario): The person/company RECEIVING the money. Usually in a section labeled "Beneficiario", "Datos del Beneficiario", "Destinatario", or similar.

IMPORTANT - ADVA IDENTIFICATION:
ADVA's CUIT is ${ADVA_CUIT}. Based on the classification you received, ADVA is either the payer or beneficiary:

FOR PAGOS ENVIADOS (ADVA is pagador):
- ADVA sent this payment, so pagador should be ADVA (may appear as CUIT ${ADVA_CUIT} or "ASOCIACION CIVIL DE DESARROLLADORES")
- Extract ONLY beneficiario information: cuitBeneficiario, nombreBeneficiario (the counterparty receiving payment)
- You may extract pagador fields to validate, but FOCUS on extracting complete beneficiario information

FOR PAGOS RECIBIDOS (ADVA is beneficiario):
- ADVA received this payment, so beneficiario should be ADVA
- Extract ONLY pagador information: cuitPagador, nombrePagador (the counterparty sending payment)
- You may extract beneficiario fields to validate, but FOCUS on extracting complete pagador information

VALIDATION:
- Extract the CUIT from the position that should contain ADVA
- If it's NOT ${ADVA_CUIT}, flag this in your response - the document may be misclassified

Required fields to extract:
- banco: Bank name (e.g., "BBVA", "Santander", "Galicia", "Macro")
- fechaPago: Payment date (format as YYYY-MM-DD)
- importePagado: Amount paid (number)
- moneda: Currency (ARS or USD). Look for currency symbols or explicit mentions like "$", "USD", "U$S", "ARS", "Pesos", "Dólares". If not explicitly stated, assume ARS (Argentine Pesos) as this is the default currency in Argentina.

Optional fields:
- referencia: Transaction reference or ID (may be labeled "N° de Referencia", "Número de Operación", etc.)
- cuitPagador: Payer CUIT or DNI if visible. May be a full CUIT (11 digits, formatted as XX-XXXXXXXX-X) or just a DNI (7-8 digits). Extract whatever identifier is shown.
- nombrePagador: Payer name if visible
- cuitBeneficiario: Beneficiary CUIT or DNI if visible. May be a full CUIT (11 digits, formatted as XX-XXXXXXXX-X) or just a DNI (7-8 digits). The field may be labeled "CUIT", "CUIL", "CDI", or "CUIT / CUIL / CDI". Extract whatever identifier is shown, even if it's only 7-8 digits.
- nombreBeneficiario: Beneficiary name if visible
- concepto: Payment description or concept (may be labeled "Concepto", "Motivo", "Descripción", etc.)

Return ONLY valid JSON in this exact format:
{
  "banco": "BBVA",
  "fechaPago": "2024-01-18",
  "importePagado": 1210.00,
  "moneda": "ARS",
  "referencia": "TRX123456",
  "cuitPagador": "20111111119",
  "nombrePagador": "ADVA",
  "cuitBeneficiario": "30712345678",
  "nombreBeneficiario": "EMPRESA SA",
  "concepto": "Pago de factura"
}

Important:
- Return ONLY the JSON object, no additional text
- If a field is not visible, omit it from the JSON (but moneda should default to ARS if not stated)
- Ensure the date is in YYYY-MM-DD format
- For CUIT/DNI fields: Remove dashes and spaces. Accept both full CUITs (11 digits like "30-71873398-3") and DNIs (7-8 digits like "40535475"). If the document shows only a short number (7-8 digits) in a CUIT/CUIL/CDI field, extract it as-is.
- CRITICAL: Argentine number format uses DOTS (.) as thousand separators and COMMA (,) as decimal separator
  Example: "2.917.310,00" means 2917310.00 (two million nine hundred seventeen thousand three hundred ten)
  Example: "439.200,00" means 439200.00 (four hundred thirty-nine thousand two hundred)
- Convert all amounts to standard numeric format (remove thousand separators, convert comma to decimal point)
- Ensure importePagado is a number without thousand separators
- REMEMBER: Payer is the one sending money (Ordenante), Beneficiary is the one receiving money (Beneficiario/Destinatario)`;

/**
 * Prompt for extracting data from Argentine salary payment slips
 */
export const RECIBO_PROMPT = `You are analyzing an Argentine salary payment slip (Recibo de Sueldo / Liquidación de Haberes). Extract all available data and return it as JSON.

DOCUMENT STRUCTURE:
Salary payment slips in Argentina typically contain:
1. EMPLOYER (Empleador): Company paying the salary (usually at the top with CUIT)
2. EMPLOYEE (Empleado): Person receiving the salary with CUIL, name, legajo (employee number)

VALIDATION - ADVA IS EMPLOYER:
- cuitEmpleador MUST be ${ADVA_CUIT} (ADVA is the employer)
- If cuitEmpleador is different, this document is misclassified or not an ADVA employee receipt
- We only process salary receipts where ADVA is paying the employee

Required fields to extract:
- tipoRecibo: Either "sueldo" (regular monthly salary) or "liquidacion_final" (final settlement when employee leaves, may include indemnizaciones/severance)
- nombreEmpleado: Full employee name (e.g., "MARTIN, Miguel" or "Miguel MARTIN")
- cuilEmpleado: Employee CUIL (11 digits, no dashes). Format: XX-XXXXXXXX-X where first 2 digits are 20, 23, 24, or 27
- legajo: Employee number (Legajo N° or Nro. Legajo)
- cuitEmpleador: Employer CUIT (11 digits, no dashes)
- periodoAbonado: Payment period (e.g., "diciembre/2024", "12/2024", or just "diciembre 2024")
- fechaPago: Payment date (format as YYYY-MM-DD)
- subtotalRemuneraciones: Gross salary / Total haberes (sum of all earnings before deductions)
- subtotalDescuentos: Total deductions (sum of all deductions like jubilación, obra social, etc.)
- totalNeto: Net amount (what employee actually receives = subtotalRemuneraciones - subtotalDescuentos)

Optional fields:
- tareaDesempenada: Job title or position (e.g., "Director Ejecutivo", "Desarrollador")

Return ONLY valid JSON in this exact format:
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
  "totalNeto": 1947863.00,
  "tareaDesempenada": "Director Ejecutivo"
}

Important:
- Return ONLY the JSON object, no additional text
- If a field is not visible, omit it from the JSON (except required fields)
- Ensure the date is in YYYY-MM-DD format
- Remove dashes and spaces from CUIL/CUIT numbers
- CRITICAL: Argentine number format uses DOTS (.) as thousand separators and COMMA (,) as decimal separator
  Example: "2.346.822,36" means 2346822.36 (two million)
- Convert all amounts to standard numeric format
- For liquidación final documents, still extract the same fields (the totals may include severance pay)`;

/**
 * Prompt for extracting data from bank statements (resumen/extracto bancario)
 */
export const RESUMEN_BANCARIO_PROMPT = `You are analyzing an Argentine bank statement (Resumen/Extracto Bancario). Extract all available data and return it as JSON.

DOCUMENT STRUCTURE:
Bank statements typically contain:
1. BANK: The bank issuing the statement
2. PERIOD: Date range covered by the statement
3. BALANCES: Opening and closing balances
4. MOVEMENTS: List of transactions (we only count them, not extract details)

Required fields to extract:
- banco: Bank name (e.g., "BBVA", "Santander", "Galicia", "Macro", "HSBC", "ICBC", "Banco Nación")
- fechaDesde: Start date of the statement period (format as YYYY-MM-DD)
- fechaHasta: End date of the statement period (format as YYYY-MM-DD)
- saldoInicial: Opening balance at the start of the period (number)
- saldoFinal: Closing balance at the end of the period (number)
- moneda: Currency (ARS or USD)
- cantidadMovimientos: Count of transaction entries in the statement (number)

Return ONLY valid JSON in this exact format:
{
  "banco": "BBVA",
  "fechaDesde": "2024-01-01",
  "fechaHasta": "2024-01-31",
  "saldoInicial": 150000.00,
  "saldoFinal": 185000.00,
  "moneda": "ARS",
  "cantidadMovimientos": 47
}

Important:
- Return ONLY the JSON object, no additional text
- If a field is not visible, omit it from the JSON
- Ensure dates are in YYYY-MM-DD format
- CRITICAL: Argentine number format uses DOTS (.) as thousand separators and COMMA (,) as decimal separator
  Example: "2.917.310,00" means 2917310.00
  Example: "-439.200,00" means -439200.00 (negative balance)
- Convert all amounts to standard numeric format (remove thousand separators, convert comma to decimal point)
- Ensure numeric fields are numbers, not strings
- cantidadMovimientos should be a count of individual transaction rows/lines in the statement`;
