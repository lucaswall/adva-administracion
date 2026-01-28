# Code Audit Findings

## item #1 [memory-leak] [critical]
Memory leak in rate limiter at src/utils/rate-limiter.ts:45-92. The requestLog Map stores timestamps per key but never removes keys themselves. Only cleans arrays, not abandoned keys. Over time with unique UUID channelIds from webhooks, Map grows unboundedly causing memory exhaustion.

## item #2 [bug] [critical]
Race condition in triggerScan at src/services/watch-manager.ts:367-436. Function queues at most ONE pending scan. When multiple triggerScan calls occur with different folderId parameters while scan running, only LAST folderId stored - previous pending scans overwritten and lost. Documents from intermediate folders never processed.

## item #3 [memory-leak] [critical]
Unbounded folder structure cache at src/services/folder-structure.ts:566-570. Multiple Maps (yearFolders, classificationFolders, monthFolders, bankAccountFolders, bankAccountSpreadsheets) grow without bounds or cleanup mechanism. Memory leak over long-running server.

## item #4 [bug] [critical]
Data loss on write failure in token-usage-batch at src/services/token-usage-batch.ts:41-83. flush() clears entries at line 82 even if appendRowsWithFormatting() fails. If spreadsheet write fails, token usage data permanently lost with no recovery.

## item #5 [bug] [critical]
Property name typo in recibo-pago matcher at src/processing/matching/recibo-pago-matcher.ts:107,145,160,377,411,427. Code references bestMatch.hasCuilMatch but actual property is bestMatch.hasCuitMatch (with "T" not "L"). Returns undefined, causing logic errors in matching confidence evaluation.

## item #6 [bug] [critical]
Unsafe optional chaining at src/processing/storage/factura-store.ts:194, pago-store.ts:180, recibo-store.ts:140, retencion-store.ts:153, resumen-store.ts:218,334,455. Code uses context?.duplicateCache.addEntry() which only checks if context is null, NOT if duplicateCache is undefined. If context exists but duplicateCache undefined, throws TypeError.

## item #7 [bug] [critical]
Date format validation missing actual date check at src/gemini/parser.ts:706-709. isValidDateFormat() only checks regex pattern but doesn't validate if date is actually valid. "2024-02-30" passes regex but is invalid date, allowing malformed dates to be stored.

## item #8 [async] [critical]
Promise.all without error handling in exchange rate prefetch at src/utils/exchange-rate.ts:212-223. prefetchExchangeRates() uses Promise.all() which rejects if any promise fails, but no catch/error handling. Exchange rate fetch could fail silently causing all USD-ARS matching to fail.

## item #9 [bug] [critical]
Incorrect CUIT matching logic at src/matching/matcher.ts:198-204. Fallback checks pago.cuitPagador === factura.cuitEmisor but this is backwards. Payer CUIT should match invoice receptor (who receives), not emisor (who issues). Could cause false positives.

## item #10 [dead-code] [critical]
Dead code - unreachable subdiario_cobro match type at src/bank/autofill.ts:274-275. BankMatchType includes 'subdiario_cobro' and BankAutoFillResult has counter, but BankMovementMatcher.matchMovement() never returns this type. Case never executes.

## item #11 [bug] [critical]
getDocumentDate throws unhandled errors instead of returning Result<T,E> at src/services/document-sorter.ts:40-64. Function throws Error when document has no valid date field instead of returning Result, violating CLAUDE.md requirement and risking server crashes.

## item #12 [bug] [critical]
Result<T,E> pattern violation in autofill at src/bank/autofill.ts:157-306. Function returns Result<BankAutoFillResult, Error> but always returns ok:true even when errors occur. Increments result.errors but caller cannot distinguish success from partial failures.

## item #13 [bug] [critical]
Inconsistent cross-currency confidence assignment at src/bank/matcher.ts:401-412,588-594. Cross-currency matches get HIGH confidence with CUIT match, but CLAUDE.md specifies "With CUIT -> MEDIUM max; without -> LOW". Violates matching specification.

## item #14 [bug] [high]
Race condition in conditional formatting at src/services/status-sheet.ts:97-154. conditionalFormattingApplied global flag not protected. Multiple concurrent updateStatusSheet() calls may both think formatting not applied and attempt duplicate applications.

## item #15 [async] [high]
Unhandled errors in cron jobs at src/services/watch-manager.ts:120-144. Cron jobs (renewal, polling, status update, cleanup) don't have explicit error handlers. If async functions throw, errors silently dropped. Watch manager could fail silently.

## item #16 [bug] [high]
Error not caught in recursive list function at src/services/drive.ts:43-134. listFilesInFolder() is recursive but if any recursive call fails, error caught at line 128 only returns empty array. Parent recursion continues with partial results without error reporting.

## item #17 [bug] [high]
Hard-coded column indices without validation at src/services/pagos-pendientes.ts:58,90-100. Column indices hard-coded (row[18] for "pagada", row[9] for "importeTotal") with no validation that spreadsheet headers match expected structure.

## item #18 [bug] [high]
Pagos pendientes data loss risk at src/services/pagos-pendientes.ts:71-106. clearSheetData() called at line 71 before appendRowsWithFormatting(). If append fails, original data permanently lost.

## item #19 [convention] [high]
Missing timezone parameter at src/services/pagos-pendientes.ts:103-106. appendRowsWithFormatting() called without timeZone parameter. Timestamps default to UTC instead of server timezone, inconsistent with other Dashboard sheets.

## item #20 [async] [high]
Fire-and-forget promise without error handling at src/processing/extractor.ts:146-159. logTokenUsage() called with void, .then() chain only logs warnings on failure. If logging fails, error silently swallowed, metrics could be lost.

## item #21 [edge-case] [high]
Unsafe string split without validation at src/processing/caches/sort-batch.ts:33. Code splits by ':' without validating result has exactly 2 elements. If key contains multiple colons, destructuring assigns undefined to sheetName.

## item #22 [bug] [high]
Cross-currency confidence not reduced in bank matcher at src/bank/matcher.ts:583-607. BankMovementMatcher supports cross-currency but doesn't apply reduced confidence. Cross-currency matches get full HIGH confidence, but should be capped at MEDIUM per CLAUDE.md.

## item #23 [edge-case] [high]
Credit movements skipped in bank matcher at src/bank/matcher.ts:257-260. Matcher only processes movements with debito. All credit movements skip main matching logic. Income payments to Facturas Emitidas or Pagos Recibidos won't match through standard flow.

## item #24 [edge-case] [high]
Floating-point precision in exchange rate matching at src/utils/exchange-rate.ts:279-287. Multiple floating-point multiplications accumulate rounding errors. Valid USD payments could be marked as non-matching due to precision loss.

## item #25 [edge-case] [high]
Year validation too restrictive at src/utils/date.ts:26-27. isValidISODate() limits years to currentYear + 1. Batch-processed documents from 2-3 years ago rejected as invalid.

## item #26 [type] [high]
Type assertion without runtime validation at src/utils/exchange-rate.ts:152-159. Type assertion allows undefined but check should verify data is an object. Malformed JSON responses could pass validation.

## item #27 [edge-case] [high]
Card type validation not triggering review flag at src/gemini/parser.ts:957-966. When tipoTarjeta is invalid, set to undefined but needsReview flag NOT set to true. Credit card statements with invalid card types silently lose data without user notification.

## item #28 [bug] [high]
Timezone inconsistency in formatISODate at src/utils/date.ts:129-135. Uses local time methods (getFullYear, getMonth, getDate) while parseArgDate uses UTC methods. When date parsed with UTC then formatted back, may shift to different date.

## item #29 [bug] [high]
Timezone inconsistency in exchange rate normalization at src/utils/exchange-rate.ts:104-112. Uses local time methods instead of UTC methods, inconsistent with parseArgDate. Exchange rate dates may be off by one day causing cache misses.

## item #30 [bug] [high]
Race condition in duplicate notification detection at src/routes/webhooks.ts:82-84,96-98,114-117. TOCTOU race between isNotificationDuplicate check and markNotificationProcessed call. Two concurrent requests could both pass duplicate check and queue scans.

## item #31 [edge-case] [high]
Exchange rate cache miss not handled at src/bank/autofill.ts:256. When USD invoices matched, exchange rates must be pre-fetched. If rate missing, returns matches:false with cacheMiss:true but autofill.ts doesn't pre-fetch, treats cache misses as normal non-matches.

## item #32 [bug] [medium]
Unsafe type assertion using any at src/gemini/client.ts:231. Code casts parseResult to any to access usageMetadata, bypassing TypeScript type checking. Could fail silently if parseResult structure changes.

## item #33 [edge-case] [medium]
Unsafe array access in pagos-pendientes at src/services/pagos-pendientes.ts:89-100. Directly accessing row indices without validation. If row shorter than expected, uses empty strings without logging.

## item #34 [edge-case] [medium]
Unchecked array access in factura-pago matcher at src/processing/matching/factura-pago-matcher.ts:309-335. Direct array access row[0], row[1] without bounds checking. If row shorter, returns undefined causing silent failures.

## item #35 [edge-case] [medium]
Timezone fetch falls back to UTC at src/services/status-sheet.ts:190-198. Timezone fetch failure logged but falls back to UTC silently. Fallback produces incorrect timestamps (~3 hours off for Argentina).

## item #36 [edge-case] [medium]
No size limit on JSON parsing at src/gemini/parser.ts lines 356,367,541,623,851,949,1060,1164,1219. JSON.parse called on response strings with no size validation. Malformed response with large JSON could cause memory exhaustion.

## item #37 [edge-case] [medium]
NC date validation lacks reasonable window at src/processing/matching/nc-factura-matcher.ts:216-219. NC date validation only checks nc.fechaEmision < factura.fechaEmision but doesn't validate dates within same period. Very old NC could match recent factura.

## item #38 [edge-case] [medium]
Exponential backoff starts too high at src/gemini/client.ts:146-147. delay = 2^attempt * 1000, so attempt=1 waits 2s. Standard backoff should start at 1s with 2^(attempt-1).

## item #39 [edge-case] [medium]
CUIT assignment doesn't validate other CUIT at src/gemini/parser.ts:81-82. If allCuits empty or no non-ADVA CUIT, otherCuit becomes empty string. No validation it's a valid 11-digit CUIT.

## item #40 [edge-case] [medium]
Leading zero removal in DNI extraction at src/utils/validation.ts:156-157. Removes ALL leading zeros. CUIT "20007654321" becomes DNI "7654321", could fail to match source showing "00007654321".

## item #41 [edge-case] [medium]
Currency symbol removal incomplete at src/utils/numbers.ts:77-78. Only removes $ and spaces. Doesn't handle u$s, USD, ARS, pesos suffixes. Numbers with currency text won't parse correctly.

## item #42 [edge-case] [medium]
Incomplete quote escaping in hyperlink at src/utils/spreadsheet.ts:57-62. Only escapes quotes, not backslashes or newlines. File names with quotes/backslashes could break spreadsheet formulas.

## item #43 [convention] [medium]
Truncated response handling is silent at src/gemini/parser.ts:164-186. Returns empty string both when truncated AND when no JSON found. Caller treats both same way, difficult to debug.

## item #44 [edge-case] [medium]
Bare Drive ID validation too permissive at src/utils/drive-parser.ts:54-56. Any 28-44 char alphanumeric string passes. No checksum validation. Could false-positive on random strings.

## item #45 [edge-case] [medium]
Single replace for multiple Argentine format commas at src/utils/numbers.ts:91-92. replace(',', '.') only replaces FIRST comma. Corrupted data with multiple commas won't parse correctly.

## item #46 [type] [medium]
Type assertion without validation in cascade matcher at src/matching/cascade-matcher.ts:38. Unsafely casts document to assume it has fileId. Should add type guard or validation.

## item #47 [edge-case] [low]
No fechaPago format validation at src/utils/file-naming.ts:165. generateReciboFileName uses recibo.fechaPago.substring(0,7) without validating date format. If fechaPago not ISO format, produces invalid filenames.

## item #48 [edge-case] [low]
No bounds checking on tolerancePercent at src/utils/exchange-rate.ts:241-295. amountsMatchCrossCurrency doesn't validate tolerancePercent. Negative or extremely large values produce nonsensical bounds.

## item #49 [edge-case] [low]
formatArgentineNumber and formatUSCurrency accept negative decimals at src/utils/numbers.ts:138-201. Both functions accept decimals parameter without validating non-negative. Negative decimals passed to toFixed throws RangeError.

## item #50 [edge-case] [low]
checkVersion doesn't handle circular references at src/utils/concurrency.ts:310-319. computeVersion uses JSON.stringify which throws on circular references.

## item #51 [edge-case] [low]
normalizeBankName doesn't handle null/undefined at src/utils/bank-names.ts:42-44. If banco is null or undefined, returns undefined rather than empty string.

## item #52 [edge-case] [low]
formatMonthFolder doesn't handle invalid dates at src/utils/spanish-date.ts:29-34. No validation that date is valid Date object. If getMonth returns NaN, SPANISH_MONTHS[NaN] returns undefined.

## item #53 [edge-case] [low]
createDriveHyperlink doesn't validate fileId at src/utils/spreadsheet.ts:19-25. No validation that fileId is non-empty or matches Drive ID format. Empty fileId creates broken hyperlink.

## item #54 [edge-case] [low]
validateFactura checks importeNeto === undefined but not null at src/utils/validation.ts:261-263. If values are null from JSON parsing, validation passes incorrectly.

## item #55 [edge-case] [low]
Empty mimeType check order at src/gemini/client.ts:202-206. Expensive base64 conversion happens before checking if mimeType valid. Should validate mimeType first.

## item #56 [type] [low]
Function parameter uses any type at src/gemini/parser.ts:230,232. validateAdvaRole data parameter typed as any, defeating TypeScript type checking.

## item #57 [dead-code] [low]
AMOUNT_TOLERANCE constant not used in currency.ts at src/utils/currency.ts:8. Constant exported but only used in tests.

## item #58 [dead-code] [low]
detectNumberFormat exported but never used at src/utils/numbers.ts:28-42. Function only used internally by parseNumber.

## item #59 [dead-code] [low]
normalizeAmount exported but never used at src/utils/numbers.ts:212-220.

## item #60 [dead-code] [low]
toDateString exported but never used at src/utils/date.ts:146-162.

## item #61 [dead-code] [low]
extractCuitFromConcepto re-export is redundant at src/bank/matcher.ts:211-212. Re-export never imported or used elsewhere.

## item #62 [dead-code] [low]
extractCuitFromMovementConcepto re-export is redundant at src/bank/subdiario-matcher.ts:16-17. Re-export never imported or used elsewhere.

## item #63 [dead-code] [low]
Unused _pago parameter at src/bank/matcher.ts:557. Parameter with underscore prefix never used in function body.

## item #64 [dead-code] [low]
Unused _documentType parameter at src/gemini/parser.ts:232. Parameter never used in function.

## item #65 [dead-code] [low]
Misleading legacy field comments at src/gemini/parser.ts:334-338. Fields marked "legacy" but actively used. Comment misleading.

## item #66 [practice] [low]
Unused documentType parameter in rematch endpoint at src/routes/scan.ts:98-103. Parameter parsed but completely ignored, misleading API consumers.

## item #67 [practice] [low]
Direct mutation of parsed data object at src/gemini/parser.ts:469,565,653,965,1247. Parser functions directly mutate data object. Could be clearer with immutable patterns.

## item #68 [duplicate] [low]
Date calculation code duplication at src/bank/matcher.ts lines 346,350,426,430,527,531 and subdiario-matcher.ts:34. Date difference calculation repeated 6+ times. Utility function would be more maintainable.

## item #69 [convention] [low]
Missing null coalescing vs OR operator at src/utils/file-naming.ts:94,136,139. Using || with empty strings from JSON won't trigger fallback. Should use nullish coalescing ??.

## item #70 [practice] [low]
Confusing CUIT vs CUIL property naming at src/matching/matcher.ts:469,487. MatchQuality uses hasCuitMatch but ReciboPagoMatcher creates hasCuilMatch. Works but confusing.

## item #71 [edge-case] [low]
Substring matching for keywords could have false positives at src/bank/matcher.ts:136-142. Keyword matching uses substring inclusion which could match common words incorrectly.
