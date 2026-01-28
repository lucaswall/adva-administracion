# Code Audit Findings

## item #1 [bug] [high]
getDocumentDate throws unhandled errors instead of returning Result<T,E> at src/services/document-sorter.ts:40-64. Function throws Error when document has no valid date field instead of returning Result, violating CLAUDE.md requirement and risking server crashes.

## item #2 [bug] [high]
Unhandled promise rejections in scanner at src/processing/scanner.ts:560,569. Promise.allSettled used for processingPromises and retryPromises but rejected promises never checked. Failed file processing goes unnoticed.

## item #3 [bug] [high]
Result<T,E> pattern violation in autofill at src/bank/autofill.ts:157-306. Function returns Result<BankAutoFillResult, Error> but always returns ok:true even when errors occur during processing. Increments result.errors but caller cannot distinguish success from partial failures.

## item #4 [bug] [high]
Inconsistent cross-currency confidence assignment at src/bank/matcher.ts:401-412,588-594. Cross-currency matches get HIGH confidence with CUIT match, but CLAUDE.md specifies "With CUIT → MEDIUM max; without → LOW". Violates matching specification.

## item #5 [bug] [high]
Timezone inconsistency in formatISODate at src/utils/date.ts:129-135. Uses local time methods (getFullYear, getMonth, getDate) while parseArgDate uses UTC methods. When date parsed with UTC then formatted back, may shift to different date depending on local timezone.

## item #6 [bug] [high]
Timezone inconsistency in exchange rate normalization at src/utils/exchange-rate.ts:104-112. Uses local time methods instead of UTC methods, inconsistent with parseArgDate. Exchange rate dates may be off by one day causing cache misses or wrong exchange rates.

## item #7 [bug] [high]
Race condition in duplicate notification detection at src/routes/webhooks.ts:82-84,96-98,114-117. TOCTOU race between isNotificationDuplicate check and markNotificationProcessed call. Two concurrent requests with same messageNumber could both pass duplicate check and queue scans.

## item #8 [bug] [high]
Race condition in folder structure cache at src/services/folder-structure.ts:600-667. ensureClassificationFolders cache check at line 614 happens BEFORE acquiring lock. Two concurrent calls can both pass check and attempt to create folder causing duplicate folder creation attempts and wasted API calls.

## item #9 [bug] [high]
TOCTOU race in duplicate detection at src/processing/storage/factura-store.ts:224 and similar in other stores. withLock has 10-second timeout but duplicate check done before lock acquisition. If two processes try to store same duplicate, first gets lock, second waits, but duplicate check was before lock.

## item #10 [bug] [medium]
Unsafe type assertion using any at src/gemini/client.ts:231. Code casts parseResult to any to access usageMetadata, bypassing TypeScript type checking. Could fail silently if parseResult structure changes.

## item #11 [convention] [medium]
Missing Result<T,E> pattern in processing matchers at src/processing/matching/factura-pago-matcher.ts:271-278 and recibo-pago-matcher.ts:230-233. Functions return raw Promise<number> instead of Result<number, Error>. CLAUDE.md requires Result<T,E> for all error-prone operations.

## item #12 [convention] [medium]
Multiple exported functions in gemini/parser.ts don't use Result<T,E> pattern at lines 30,40,73,164. Functions normalizeCuit, isAdvaName, assignCuitsAndClassify, extractJSON are error-prone but throw exceptions or return sentinel values instead of Result.

## item #13 [convention] [medium]
Inconsistent error handling strategies across matcher files. Some functions use Result pattern, some throw errors, some use try-catch. doMatchFacturasWithPagos throws at line 291 while outer matchFacturasWithPagos wraps in Result.

## item #14 [convention] [medium]
Missing test coverage for routes at src/routes/ directory. Per CLAUDE.md TDD requirement and colocated test convention, should have status.test.ts, scan.test.ts, and webhooks.test.ts. None exist. Routes contain critical business logic requiring tests.

## item #15 [convention] [medium]
Missing test coverage for auth middleware at src/middleware/auth.ts. Authentication middleware has complex security logic (constant-time comparison, bearer token parsing) but has no test file. Critical security component requires tests per CLAUDE.md.

## item #16 [convention] [medium]
ZERO test coverage for src/bank/ module. All three files (matcher.ts, autofill.ts, subdiario-matcher.ts) have no test files. CRITICAL VIOLATION of TDD mandate in CLAUDE.md requiring tests before implementation and >=80% coverage.

## item #17 [convention] [medium]
Missing test coverage for critical business logic modules: src/gemini/client.ts (core API integration), src/processing/scanner.ts (file scanning orchestration), src/services/drive.ts (Drive API wrapper), src/matching/matcher.ts (matching orchestration), src/matching/cascade-matcher.ts (cascading displacement logic). 71% of codebase files lack test coverage, violating CLAUDE.md 80% requirement.

## item #18 [edge-case] [medium]
Unsafe array access in pagos-pendientes at src/services/pagos-pendientes.ts:89-100. Directly accessing row indices without validation. If row shorter than expected (corrupted data), uses empty strings without logging or reporting, causing silent data corruption.

## item #19 [edge-case] [medium]
Unchecked array access in factura-pago matcher at src/processing/matching/factura-pago-matcher.ts:309-335. Direct array access row[0], row[1] without bounds checking. If row shorter than expected, returns undefined causing silent failures or type mismatches.

## item #20 [edge-case] [medium]
Timezone fetch falls back to UTC at src/services/status-sheet.ts:190-198. Timezone fetch failure logged but falls back to UTC silently. Fallback to UTC produces incorrect timestamps for Argentina timezone (America/Argentina/Buenos_Aires) - timestamps wrong by ~3 hours if fetch fails.

## item #21 [edge-case] [medium]
Validation functions allow invalid data through at src/gemini/parser.ts:726-748,765-787,809-831. Validation functions log warnings for invalid data (malformed dates, missing amounts) but still return data for processing. Invalid data gets stored relying on manual review later.

## item #22 [edge-case] [medium]
No size limit on JSON parsing at src/gemini/parser.ts lines 356,367,541,623,851,949,1060,1164,1219. JSON.parse called on response strings with no size validation. Malicious or malformed response with extremely large JSON could cause memory exhaustion and service crashes.

## item #23 [edge-case] [low]
Date substring without validation at src/processing/scanner.ts:1309. Uses resumen.fechaHasta.substring(0,4) assuming date in correct format. If malformed or shorter than 4 chars, could cause runtime errors.

## item #24 [edge-case] [low]
No validation of fechaPago format at src/utils/file-naming.ts:165. generateReciboFileName uses recibo.fechaPago.substring(0,7) without validating date format first. If fechaPago not in ISO format or too short, produces invalid filenames silently.

## item #25 [edge-case] [low]
No bounds checking on tolerancePercent at src/utils/exchange-rate.ts:241-295. amountsMatchCrossCurrency doesn't validate tolerancePercent parameter. Negative or extremely large values produce nonsensical bounds (negative tolerance → nothing matches, 1000% → everything matches).

## item #26 [edge-case] [low]
formatArgentineNumber and formatUSCurrency accept negative decimals at src/utils/numbers.ts:138-201. Both formatting functions accept decimals parameter without validating non-negative. Negative decimals passed to toFixed throws RangeError.

## item #27 [edge-case] [low]
Missing null check for parseArgDate results at src/bank/matcher.ts:270-276. Parses bankFecha and bankFechaValor, checks if both null, but then passes Date|null to finder methods. Creates redundant null checks throughout code at lines 344,348,424,428,525,529.

## item #28 [edge-case] [low]
Bank fee matching for credit movements at src/bank/matcher.ts:252,257-258. Bank fees can be debito or credito but code only checks debito amount. Bank fees that are credits get matched by pattern then rejected with "No debit amount" even though pattern matched.

## item #29 [edge-case] [low]
checkVersion doesn't handle circular references at src/utils/concurrency.ts:310-319. computeVersion uses JSON.stringify which throws on circular references. If versioned value contains circular structure, will crash.

## item #30 [edge-case] [low]
normalizeBankName doesn't handle null/undefined at src/utils/bank-names.ts:42-44. Function returns BANK_NAME_ALIASES[banco] || banco. If banco is null or undefined, returns undefined rather than empty string. JSDoc says accepts string but doesn't validate.

## item #31 [edge-case] [low]
formatMonthFolder doesn't handle invalid dates at src/utils/spanish-date.ts:29-34. No validation that date is valid Date object. If getMonth returns NaN, SPANISH_MONTHS[NaN] returns undefined.

## item #32 [edge-case] [low]
createDriveHyperlink doesn't validate fileId at src/utils/spreadsheet.ts:19-25. No validation that fileId is non-empty or matches Drive ID format. Empty fileId creates broken hyperlink formula.

## item #33 [edge-case] [low]
validateFactura checks importeNeto === undefined but not null at src/utils/validation.ts:261-263. Uses strict === undefined checks for numeric fields. If values are null (from JSON parsing), validation passes incorrectly. Should use == null to catch both.

## item #34 [edge-case] [low]
Type safety issue with bankName parameter at src/bank/autofill.ts:221-223. When bankName provided but doesn't exist in folderStructure.bankSpreadsheets, creates array with undefined [bankName, undefined]. While handled by subsequent if check, silently increments result.errors without logging which bank not found.

## item #35 [edge-case] [low]
Empty mimeType check happens after buffer conversion at src/gemini/client.ts:202-206. Expensive base64 conversion happens before checking if mimeType valid. Should validate mimeType first to avoid wasted computation on error path.

## item #36 [edge-case] [low]
Function parameter uses any type at src/gemini/parser.ts:230,232. validateAdvaRole data parameter typed as any, defeating TypeScript type checking. Accesses various properties without type guarantees (cuitEmisor, cuitReceptor) risking access to non-existent properties.

## item #37 [dead-code] [low]
AMOUNT_TOLERANCE constant not used in currency.ts at src/utils/currency.ts:8. Constant exported but only used in numbers.ts:amountsMatch which has its own default. Redundant file that could be consolidated or removed.

## item #38 [dead-code] [low]
detectNumberFormat exported but never used at src/utils/numbers.ts:28-42. Function only used internally by parseNumber. No external imports found.

## item #39 [dead-code] [low]
normalizeAmount exported but never used at src/utils/numbers.ts:212-220. Function exported but never imported anywhere.

## item #40 [dead-code] [low]
toDateString exported but never used at src/utils/date.ts:146-162. Function exported but never imported anywhere.

## item #41 [dead-code] [low]
extractCuitFromConcepto re-export is redundant at src/bank/matcher.ts:211-212. Re-exports extractCuitFromText as extractCuitFromConcepto for "convenience" but never imported or used elsewhere. Only used inline at line 268.

## item #42 [dead-code] [low]
extractCuitFromMovementConcepto re-export is redundant at src/bank/subdiario-matcher.ts:16-17. Re-export of extractCuitFromText never imported or used elsewhere. Only used internally in same file at line 93.

## item #43 [dead-code] [low]
Unused _pago parameter at src/bank/matcher.ts:557. createPagoFacturaMatch receives _pago parameter with underscore prefix but never uses it. Method only needs factura to create description. Parameter could be removed entirely.

## item #44 [dead-code] [low]
Unused _documentType parameter at src/gemini/parser.ts:232. validateAdvaRole receives _documentType parameter never used in function. Unclear why it's passed at all.

## item #45 [dead-code] [low]
Misleading legacy field comments at src/gemini/parser.ts:334-338. Fields marked as "legacy" for backwards compatibility in RawFacturaExtraction interface but actively used in code at lines 425-439. Comment misleading - not truly legacy if still being used.

## item #46 [practice] [low]
Unused documentType parameter in rematch endpoint at src/routes/scan.ts:98-103. /api/rematch endpoint accepts documentType parameter with type checking ('factura'|'recibo'|'all') but underlying rematch function doesn't accept parameters. Parameter parsed but completely ignored, misleading API consumers who expect selective rematching.

## item #47 [practice] [low]
Unhandled updateStatusSheet promise at src/routes/scan.ts:88. updateStatusSheet called with void operator intentionally ignoring errors. If operation fails, scan appears successful to user but dashboard not updated. Should at minimum log error.

## item #48 [practice] [low]
Direct mutation of parsed data object at src/gemini/parser.ts:469,565,653,965,1247. Parser functions receive parsed JSON and directly mutate data object by converting empty strings to undefined. Works but could be clearer with immutable patterns.

## item #49 [practice] [low]
Inconsistent timezone handling in spreadsheet operations at src/processing/storage/factura-store.ts:185 and other stores. Some stores fetch getSpreadsheetTimezone and pass to appendRowsWithLinks, others don't. Documentation says "Script-generated timestamps MUST use spreadsheet timezone" but implementation inconsistent.

## item #50 [practice] [low]
Missing documentation for match priorities at src/bank/matcher.ts:229-245. matchMovement has comment block describing priorities 0-5 but logic has 7 steps (0, 0.5, 1-5, 6). Priority "0.5" for credit card payments at line 262 not documented in comment block.

## item #51 [practice] [low]
Date calculation code duplication at src/bank/matcher.ts lines 346,350,426,430,527,531 and subdiario-matcher.ts:34. Date difference calculation Math.floor((date1.getTime() - date2.getTime()) / (1000*60*60*24)) repeated 6+ times. Utility function would be more maintainable and ensure consistent calculations.
