# Production System Review — 2026-05-06

Deep review of ADVA's production system before Q1 2026 closing. Scope: focus on 2026; 2025 carryover only where it impacts current operations; 2023/2024/older years out of scope.

## Executive Summary

System is healthy and processing correctly. Q1 2026 is reconcilable but has a small number of focused issues to clean up before closing. Two operational issues need attention before any deeper work:

1. **Production log spam → Railway rate-limit hits.** Every match cycle emits hundreds of `Exchange rate cache miss` warnings for old 2025 USD invoices, dropping 600+ messages per cycle and obscuring real signals. Source: `src/utils/exchange-rate.ts:346`.
2. **Two missing 2026 resumenes** despite their PDFs being in the bank folders (BBVA Visa March, Credicoop February). Likely silent extraction failure — needs reprocessing.

Outside those, Q1 books look clean: zero `needsReview=SI` rows, reconciled balances on every bank with a ✓ in `balanceOk`, and the 2025 carryover that the user described is real but bounded.

---

## Q1 2026 Snapshot

### Invoices (Jan–Mar)
| Sheet | Q1 rows | Total ARS | Total USD | Unpaid | needsReview |
|---|---:|---:|---:|---:|---:|
| Facturas Emitidas | 6 | 38,139,694.55 | 150.00 | 2 (17.7M ARS) | 0 |
| Facturas Recibidas | 22 | 14,471,720.55 | 2,321.46 | 3 (1.17M ARS + $75) | 0 |
| Pagos Recibidos | (small Q1 set) | — | — | — | 0 |
| Pagos Enviados | (small Q1 set) | — | — | — | 0 |
| Retenciones Recibidas | 0 in Q1 (8 total, all 2025) | — | — | — | 0 |
| Recibos | 0 in Q1 (3 total, all 2025) | — | — | — | 0 |

**Net Q1 result:** +23.67M ARS, −2,171 USD (consistent with the user's note that 2026 invoicing cycle started in April, not Q1).

### Top unpaid Q1 items
- **Cobrar:** CFI 16,643,694.55 ARS (2026-03-19); Mujeres en Tecnología Córdoba 1,078,750 ARS (2026-02-03)
- **Pagar:** Matarucco 650,000 ARS (2026-03-31); Trobajo 520,000 ARS (2026-03-30); BANA Hosting USD 75.06 (2026-03-09, foreign — no CUIT)

### Anomalies in Q1 facturas
- Two foreign-supplier facturas have empty `cuitEmisor` (BANA Hosting, MeetToMatch). Expected for non-AR entities, but downstream CUIT-based bank matching will skip them — they will need manual matching.
- "Unmatched ≠ unpaid": 16 of 22 received Q1 facturas have empty `matchedPagoFileId` (column P) but `pagada=SI` (column S). This is the known pattern where movimientos-driven matching marks the factura paid in column S without backfilling column P. Not a data issue — but if the closing report relies on column P, it will undercount. **Action:** confirm Q1 closing uses column S.

---

## Banks & Resumenes

| Bank/Account | Q1 Resumenes | balanceOk | Notes |
|---|---|---|---|
| BBVA 007-009364/1 ARS | Jan, Feb, Mar ✓ | SI | Saldo Mar: 1,514,685.84 |
| BBVA 007-401617/2 USD | Jan, Feb, Mar ✓ | SI | Zero balance throughout (pass-through) |
| Banco Ciudad 0003043/0 ARS | Jan, Feb, Mar, Apr ✓ | SI | Negative saldo Feb (−11,840) — recovered Mar |
| Credicoop 191.001.066458.4 ARS | Jan, **Feb missing**, Mar, Apr | SI on present rows | February PDF exists but not extracted |
| BBVA Visa 0941198918 | Jan, Feb, **Mar missing** | n/a (card schema) | March PDF exists but not extracted |

### Movimientos coverage
All Q1 monthly tabs exist for every bank. Sample reconciliation (BBVA ARS Jan): saldo and saldoCalculado match perfectly across all 28 transactions; one unmatched cobro (PURPLE TREE SRL, 85,000 ARS, 2026-01-28). Banco Ciudad and Credicoop Q1 movimientos consist almost entirely of bank fees (no operational cash flow on those accounts).

### Auto-trigger sync sample (from logs)
`module=match-movimientos bankName="2026:Banco Ciudad 0003043/0 ARS" filled=0 noMatches=21` — 21 unmatched movements remain on Banco Ciudad after the latest run. Most are bank fees that don't have counterpart documents (correct behavior). One should be reviewed (PURPLE TREE cobro).

---

## Operational State

### Production health
- Server live, Drive watch channel renewing on schedule.
- Scans run, complete, and trigger downstream pagos/cobros sync correctly.
- 808 files already processed; 0 new files in Entrada at last poll.

### Pending in Entrada (10 files)
Most are 2025 vintage PDFs (CFI capacitación facturas from October). One is 2026: `Ulrich Gonzalo Ezequiel Abril 2026.pdf`. These have not been picked up, suggesting either webhook missed them or they were dropped manually. **Action:** trigger a manual scan after closing.

### Stuck in Sin Procesar (8 files)
All 2025 vintage. Mix of: non-document images (IGJ Balance jpeg), personal/non-business PDFs (Personal.pdf, mailchimp receipt), legitimate but unparseable docs (M2M loan invoice, IIBB ticket legalizaciones). **Action:** triage manually — most can be deleted or moved out of system scope.

### Linear state
**Backlog: empty. Todo: empty.** Either work has been disciplined into completion, or audits haven't been running. Given the issues identified here, it's the latter — these need to land in Backlog.

---

## Issues to Fix (Findings)

### CRITICAL — Log spam exhausting Railway rate limit
**File:** `src/utils/exchange-rate.ts:346` — `warn('Exchange rate cache miss - USD invoice cannot be matched', ...)` fires once per (USD-factura × pago) combination during cross-currency matching. With 2025 carryover USD facturas (e.g., 2025-07-07, 2025-07-18) still unpaid, every match cycle generates hundreds of identical logs.

Evidence from production logs:
```
[INFO] Exchange rate cache miss ... facturaFecha="2025-07-18" facturaAmount=5000 pagoAmount=0.78 ...
[INFO] Exchange rate cache miss ... facturaFecha="2025-07-07" facturaAmount=2160 pagoAmount=0.78 ...
[INFO] Exchange rate cache miss ... facturaFecha="2025-07-18" facturaAmount=5000 pagoAmount=0.25 ...
... (×N pagos × M facturas)
Railway rate limit of 500 logs/sec reached for replica ... Messages dropped: 624
```

The prefetch at `src/bank/match-movimientos.ts:1218` extracts USD dates and pre-fetches rates, but the ArgentinaDatos API may not have rates for old dates, so `getExchangeRateSync` returns a miss every time.

**Recommended fix (one of):**
- Demote to `debug` (drops the noise — visibility is preserved at debug level when investigating).
- Or: dedupe — track logged fechas in a `Set` for the duration of one match cycle and only log once per fecha.
- Or: cache the miss — if `getExchangeRateSync` previously returned a cache miss for a date, suppress subsequent attempts in the same cycle.

### HIGH — Two resumenes marked "success" with no row in Control de Resumenes
PDFs for BBVA Visa 2026-03 (`1AwN55RaavyIGDksL7ZFR7DNS8YEVyfH0`) and Credicoop 2026-02 (`1SSpS0d23EJPKrUX2v_CjDhjiRalxx88L`) are marked `status="success"` in `Archivos Procesados` (rows 651 and 661, processed 2026-04-07 and 2026-04-09 respectively) but rows are missing from their `Control de Resumenes` sheets.

**Investigation history:**
- Both files have a single tracker entry each (no re-upload). File modifiedTime matches their initial-process timestamp — content has not been replaced.
- BBVA Visa Mar was processed FIRST in its scan batch (before Jan/Feb rows existed in the sheet), so dupe-detection couldn't have collided on the initial run.
- Distinct from the user's BBVA USD Feb manual fix on 2026-05-04, which used a different mechanism (delete row + upload new file with new fileId — that worked correctly).

**Root cause: uncertain.** Plausible paths:
- Row was added then deleted later (manual edit or operation we haven't identified).
- `appendRowsWithLinks` API ack succeeded without persisting (Sheets API quirk).
- Gemini emitted an unexpected shape that took a silent skip path different from dupe-detection.

**Action:**
1. Read the two PDFs and run extraction in isolation to see what Gemini returns now — confirms whether re-extraction would yield a clean row.
2. Reprocess via the proven "upload as new fileId" workflow: delete the existing PDF, re-upload as a new file, scanner extracts cleanly.
3. Separately, audit `storeResumen*` for paths that return `{stored:false}` without logging at info level — `warn` is currently being rate-limited away by the exchange-rate spam.

### MEDIUM — `storeResumen*` swallows duplicate-skip silently
`src/processing/storage/resumen-store.ts:160-177` returns `{stored: false}` on duplicate detection. Scanner treats this as success and marks the file done. If a future re-process collides with an existing row (e.g., Gemini extracts dates that match a different month), the new data is silently dropped with only a `warn` log that gets buried under the exchange-rate spam.

**Action:** raise the log to `info`, AND consider failing loud when reprocessing the *same* fileId yields a *different* business-key signature than what's already stored.

### MEDIUM — No "force reprocess" path
The only way to re-extract a file is to upload it as a new fileId (deleting and re-creating). For users who want to fix a bad parse:
- Current workflow (works): delete row from `Control de Resumenes` → delete PDF from Drive → re-upload as new file → scanner picks it up → new row added. Old fileId stays in `Archivos Procesados` as orphan.
- Better workflow: `/data-ops` "force reprocess <fileId>" that deletes the tracker entry and moves the file back to Entrada.

### HIGH — Credicoop resumen extraction grabs narrow date range
Credicoop January 2026 row in `Control de Resumenes` shows `fechaDesde=2026-01-30, fechaHasta=2026-01-31` — only 2 days, not a full month. March is `2026-03-27 to 2026-03-31`. April is `2026-04-24 to 2026-04-30`. These narrow ranges suggest Gemini is extracting an end-of-statement period (e.g., the footer "Fecha del saldo" header) rather than the statement coverage period. This may be the proximate cause of the missing February row above (date-range collision in dupe detection). Verify `gemini/prompts.ts` for Credicoop-specific extraction.

### MEDIUM — Linear hygiene gap
No issues in Backlog or Todo. No code-audit pipeline appears to have run recently. **Action:** seed Backlog with the findings here.

### LOW — Sin Procesar & Entrada cleanup
8 stuck files in Sin Procesar (all 2025), 10 unprocessed in Entrada (mostly 2025). **Action:** manual triage as part of Q1 closing.

### Code audit findings (targeted manual review)

**Log-spam root cause (confirmed):** `prefetchExchangeRates` (`src/utils/exchange-rate.ts:252-300`) calls the ArgentinaDatos API for each USD-document date. When the API returns no rate (e.g., for old 2025 dates that aren't in their dataset, or transient failure), the prefetch logs once and returns — but does NOT cache a negative entry. So every subsequent call to `getExchangeRateSync` (inside `amountsMatchCrossCurrency`) returns "not cached", and the per-attempt warn at `exchange-rate.ts:346` fires for every (USD-factura × pago) combination on every match cycle. With 2 carryover unpaid 2025 USD facturas and ~70 pagos across all banks, that's hundreds of logs per cycle.

**Recommended fix:** Either
- Demote `exchange-rate.ts:346` warn → debug (cheapest fix); the prefetch already logs the *real* error once at line 276.
- Or store a "negative entry" in `memoryCache` when the API returns no rate, with shorter TTL — then `getExchangeRateSync` returns cleanly without further attempts.
- Combining both is best.

**Resumen storage silent-skip:** see CRITICAL section above.

**Cross-currency matching same-currency tolerance asymmetry** (`src/utils/exchange-rate.ts:333`): USD/USD same-currency matches use `sameCurrencyUsdTolerance = 1` by default, but callers pass `USD_SAME_CURRENCY_TOLERANCE` (likely larger). Verify the default isn't being used anywhere unexpected.

**Cascade matching** (factura/recibo): logic looks sound — depth limit, timeout, cycle detection, claim tracking are all properly wired. `iteration++` confirmed on both matchers.

**Movimientos detalle TOCTOU protection** (`src/services/movimientos-detalle.ts:55-75`): version-hash design is solid; TOCTOU mismatches are logged and skipped. Good.

**Match results filled=0 across banks** (from production logs): `Match movimientos completed ... filled=0 debitsFilled=0 creditsFilled=0`. Either nothing new to match (likely on idle cycles) or matching pool exclusions filter out everything. Worth a one-time data probe via /data-ops to confirm; not a bug if expected on quiet cycles.

**Inconsistency in cascade quality inference** (`src/processing/matching/recibo-pago-matcher.ts:105`): `hasCuitMatch: bestMatch.existingMatchConfidence === 'HIGH'` — infers cuitMatch only from HIGH. Compare with factura-pago which reads it directly. MANUAL-confidence existing matches will report `hasCuitMatch=false` here — could affect displacement decisions. Low-impact but a logical asymmetry worth noting.

**No console.log in source** ✓. **Logging volume:** the `Updating status sheet` log at 5-minute polling cadence is verbose but not in the spam tier; can be left for now.

---

## Q1 Closing Readiness

Books **can** be closed for Q1 once these are settled:
1. Reprocess the 2 missing resumenes (BBVA Visa Mar, Credicoop Feb).
2. Confirm the closing report reads `pagada` (column S) rather than `matchedPagoFileId` (column P).
3. Decide: close Q1 with 3 unpaid recibidas (Matarucco, Trobajo, BANA) carrying as accounts payable, and 2 unpaid emitidas (CFI, Mujeres en Tecnología) carrying as accounts receivable.

The trimester data is otherwise complete and reconciled.

---

## Suggested Plan (for human review next)

In priority order, with the smaller fixes shipping first so the operational state stabilizes before Q1 closing.

1. **Fix exchange-rate log spam** — `src/utils/exchange-rate.ts:346`. Demote warn → debug AND cache negative API responses in `prefetchExchangeRates`. One small PR, restores Railway logging signal. Until this lands, real warnings are getting buried.
2. **Recover the 2 missing resumenes** via the proven workflow:
   - Read the PDFs locally to see what dates Gemini extracts; confirm the data is good.
   - Delete from Drive + re-upload as a new fileId (BBVA Visa Mar 2026, Credicoop Feb 2026).
   - Verify rows land in Control de Resumenes.
3. **Investigate root cause for the two silent failures.** With #1 fixed, future occurrences will be visible in logs. Audit `storeResumen*` skip paths and tighten so no path returns success without a row.
4. **Investigate Credicoop narrow-date extraction** — Gemini is grabbing 2-7 day windows instead of full month statements. Likely a Gemini prompt issue and could be the root cause of #2.
5. **Q1 closing via `/data-ops`:**
   - Manually match PURPLE TREE 85k cobro on BBVA ARS Jan.
   - Confirm `Pagos Pendientes` / `Cobros Pendientes` are accurate.
   - Triage `Sin Procesar` (8 stuck old files) and `Entrada` (10 pending, mostly 2025).
   - Confirm closing report reads `pagada` (col S) not `matchedPagoFileId` (col P) — sparseness on P is expected.
   - Carry as accounts receivable: CFI 16.6M, Mujeres en Tecnología 1.08M.
   - Carry as accounts payable: Matarucco 650k, Trobajo 520k, BANA $75.
6. **Add "force reprocess" to `/data-ops`** — operational quality-of-life. Removes the need for the delete-and-reupload dance.
7. **Seed Linear Backlog** with everything not landed in this round so it doesn't disappear.
8. **Optional cleanup**: minor fixes from code audit (cascade `hasCuitMatch` asymmetry on recibo, USD tolerance default).
