# Code Audit Findings

## item #1 [bug] [critical]
Wrong CUIT field assignment in recibo-pago-matcher.ts at lines 297-298. Both `cuitPagador` and `cuitBeneficiario` are assigned from row[7], causing incorrect CUIT values for recibo-pago matching. This breaks matching logic by using wrong counterparty info.

## item #2 [bug] [high]
DuplicateCache silent failure in caches/duplicate-cache.ts at line 38. If sheet load fails, the function silently returns without setting cache data. The loadPromise is marked as completed, so subsequent calls won't retry, making duplicate detection unreliable for that sheet.

## item #3 [bug] [high]
Module-level retry tracking Map in scanner.ts at line 51 can be corrupted if concurrent scan attempts occur. The Map is shared across all invocations and only cleared in finally block, creating potential state corruption and memory leaks between scan cycles.

## item #4 [data-loss] [high]
Pagos-pendientes.ts at lines 145-176 uses clear-before-write pattern. If write fails after clear, pending payment data is permanently lost. Warning is logged but no recovery mechanism exists.

## item #5 [race-condition] [high]
Folder-structure.ts cache can be cleared during locked operations at lines 642-645. While lock prevents concurrent calls to same folder creation, it doesn't prevent clearFolderStructureCache() from being called by a different code path, causing exceptions.

## item #6 [async] [medium]
Unhandled promise rejection in fire-and-forget operations at extractor.ts line 146 and scanner.ts line 326. If promises reject before .then() handlers execute, errors are silently swallowed.

## item #7 [race-condition] [medium]
Files marked as processing in scanner.ts at lines 88-103 can remain in limbo for 5 minutes if extraction fails between two markFileProcessing calls. The dual-status tracking creates a gap where failure isn't properly detected.

## item #8 [cache] [medium]
MetadataCache stores promises directly in cache at lines 18-25. If a promise rejects, subsequent calls will await the same rejected promise, creating permanent negative cache entries for transient API failures.

## item #9 [edge-case] [medium]
Cascading displacement in factura-pago-matcher.ts at line 93 doesn't handle case where all facturas are claimed. If a displaced pago had a previous match but all remaining facturas are claimed, the old match stays incorrectly attached.

## item #10 [type] [medium]
Unsafe type assertion using any at src/gemini/client.ts:241-242. Code casts parseResult to any to access usageMetadata, bypassing TypeScript type checking.

## item #11 [validation] [medium]
Document type assertions in document-sorter.ts at lines 152-183 use property introspection without validation. If a document has multiple type-indicating properties, it matches the first condition checked, potentially routing to wrong folder.

## item #12 [validation] [medium]
Sheet name in movimientos-detalle.ts at lines 42-45 is not validated before being inserted into A1 notation range string. Complex sheet names could cause issues.

## item #13 [edge-case] [medium]
No size limit on JSON parsing at src/gemini/parser.ts multiple lines. JSON.parse called on response strings with no size validation. Oversized JSON could consume memory before parse error.

## item #14 [practice] [medium]
Direct mutation of parsed data object at src/gemini/parser.ts:469,565,653,996,1314. Parser functions directly mutate data object. Could be clearer with immutable patterns.

## item #15 [practice] [medium]
CUIT vs CUIL property naming confusion at src/matching/matcher.ts:474,487. MatchQuality uses hasCuitMatch but ReciboPagoMatcher creates hasCuilMatch. Works but confusing.

## item #16 [edge-case] [medium]
Keyword matching substring could have false positives at src/bank/matcher.ts:136-142. Keyword matching uses substring inclusion which could match common words incorrectly.

## item #17 [practice] [medium]
Unused documentType parameter in rematch endpoint at src/routes/scan.ts:98-103. Parameter parsed but completely ignored, misleading API consumers.

## item #18 [security] [medium]
API key stored in memory without cleanup at src/gemini/client.ts:59,75,221. Gemini API key persists in GeminiClient instance. No mechanism to clear/zero key after use.

## item #19 [security] [medium]
Insufficient error detail sanitization in logging at src/gemini/client.ts:254-259. Logs entire error object with details that may include sensitive API data.

## item #20 [async] [medium]
Rate limiter doesn't account for error responses at src/gemini/client.ts:243. Failed requests don't count toward RPM limit. Client that always fails could make unlimited requests.

## item #21 [edge-case] [medium]
Unvalidated response structure before accessing nested properties at src/gemini/client.ts:380-382. Uses optional chaining but doesn't validate structure explicitly, masking errors.

## item #22 [async] [medium]
No connection pooling or resource management at src/gemini/client.ts:217-224. Each fetch creates new connection. No Keep-Alive, no pooling, no max concurrent limit.

## item #23 [edge-case] [medium]
Exchange rate cache date manipulation at src/utils/exchange-rate.ts:138-140. Splits isoDate by '-' without validating result format after normalization.

## item #24 [edge-case] [medium]
prefetchExchangeRates silently drops null dates at src/utils/exchange-rate.ts:214-215. If date fails to normalize, it's filtered out. No warning logged about failed dates.

## item #25 [bug] [medium]
Missing error handling in token-usage-batch flush at src/services/token-usage-batch.ts:45-101. If appendRowsWithFormatting fails, entries preserved for retry but could cause duplicates.

## item #26 [edge-case] [medium]
Unvalidated timeZone fallback in token-usage-logger at src/services/token-usage-logger.ts:86-163. If getSpreadsheetTimezone fails, timeZone is undefined. Causes incorrect serialization.

## item #27 [edge-case] [medium]
Missing validation in getOrCreateMonthSheet at src/services/sheets.ts:1365-1431. If headers.length > 26, column letter calculation invalid (beyond Z). Also batch deferred reordering returns success without confirming.

## item #28 [edge-case] [medium]
Potential false positive in keyword extraction at src/bank/matcher.ts:94-98. Filter tokens by length >= 3 but legitimate 3-letter company abbreviations like "SKF", "IBM" might match incorrectly.

## item #29 [edge-case] [medium]
Unsafe document type casting in DisplacementQueue at src/matching/cascade-matcher.ts:38-39. Casts (item.document as { fileId: string }).fileId without type guard.

## item #30 [edge-case] [medium]
computeVersion doesn't handle undefined values safely at src/utils/concurrency.ts:310-319. JSON.stringify on BigInt, Symbols, or circular references throws. No try-catch.

## item #31 [edge-case] [medium]
createDriveHyperlink doesn't validate fileId format at src/utils/spreadsheet.ts:57-63. If fileId contains special URL characters or is empty, constructed URL broken.

## item #32 [async] [medium]
Unbounded memory growth in TokenUsageBatch at src/services/token-usage-batch.ts:36-38. The batch accumulates entries indefinitely until flush() is called. No maximum batch size limit enforced. Under high-volume scenarios, memory bloat.

## item #33 [async] [medium]
Repeated timezone failures in token-usage-batch at src/services/token-usage-batch.ts:51-54. If timezone retrieval fails on first call, this.timezone is undefined. On subsequent flushes check is true again, causing repeated failed API calls.

## item #34 [validation] [medium]
Invalid bank name not validated at src/bank/autofill.ts:224-226. If bankName is provided but doesn't exist in bankSpreadsheets, returns undefined. Route handler doesn't validate that bank exists before calling autofill.

## item #35 [security] [medium]
Unsafe non-null assertion for config.apiSecret at src/middleware/auth.ts:97. In non-production environments, missing API_SECRET allows unauthenticated access with empty token if API_SECRET is empty string.

## item #36 [edge-case] [low]
Potential memory leak from unbounded cascadeState.updates Map at src/processing/matching/factura-pago-matcher.ts:395-401. Map grows with facturas count. No per-iteration memory check.

## item #37 [edge-case] [low]
Unchecked Map lookups in factura-pago-matcher updates at src/processing/matching/factura-pago-matcher.ts:564-572. If pagosMap.get() returns undefined, update silently skipped.

## item #38 [dead-code] [low]
AMOUNT_TOLERANCE constant not used at src/utils/currency.ts:8. Constant exported but only used in tests.

## item #39 [practice] [low]
DocumentType includes both 'unrecognized' and 'unknown' at src/types/index.ts:54-55. Semantic confusion; unclear which should be used in different contexts.

## item #40 [practice] [low]
parseAmount doesn't document negative value behavior at src/utils/numbers.ts:122-125. Always returns positive via Math.abs but JSDoc doesn't state this.

## item #41 [edge-case] [low]
Exchange rate cache TTL not validated on fetch at src/utils/exchange-rate.ts:121-178. No validation that fetched rate's fecha field is valid or matches request date.

## item #42 [practice] [low]
Drive service not cleared in tests at src/services/drive.ts:14. Unlike sheets.ts which exports clearSheetsCache(), drive.ts has no clearDriveCache(). Tests may use stale instances.

## item #43 [practice] [low]
No Status Code Set Before Some Error Returns at src/routes/scan.ts:62-68. Pattern calls reply.status(400) but doesn't call reply.send(), relies on implicit serialization.

## item #44 [edge-case] [low]
Hard-coded MIN_KEYWORD_MATCH_SCORE at src/bank/matcher.ts:152,462. MIN_KEYWORD_MATCH_SCORE = 2 without contextual validation. No adaptive scoring based on token frequency.

## item #45 [edge-case] [low]
Missing HTTP error response size limit at src/gemini/client.ts:226. response.text() buffers entire response. Large error responses waste memory.

## item #46 [edge-case] [low]
Potential match quality calculation inconsistency at src/bank/match-movimientos.ts:689-700. isExactAmount set to true for both existing and candidate, masks amount mismatches - could cause worse matches to be selected.

## item #47 [edge-case] [low]
Empty error message on parse failure at src/bank/autofill.ts:24. When required columns missing, function silently returns null without logging which row or column failed.

## item #48 [edge-case] [low]
Timezone cache not invalidated on spreadsheet updates at src/services/sheets.ts:32-59. If spreadsheet timezone changed by admin, cache won't update for up to 24 hours.

## item #49 [edge-case] [low]
Missing column validation in sheet parsing at factura-pago-matcher.ts lines 304-336. Assumes column indices directly without validating row has minimum required columns. Missing columns default to safe values but masks data issues.

## item #50 [edge-case] [low]
Scan state corruption window in scanner.ts lines 366-383. If an unhandled promise rejection occurs after setting scanState to pending but before proper lock context, state could block subsequent scans.
