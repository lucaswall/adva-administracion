# Bank Movimientos Matching Algorithm

## Overview

Matches bank movimientos (from resumen bancario sheets) against documents in Control de Ingresos and Control de Egresos spreadsheets. Each movimiento row has a `matchedFileId` and `detalle` column that get filled when a match is found.

## Phase 0: Pattern Auto-Detection

Before any amount/date matching, check the bank concepto against known patterns:

- **Bank fees**: `IMPUESTO LEY`, `COMISION`, `IVA TASA`, etc. → auto-label "Gastos bancarios"
- **Credit card payments**: `PAGO TARJETA` followed by digits OR card type name (e.g., "PAGO TARJETA VISA EMPRESA") → auto-label "Pago de tarjeta de credito"

If a pattern matches → write label, done. No further matching needed.

## Phase 1: Identity Extraction

Extract identity information from the bank movimiento concepto:

| Identity Type | Extraction Rule | Example |
|--------------|-----------------|---------|
| **CUIT** | 11-digit number passing checksum validation | "TRANSFERENCIA 20316682724" → `20316682724` |
| **Referencia** | 7-digit number from ORDEN DE PAGO pattern (`\d{7}` before `.XX.XXXX`) | "ORDEN DE PAGO DEL EXTERIOR 4083953.01.8584" → `4083953` |
| **Name tokens** | Words from concepto after filtering bank jargon and short/numeric tokens | "TR.NE3405957 BOBY STUDIOS S A" → `["BOBY", "STUDIOS"]` |

Identity types are not mutually exclusive. A concepto may have CUIT + name tokens, or referencia + name tokens, etc.

## Phase 2: Document Pool Selection

Pools are never cross-referenced:

| Movimiento Type | Document Pool | Document Types |
|----------------|---------------|----------------|
| **Debit** (money OUT) | Egresos | Facturas Recibidas, Pagos Enviados, Recibos |
| **Credit** (money IN) | Ingresos | Facturas Emitidas, Pagos Recibidos, Retenciones (for amount tolerance) |

## Phase 3: Candidate Gathering

### Amount Matching

- **Same currency**: exact match (±0.01 rounding tolerance)
- **Cross-currency** (USD↔ARS): exchange rate lookup from ArgentinaDatos API with ±5% tolerance
- Cross-currency matching applies to ALL document types, including Pagos Recibidos (key difference from previous implementation)

### Date Windows

| Document Type | Window |
|--------------|--------|
| **Pagos** (Enviados / Recibidos) | ±15 days |
| **Facturas** (Emitidas / Recibidas) | -5 / +30 days (factura can be up to 5 days after bank date or up to 30 days before) |
| **Recibos** | -5 / +30 days (same as facturas) |

### Hard Filters (identity gates)

Hard filters constrain which documents are considered. If a hard filter is active and no candidate passes it, the result is **NO MATCH** — the algorithm does NOT fall through to unfiltered matching.

| Extracted Identity | Filter Behavior |
|-------------------|-----------------|
| **CUIT present** | Only consider documents whose CUIT field matches the extracted CUIT. No fallthrough. |
| **Referencia present** | Only consider Pagos Recibidos whose `referencia` field matches. No fallthrough. |
| **Neither present** | No filter — consider ALL documents in the pool. |

Rationale: If the bank concepto identifies WHO the transaction is for (via CUIT or referencia), matching to a different entity would be incorrect. Better to leave unmatched than match wrong.

### Gathering Steps

```
1. Extract identity from concepto (CUIT, referencia, name tokens)

2. IF CUIT extracted:
     Filter documents to those with matching CUIT
     Search for amount match within date window
     → candidates (may be empty → NO MATCH)

3. ELSE IF referencia extracted:
     Filter Pagos to those with matching referencia
     Search for amount match (with cross-currency) within ±15 days
     → candidates (may be empty → NO MATCH)

4. ELSE (no hard identity):
     Search ALL documents in pool for amount match within date window
     → candidates (may be empty → NO MATCH)
```

### Retenciones Adjustment (credit matching only)

When matching credit movimientos against Facturas Emitidas, if direct amount matching fails:
- Find Retenciones Recibidas with same CUIT as Factura's receptor, within 90 days after Factura date
- Try: `bank_credit_amount + sum(retenciones) ≈ factura.importeTotal`
- If this matches → candidate is valid (with retenciones noted)

## Phase 4: Candidate Ranking

Candidates are ranked by tier. **A higher tier always wins regardless of date distance.** Within the same tier, closer date wins.

### Tier Definitions

| Tier | Condition | Confidence | Description |
|------|-----------|------------|-------------|
| **1** | Pago linked to Factura | HIGH | Pago's `matchedFacturaFileId` points to a Factura in the pool. Two documents confirm the transaction. Pago date is used for date matching (closer to bank date than invoice date). |
| **2** | CUIT match | HIGH | CUIT extracted from concepto matches document's CUIT field. Strong identity confirmation. |
| **3** | Referencia match | HIGH | Referencia extracted from ORDEN DE PAGO concepto matches Pago Recibido's `referencia` field. |
| **4** | Name/keyword match (score ≥ 2) | MEDIUM | Tokens from concepto match words in document's entity name or concepto field. Partial identity confirmation. |
| **5** | Amount + date only | LOW | No identity confirmation. Amount and date match but we don't know WHO the transaction is for. |

### Cross-Currency Confidence Cap

When a match involves cross-currency conversion (USD↔ARS), confidence is capped:
- Tier 1-3: remain HIGH (identity confirmed)
- Tier 4: remains MEDIUM
- Tier 5: remains LOW

### Tiebreakers Within Same Tier

1. Closer date (fewer days between bank date and document date)
2. Exact amount beats tolerance/cross-currency match
3. If still tied: keep existing match (no churn)

### Pago→Factura Combo (Tier 1) Details

A Pago document contains bank-specific information (transfer reference, account, payment date) that directly corresponds to the bank movimiento. The linked Factura provides the business context (who, what, invoice number). This is why the combo always wins:

- **Date matching**: Use the Pago's `fechaPago` (payment date), not the Factura's `fechaEmision` (invoice date)
- **Amount matching**: Use the Pago's `importePagado`
- **Description**: Generated from the Factura (entity name, concepto)
- **FileId**: Use the Pago's `fileId` as `matchedFileId`

### Name/Keyword Matching (Tier 4) Details

Token extraction from bank concepto:
1. Strip bank origin prefix (e.g., "D 500 " prefix)
2. Split on whitespace/punctuation
3. Split alphanumeric boundaries (e.g., "20751CUOTA" → ["CUOTA"])
4. Filter: remove tokens < 3 chars, pure numbers, bank jargon (`DEBITO`, `CREDITO`, `TRANSFERENCIA`, `PAGO`, etc.)
5. Normalize accents

Scoring:
- +2 points per token matching a word in the document's entity name (word-boundary match)
- +2 points per token matching a word in the document's concepto field
- Minimum score: 2 (one token matching one field)

Names are stronger than date proximity (Tier 4 > Tier 5) but do not act as a hard filter. A name mismatch does not prevent an amount+date match — it just ranks lower.

## Phase 5: Replacement Logic

When a movimiento already has an existing match and a new candidate is found:

```
IF candidate.tier < existing.tier:        → REPLACE (higher tier wins)
IF candidate.tier > existing.tier:        → KEEP existing
IF candidate.tier == existing.tier:
  IF candidate.dateDistance < existing.dateDistance: → REPLACE
  IF candidate.dateDistance > existing.dateDistance: → KEEP existing
  IF candidate.isExactAmount AND NOT existing.isExactAmount: → REPLACE
  ELSE: → KEEP existing (no churn)
```

Lower tier number = better match (Tier 1 > Tier 2 > ... > Tier 5).

## Phase 6: Write Results

For each matched movimiento, write to the spreadsheet:
- **Column G** (`matchedFileId`): The document's Google Drive file ID
- **Column H** (`detalle`): Human-readable description

### Description Format by Match Type

| Match Type | Format |
|-----------|--------|
| Bank fee | "Gastos bancarios" |
| Credit card payment | "Pago de tarjeta de credito" |
| Pago→Factura (debit) | "Pago Factura a {razonSocial} - {concepto}" |
| Direct Factura (debit) | "Pago Factura a {razonSocial} - {concepto}" |
| Recibo (debit) | "Sueldo {periodo} - {nombreEmpleado}" |
| Pago only (debit) | "REVISAR! Pago a {nombre} {cuit} ({concepto})" |
| Pago→Factura (credit) | "Cobro Factura de {razonSocial} - {concepto}" |
| Direct Factura (credit) | "Cobro Factura de {razonSocial} - {concepto}" |
| Pago only (credit) | "REVISAR! Cobro de {nombre}" |

### TOCTOU Protection

Before writing, verify row hasn't changed since read:
- Compute MD5 hash of row content (fecha + concepto + debito + credito + matchedFileId + detalle)
- On write: re-read row, verify hash matches
- If hash changed: skip update (another process modified the row)

## Summary of Changes from Previous Implementation

| Aspect | Previous | New |
|--------|----------|-----|
| CUIT/keyword gate for facturas | Required CUIT or keyword match (score ≥ 2) to match any factura | Amount+date is sufficient (Tier 5). CUIT/keyword improve ranking but don't gate. |
| CUIT hard filter | Not enforced — CUIT was a ranking bonus | If CUIT in concepto → hard filter. Only match documents with that CUIT. |
| Referencia matching | Not implemented | Referencia extracted from ORDEN DE PAGO → hard filter on Pagos Recibidos |
| Cross-currency for Pagos Recibidos | Not implemented (`amountsMatch` only) | Full cross-currency support with exchange rate lookup |
| Pago date window | ±1 day | ±15 days |
| Factura date window | -5 / +30 days | -5 / +30 days (unchanged) |
| Credit card pattern | `^PAGO TARJETA\s+\d+` only | Also matches `PAGO TARJETA` + card type name |
| Ranking | Confidence → CUIT → date → amount → linked pago | Tier (Pago→Factura > CUIT > Referencia > Name > Amount-only) → date → amount |
