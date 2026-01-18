/**
 * Gemini API prompt templates for document extraction
 */

/**
 * Prompt for classifying document type before extraction
 * Returns classification to determine which extraction prompt to use
 */
export const CLASSIFICATION_PROMPT = `Analyze this document and classify it as one of the following types:

1. "factura" - Argentine ARCA electronic invoice (Factura Electrónica)
   Key indicators:
   - Contains text: "FACTURA" with type code (A, B, C, E)
   - Has CAE number (14-digit authorization code) with text "CAE" or "CAE N°"
   - Contains "ARCA", "AFIP", or "Comprobante Autorizado"
   - Has "Punto de Venta" and "Comp. Nro" or "Número de Comprobante"
   - Shows multiple tax amounts (Subtotal, IVA, Total)
   - Contains two CUIT sections (issuer and buyer)
   - Typically multi-page PDF (larger file)
   - May show QR code for ARCA verification

2. "pago" - Bank payment slip/transfer receipt (Comprobante de Pago/Transferencia)
   Key indicators:
   - Contains bank names: "BBVA", "Santander", "Galicia", "Macro", etc.
   - Has text like "Transferencia", "Comprobante de Transferencia", "Transferencias Inmediatas"
   - Shows "N° de Referencia" or "Número de Operación"
   - Contains "Datos Ordenante" and "Datos Beneficiario" sections
   - Shows single "Importe" amount (not multiple tax breakdowns)
   - May contain CBU/CVU account numbers
   - Typically single-page PDF (smaller file)

3. "recibo" - Salary payment slip (Recibo de Sueldo/Liquidación de Haberes)
   Key indicators:
   - Contains text: "RECIBO DE HABERES", "RECIBO DE SUELDO", "LIQUIDACIÓN DE SUELDOS", or "LIQUIDACIÓN FINAL"
   - Has "CUIL" (employee tax ID, starts with 20-, 23-, 24-, or 27-)
   - Shows "Legajo" or "Nº Legajo" or "Legajo N°" (employee number)
   - Contains sections like "Haberes", "Remuneraciones" and "Descuentos" or "Deducciones"
   - Shows "Total Neto" or "Neto a Cobrar"
   - Has "Período" or "Período Abonado" (payment period like "diciembre/2024", "mayo/2025")
   - May show employer CUIT at the top with company name
   - Contains "Tarea Desempeñada" or job title
   - Typically has employee signature line ("Recibí conforme")
   - Two copies: one for employer ("Original para el Empleador") and one for employee ("Original para el Empleado")

4. "unrecognized" - Document is neither a factura, payment slip, nor salary receipt
   Examples: contracts, reports, images, receipts without bank/ARCA info

Return ONLY valid JSON in this exact format:
{
  "documentType": "factura" | "pago" | "recibo" | "unrecognized",
  "confidence": 0.95,
  "reason": "Brief explanation of why this classification was chosen",
  "indicators": ["CAE found", "ARCA logo visible", "Multiple CUIT fields"]
}

Important:
- Return ONLY the JSON object, no additional text
- confidence should be 0.0 to 1.0
- indicators should list 2-5 specific elements found in the document
- If uncertain between types, use "unrecognized" with lower confidence`;

/**
 * Prompt for extracting data from Argentine ARCA facturas
 */
export const FACTURA_PROMPT = `You are analyzing an Argentine ARCA invoice (factura). Extract all available data and return it as JSON.

CRITICAL - Invoice Structure (WHO is WHO):
In Argentine invoices, there are TWO parties:
1. ISSUER (Emisor): The company/person PROVIDING the service or goods and BILLING. This is typically at the TOP of the invoice with their company name, address, and CUIT prominently displayed in the header section.
2. RECEPTOR (Cliente/Destinatario): The company/person RECEIVING the service or goods and BEING BILLED. This appears BELOW the issuer, usually in a section labeled "Razón Social", "Cliente", "Señor/es", or similar.

IMPORTANT: Do NOT confuse them. The issuer is at the TOP, the receptor is in the CLIENT/BUYER section.

CRITICAL VALIDATION: In this system, the receptor is ALWAYS "ASOCIACION CIVIL DE DESARROLLADORES" with CUIT 30709076783 (ADVA).
- If you see CUIT 30709076783 at the TOP of the invoice, it means the parties are SWAPPED in the document layout.
- The entity with CUIT 30709076783 should ALWAYS be the receptor (cuitReceptor), NEVER the emisor (cuitEmisor).
- The emisor is the OTHER company that is billing ADVA for services.

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

Required fields to extract:
- banco: Bank name (e.g., "BBVA", "Santander", "Galicia", "Macro")
- fechaPago: Payment date (format as YYYY-MM-DD)
- importePagado: Amount paid (number)

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
  "referencia": "TRX123456",
  "cuitPagador": "20111111119",
  "nombrePagador": "ADVA",
  "cuitBeneficiario": "30712345678",
  "nombreBeneficiario": "EMPRESA SA",
  "concepto": "Pago de factura"
}

Important:
- Return ONLY the JSON object, no additional text
- If a field is not visible, omit it from the JSON
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
