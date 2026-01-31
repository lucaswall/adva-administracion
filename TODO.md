# Code Audit Findings

## item #1 [bug] [high]
Race condition in conditional formatting at src/services/status-sheet.ts:97-154. conditionalFormattingApplied global flag not protected. Multiple concurrent updateStatusSheet() calls may both pass the check before either sets the flag.

## item #2 [bug] [high]
Hard-coded column indices without validation at src/services/pagos-pendientes.ts:58,90-100. Column indices hard-coded (row[18] for "pagada", row[9] for "importeTotal") with no validation that spreadsheet headers match expected structure.

## item #3 [bug] [high]
Pagos pendientes data loss risk at src/services/pagos-pendientes.ts:71-106. clearSheetData() called before appendRowsWithFormatting(). If append fails, original data permanently lost.

## item #4 [bug] [high]
Race condition in duplicate notification detection at src/routes/webhooks.ts:96-102,122-125. TOCTOU race between isNotificationDuplicate check and markNotificationProcessed call. Two concurrent requests could both pass duplicate check.

## item #5 [edge-case] [high]
Floating-point precision in exchange rate matching at src/utils/exchange-rate.ts:279-287. Multiple floating-point multiplications accumulate rounding errors. Valid USD payments could be marked as non-matching due to precision loss.

## item #6 [edge-case] [high]
Year validation too restrictive at src/utils/date.ts:26-27. isValidISODate() limits years to currentYear + 1. Batch-processed documents from 2-3 years ago rejected as invalid.

## item #7 [type] [high]
Type assertion without runtime validation at src/utils/exchange-rate.ts:152-159. Type assertion allows undefined but check should verify data is an object. Malformed JSON responses could pass validation.

## item #8 [edge-case] [high]
Card type validation not triggering review flag at src/gemini/parser.ts:1000-1008. When tipoTarjeta is invalid, set to undefined but needsReview flag NOT set to true.

## item #9 [bug] [high]
Timezone inconsistency in formatISODate at src/utils/date.ts:129-135. Uses local time methods while parseArgDate uses UTC methods. Dates parsed with UTC then formatted back may shift to different date.

## item #10 [type] [high]
Missing TipoTarjeta validation function. Type TipoTarjeta defined in src/types/index.ts:257 with values 'Visa' | 'Mastercard' | 'Amex' | 'Naranja' | 'Cabal', but NO validateTipoTarjeta() function exists in validation.ts.

## item #11 [type] [high]
Confidence field has no type constraints at src/types/index.ts multiple interfaces. All confidence fields typed as plain number, not constrained to 0.0-1.0 range. Allows negative, >1, NaN, Infinity.

## item #12 [edge-case] [high]
Optional balance fields in ResumenBroker have no constraints at src/types/index.ts:450-452. saldoARS and saldoUSD are both optional but no constraint requires at least one to be present.

## item #13 [async] [high]
Unbounded timezone cache growth at src/services/sheets.ts:33-59. timezoneCache Map has no size limit. Old entries only expire on re-access. If spreadsheet never accessed again after 24 hours, entry persists indefinitely.

## item #14 [async] [high]
Promise not awaited in watch-manager triggerScan at src/services/watch-manager.ts:391-443. Recursive triggerScan() call at line 440 NOT awaited. Multiple recursive calls could pile up and execute concurrently.

## item #15 [bug] [high]
Potential null reference in folder-structure.ts at src/services/folder-structure.ts:622-661. Inside lock, code uses cachedStructure! non-null assertion. If discoverFolderStructure() clears cache between lock acquisition and usage, assertion fails.

## item #16 [bug] [high]
Missing null check after DisplacementQueue.pop() at src/processing/matching/factura-pago-matcher.ts:50-53. After pop(), line 53 does unsafe type assertion on displaced.document as Pago. If document is undefined, creates unsafe reference.

## item #17 [async] [high]
Unprotected mutable loggerInstance at src/utils/logger.ts:11,17. loggerInstance is module-level mutable variable without synchronization. Concurrent async calls before initialization could create race condition. Also getConfig() call at line 18 can throw.

## item #18 [edge-case] [high]
Race condition in retriedFileIds tracking at src/processing/scanner.ts:46,249-251. The check-then-add pattern is not atomic. Multiple concurrent queue tasks could both see the same fileId not in set.

## item #19 [bug] [high]
dateProximityDays defaulting incorrect at src/matching/matcher.ts:276-282,484-490. Uses dateProximityDays || 999 as default. Zero days difference is falsy, so 0 || 999 = 999, incorrectly treating perfect matches as far matches.

## item #20 [bug] [high]
Non-nullable resolver use without initialization at src/gemini/client.ts:517. The non-null assertion `resolver!()` is unsafe. If Promise constructor synchronously throws, resolver remains uninitialized but try/finally will call undefined.

## item #21 [async] [high]
Missing nullability check in match-movimientos quality comparison at src/bank/match-movimientos.ts:641-650. If buildMatchQualityFromFileId returns null (document not found), code silently replaces existing matches with new match when original document is missing. Matched file IDs become orphaned.

## item #22 [bug] [high]
Incomplete error context in autofill batch processing at src/bank/autofill.ts:236-238,297-300. When a single bank fails to load movements or batch update fails, error is counted but no details logged. Function returns ok:true with partial results - callers see success but don't know which banks failed.

## item #23 [bug] [medium]
Unsafe type assertion using any at src/gemini/client.ts:230-232. Code casts parseResult to any to access usageMetadata, bypassing TypeScript type checking.

## item #24 [edge-case] [medium]
No size limit on JSON parsing at src/gemini/parser.ts multiple lines. JSON.parse called on response strings with no size validation. Oversized JSON could consume memory before parse error.

## item #25 [edge-case] [medium]
Truncated response handling is silent at src/gemini/parser.ts:164-186. Returns empty string both when truncated AND when no JSON found. Caller treats both same way, difficult to debug.

## item #26 [edge-case] [medium]
formatMonthFolder doesn't handle invalid dates at src/utils/spanish-date.ts:29-34. If date is invalid, getMonth() returns NaN. SPANISH_MONTHS[NaN] returns undefined, creating invalid output.

## item #27 [practice] [medium]
Direct mutation of parsed data object at src/gemini/parser.ts:469,565,653,996,1314. Parser functions directly mutate data object. Could be clearer with immutable patterns.

## item #28 [practice] [medium]
CUIT vs CUIL property naming confusion at src/matching/matcher.ts:474,487. MatchQuality uses hasCuitMatch but ReciboPagoMatcher creates hasCuilMatch. Works but confusing.

## item #29 [edge-case] [medium]
Keyword matching substring could have false positives at src/bank/matcher.ts:136-142. Keyword matching uses substring inclusion which could match common words incorrectly.

## item #30 [practice] [medium]
Unused documentType parameter in rematch endpoint at src/routes/scan.ts:98-103. Parameter parsed but completely ignored, misleading API consumers.

## item #31 [security] [medium]
API key stored in memory without cleanup at src/gemini/client.ts:59,75,221. Gemini API key persists in GeminiClient instance. No mechanism to clear/zero key after use.

## item #32 [security] [medium]
Insufficient error detail sanitization in logging at src/gemini/client.ts:254-259. Logs entire error object with details that may include sensitive API data.

## item #33 [async] [medium]
Rate limiter doesn't account for error responses at src/gemini/client.ts:243. Failed requests don't count toward RPM limit. Client that always fails could make unlimited requests.

## item #34 [edge-case] [medium]
Unvalidated response structure before accessing nested properties at src/gemini/client.ts:380-382. Uses optional chaining but doesn't validate structure explicitly, masking errors.

## item #35 [async] [medium]
No connection pooling or resource management at src/gemini/client.ts:217-224. Each fetch creates new connection. No Keep-Alive, no pooling, no max concurrent limit.

## item #36 [edge-case] [medium]
Rate limiter cleanup method mutates while iterating at src/utils/rate-limiter.ts:98-116. Deletes entries during Map iteration which can cause items to be skipped.

## item #37 [bug] [medium]
Rate limiter doesn't clear validRequests mutation at src/utils/rate-limiter.ts:67-85. Old expired timestamps accumulate in memory. Memory leak for long-lived instances.

## item #38 [async] [medium]
Correlation context updates aren't atomic at src/utils/correlation.ts:98-104. Modifies stored context directly without atomic guarantees. Partial updates observable by concurrent code.

## item #39 [edge-case] [medium]
Exchange rate cache date manipulation at src/utils/exchange-rate.ts:138-140. Splits isoDate by '-' without validating result format after normalization.

## item #40 [edge-case] [medium]
prefetchExchangeRates silently drops null dates at src/utils/exchange-rate.ts:214-215. If date fails to normalize, it's filtered out. No warning logged about failed dates.

## item #41 [bug] [medium]
Missing error handling in token-usage-batch flush at src/services/token-usage-batch.ts:45-101. If appendRowsWithFormatting fails, entries preserved for retry but could cause duplicates.

## item #42 [edge-case] [medium]
Unvalidated timeZone fallback in token-usage-logger at src/services/token-usage-logger.ts:86-163. If getSpreadsheetTimezone fails, timeZone is undefined. Causes incorrect serialization.

## item #43 [edge-case] [medium]
Missing validation in getOrCreateMonthSheet at src/services/sheets.ts:1365-1431. If headers.length > 26, column letter calculation invalid (beyond Z). Also batch deferred reordering returns success without confirming.

## item #44 [edge-case] [medium]
Unsafe Map.get() without null checks at src/processing/matching/factura-pago-matcher.ts:115,178,445. Multiple locations use Map.get() and .find() without proper null handling when result undefined.

## item #45 [edge-case] [medium]
Silent failure when previousFactura not found at src/processing/matching/factura-pago-matcher.ts:177-197. If previousFactura undefined, no logging and no update. Factura remains marked matched.

## item #46 [edge-case] [medium]
Potential false positive in keyword extraction at src/bank/matcher.ts:94-98. Filter tokens by length >= 3 but legitimate 3-letter company abbreviations like "SKF", "IBM" might match incorrectly.

## item #47 [edge-case] [medium]
Missing null check for pago.matchedFacturaFileId comparison at src/bank/matcher.ts:282-290. If matchedFacturaFileId exists but linked factura not found in array, silently continues.

## item #48 [edge-case] [medium]
No validation of moneda enum in cross-currency check at src/bank/matcher.ts:599. Checks factura.moneda === 'USD' but unexpected values like 'EUR' pass silently.

## item #49 [edge-case] [medium]
Unsafe document type casting in DisplacementQueue at src/matching/cascade-matcher.ts:38-39. Casts (item.document as { fileId: string }).fileId without type guard.

## item #50 [edge-case] [medium]
computeVersion doesn't handle undefined values safely at src/utils/concurrency.ts:310-319. JSON.stringify on BigInt, Symbols, or circular references throws. No try-catch.

## item #51 [edge-case] [medium]
createDriveHyperlink doesn't validate fileId format at src/utils/spreadsheet.ts:57-63. If fileId contains special URL characters or is empty, constructed URL broken.

## item #52 [validation] [medium]
Missing input validation schemas at src/routes/scan.ts:18-92. Routes define TypeScript interfaces but Fastify NOT using JSON schema validation. Invalid JSON sends {} instead of rejecting.

## item #53 [validation] [medium]
No validation of bankName parameter at src/routes/scan.ts:119-124. bankName from request body not validated for non-empty or existence. Could cause silent failures.

## item #54 [edge-case] [medium]
Missing validation for documentType enum at src/routes/scan.ts:98-113. documentType not validated at runtime. Client sending invalid value not rejected.

## item #55 [type] [medium]
Request body type assertion without runtime check at src/routes/scan.ts:53,98,119. Generic type parameters are compile-time only. Non-object JSON silently destructures.

## item #56 [bug] [medium]
Missing divisor validation in date calculation at src/bank/subdiario-matcher.ts:32-35. daysBetween() with invalid dates produces Infinity or NaN that propagates to comparisons.

## item #57 [edge-case] [medium]
Potential null pointer in autoFill when no documents at src/bank/autofill.ts:197-207. If all arrays empty, matcher receives empty arrays. Silent failure not tracked.

## item #58 [edge-case] [medium]
Missing pino transport error handling at src/utils/logger.ts:21-32. Pino logger initialization doesn't catch exceptions. Invalid config causes unhandled failure.

## item #59 [edge-case] [medium]
Movimientos count validation too lenient at src/gemini/parser.ts:918-931,1047-1060,1155-1168. Uses 10% threshold but for small expectedCount, allows 1->2 change without flagging.

## item #60 [async] [medium]
Unbounded memory growth in TokenUsageBatch at src/services/token-usage-batch.ts:36-38. The batch accumulates entries indefinitely until flush() is called. No maximum batch size limit enforced. Under high-volume scenarios, memory bloat.

## item #61 [async] [medium]
Repeated timezone failures in token-usage-batch at src/services/token-usage-batch.ts:51-54. If timezone retrieval fails on first call, this.timezone is undefined. On subsequent flushes check is true again, causing repeated failed API calls.

## item #62 [validation] [medium]
Invalid bank name not validated at src/bank/autofill.ts:224-226. If bankName is provided but doesn't exist in bankSpreadsheets, returns undefined. Route handler doesn't validate that bank exists before calling autofill.

## item #63 [security] [medium]
Unsafe non-null assertion for config.apiSecret at src/middleware/auth.ts:97. In non-production environments, missing API_SECRET allows unauthenticated access with empty token if API_SECRET is empty string.

## item #64 [edge-case] [low]
Potential memory leak from unbounded cascadeState.updates Map at src/processing/matching/factura-pago-matcher.ts:395-401. Map grows with facturas count. No per-iteration memory check.

## item #65 [edge-case] [low]
Unchecked Map lookups in factura-pago-matcher updates at src/processing/matching/factura-pago-matcher.ts:564-572. If pagosMap.get() returns undefined, update silently skipped.

## item #66 [dead-code] [low]
AMOUNT_TOLERANCE constant not used at src/utils/currency.ts:8. Constant exported but only used in tests.

## item #67 [practice] [low]
DocumentType includes both 'unrecognized' and 'unknown' at src/types/index.ts:54-55. Semantic confusion; unclear which should be used in different contexts.

## item #68 [practice] [low]
parseAmount doesn't document negative value behavior at src/utils/numbers.ts:122-125. Always returns positive via Math.abs but JSDoc doesn't state this.

## item #69 [edge-case] [low]
Exchange rate cache TTL not validated on fetch at src/utils/exchange-rate.ts:121-178. No validation that fetched rate's fecha field is valid or matches request date.

## item #70 [practice] [low]
Drive service not cleared in tests at src/services/drive.ts:14. Unlike sheets.ts which exports clearSheetsCache(), drive.ts has no clearDriveCache(). Tests may use stale instances.

## item #71 [practice] [low]
No Status Code Set Before Some Error Returns at src/routes/scan.ts:62-68. Pattern calls reply.status(400) but doesn't call reply.send(), relies on implicit serialization.

## item #72 [edge-case] [low]
Hard-coded MIN_KEYWORD_MATCH_SCORE at src/bank/matcher.ts:152,462. MIN_KEYWORD_MATCH_SCORE = 2 without contextual validation. No adaptive scoring based on token frequency.

## item #73 [edge-case] [low]
Missing HTTP error response size limit at src/gemini/client.ts:226. response.text() buffers entire response. Large error responses waste memory.

## item #74 [edge-case] [low]
Potential match quality calculation inconsistency at src/bank/match-movimientos.ts:689-700. isExactAmount set to true for both existing and candidate, masks amount mismatches - could cause worse matches to be selected.

## item #75 [edge-case] [low]
Empty error message on parse failure at src/bank/autofill.ts:24. When required columns missing, function silently returns null without logging which row or column failed.

## item #76 [edge-case] [low]
Timezone cache not invalidated on spreadsheet updates at src/services/sheets.ts:32-59. If spreadsheet timezone changed by admin, cache won't update for up to 24 hours.
