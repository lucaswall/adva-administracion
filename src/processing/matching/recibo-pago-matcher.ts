/**
 * Recibo-Pago matching with cascading displacement
 * Handles matching between recibos and pagos with upgrade detection
 */

import type { Result, Pago, Recibo, MatchConfidence } from '../../types/index.js';
import { getConfig, MAX_CASCADE_DEPTH, CASCADE_TIMEOUT_MS } from '../../config.js';
import { getValues, batchUpdate } from '../../services/sheets.js';
import { ReciboPagoMatcher, type MatchQuality } from '../../matching/matcher.js';
import {
  DisplacementQueue,
  type CascadeState,
  type CascadeClaims,
  isBetterMatch,
  detectCycle,
  buildReciboMatchUpdate,
} from '../../matching/cascade-matcher.js';
import { parseNumber } from '../../utils/numbers.js';
import { debug, info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';
import { withLock, withRetry } from '../../utils/concurrency.js';

/**
 * Processes cascading displacements for recibo-pago matches
 * Handles the chain of re-matching when better matches displace existing ones
 *
 * @param queue - Queue of displaced pagos to re-match
 * @param cascadeState - State tracking for the cascade operation
 * @param recibos - All available recibos (including matched ones)
 * @param pagosMap - Map of pago fileId to pago object (for finding displaced pagos)
 * @param matcher - Matcher instance to use
 * @param claims - Tracks which documents have been claimed
 * @returns Result with void on success or error
 */
async function processCascadingReciboDisplacements(
  queue: DisplacementQueue,
  cascadeState: CascadeState,
  recibos: Array<Recibo & { row: number }>,
  pagosMap: Map<string, Pago & { row: number }>,
  matcher: ReciboPagoMatcher,
  claims: CascadeClaims
): Promise<Result<void, Error>> {
  const visited = new Set<string>();
  let iteration = 0;
  const correlationId = getCorrelationId();

  while (!queue.isEmpty() && iteration < MAX_CASCADE_DEPTH) {
    const displaced = queue.pop();
    if (!displaced) break;

    const displacedPago = displaced.document as Pago;

    // Check termination conditions
    if (displaced.depth >= MAX_CASCADE_DEPTH) {
      warn('Max cascade depth reached', {
        module: 'matching',
        phase: 'cascade-recibo',
        depth: displaced.depth,
        pagoId: displacedPago.fileId,
        correlationId,
      });
      break;
    }

    if (Date.now() - cascadeState.startTime > CASCADE_TIMEOUT_MS) {
      warn('Cascade timeout exceeded', {
        module: 'matching',
        phase: 'cascade-recibo',
        elapsed: Date.now() - cascadeState.startTime,
        pagoId: displacedPago.fileId,
        correlationId,
      });
      break;
    }

    if (detectCycle(visited, displacedPago.fileId)) {
      cascadeState.cycleDetected = true;
      warn('Cycle detected in displacement chain', {
        module: 'matching',
        phase: 'cascade-recibo',
        pagoId: displacedPago.fileId,
        chain: Array.from(visited),
        correlationId,
      });
      break;
    }

    visited.add(displacedPago.fileId);

    // Find best remaining match (exclude already claimed recibos)
    const availableRecibos = recibos.filter(r => !claims.claimedRecibos.has(r.fileId));
    const matches = matcher.findMatches(displacedPago, availableRecibos, true, pagosMap);

    if (matches.length > 0) {
      const bestMatch = matches[0];

      if (bestMatch.isUpgrade && bestMatch.existingPagoFileId) {
        // This match would displace another pago - check if it's strictly better
        // hasCuitMatch for existing match: HIGH confidence implies CUIT match was present
        const existingQuality: MatchQuality = {
          confidence: bestMatch.existingMatchConfidence || 'LOW',
          hasCuitMatch: bestMatch.existingMatchConfidence === 'HIGH',
          dateProximityDays: bestMatch.existingDateProximityDays ?? 999
        };
        const newQuality: MatchQuality = {
          confidence: bestMatch.confidence,
          hasCuitMatch: bestMatch.hasCuilMatch || false,
          dateProximityDays: bestMatch.dateProximityDays || 999
        };

        if (isBetterMatch(newQuality, existingQuality)) {
          // Cascade displacement - add the currently matched pago to queue
          const displacedPagoId = bestMatch.existingPagoFileId;
          const nextDisplacedPago = pagosMap.get(displacedPagoId);

          if (nextDisplacedPago) {
            debug('Cascading displacement (recibo)', {
              module: 'matching',
              phase: 'cascade-recibo',
              fromPago: displacedPagoId,
              toPago: displacedPago.fileId,
              recibo: bestMatch.reciboFileId,
              depth: displaced.depth + 1,
              correlationId,
            });

            queue.add({
              documentType: 'pago',
              document: nextDisplacedPago,
              row: nextDisplacedPago.row,
              previousMatchFileId: bestMatch.reciboFileId,
              depth: displaced.depth + 1
            });
          }

          // Claim the recibo and create update
          claims.claimedRecibos.add(bestMatch.reciboFileId);
          cascadeState.updates.set(
            bestMatch.reciboFileId,
            buildReciboMatchUpdate(
              bestMatch.reciboFileId,
              bestMatch.reciboRow,
              displacedPago.fileId,
              bestMatch.confidence,
              bestMatch.hasCuilMatch || false
            )
          );
          cascadeState.displacedCount++;
        }
      } else {
        // Found an unmatched recibo
        claims.claimedRecibos.add(bestMatch.reciboFileId);
        cascadeState.updates.set(
          bestMatch.reciboFileId,
          buildReciboMatchUpdate(
            bestMatch.reciboFileId,
            bestMatch.reciboRow,
            displacedPago.fileId,
            bestMatch.confidence,
            bestMatch.hasCuilMatch || false
          )
        );

        debug('Displaced pago re-matched (recibo)', {
          module: 'matching',
          phase: 'cascade-recibo',
          pagoId: displacedPago.fileId,
          reciboId: bestMatch.reciboFileId,
          confidence: bestMatch.confidence,
          correlationId,
        });
      }
    } else {
      // No match found - pago becomes unmatched
      debug('Displaced pago has no remaining recibo matches', {
        module: 'matching',
        phase: 'cascade-recibo',
        pagoId: displacedPago.fileId,
        correlationId,
      });
    }

    iteration++;
    cascadeState.maxDepthReached = Math.max(cascadeState.maxDepthReached, displaced.depth);
  }

  return { ok: true, value: undefined };
}

/**
 * Matches recibos with pagos enviados in Control de Egresos
 *
 * @param spreadsheetId - Control de Egresos spreadsheet ID
 * @param config - Configuration with matching parameters
 * @returns Number of matches found
 */
export async function matchRecibosWithPagos(
  spreadsheetId: string,
  config: ReturnType<typeof getConfig>
): Promise<Result<number, Error>> {
  const correlationId = getCorrelationId();

  debug('Starting recibo-pago matching', {
    module: 'matching',
    phase: 'recibo-pago',
    spreadsheetId,
    correlationId,
  });

  // Use lock to prevent concurrent matching on the same spreadsheet
  const lockKey = `match:${spreadsheetId}:Recibos:Pagos Enviados`;

  return withLock(lockKey, async () => {
    // Use retry for resilience against transient failures
    const result = await withRetry(async () => {
      return await doMatchRecibosWithPagos(spreadsheetId, config);
    }, { maxRetries: 2 });

    if (!result.ok) {
      throw result.error;
    }

    return result.value;
  });
}

/**
 * Internal implementation of recibo-pago matching
 */
async function doMatchRecibosWithPagos(
  spreadsheetId: string,
  config: ReturnType<typeof getConfig>
): Promise<number> {
  const correlationId = getCorrelationId();

  // Get all recibos
  const recibosResult = await getValues(spreadsheetId, 'Recibos!A:R');
  if (!recibosResult.ok) {
    throw recibosResult.error;
  }

  // Get all pagos enviados
  const pagosResult = await getValues(spreadsheetId, 'Pagos Enviados!A:O');
  if (!pagosResult.ok) {
    throw pagosResult.error;
  }

  // Parse data (skip header row)
  const recibos: Array<Recibo & { row: number }> = [];
  const pagos: Array<Pago & { row: number }> = [];

  if (recibosResult.value.length > 1) {
    for (let i = 1; i < recibosResult.value.length; i++) {
      const row = recibosResult.value[i];
      if (!row || !row[0]) continue;

      recibos.push({
        row: i + 1,
        fechaPago: String(row[0] || ''),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        tipoRecibo: (row[3] || 'sueldo') as Recibo['tipoRecibo'],
        nombreEmpleado: String(row[4] || ''),
        cuilEmpleado: String(row[5] || ''),
        legajo: String(row[6] || ''),
        tareaDesempenada: row[7] ? String(row[7]) : undefined,
        cuitEmpleador: String(row[8] || ''),
        periodoAbonado: String(row[9] || ''),
        subtotalRemuneraciones: parseNumber(row[10]) || 0,
        subtotalDescuentos: parseNumber(row[11]) || 0,
        totalNeto: parseNumber(row[12]) || 0,
        processedAt: String(row[13] || ''),
        confidence: Number(row[14]) || 0,
        needsReview: row[15] === 'YES',
        matchedPagoFileId: row[16] ? String(row[16]) : undefined,
        matchConfidence: row[17] ? (String(row[17]) as MatchConfidence) : undefined,
      });
    }
  }

  if (pagosResult.value.length > 1) {
    for (let i = 1; i < pagosResult.value.length; i++) {
      const row = pagosResult.value[i];
      if (!row || !row[0]) continue;

      pagos.push({
        row: i + 1,
        fechaPago: String(row[0] || ''),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        banco: String(row[3] || ''),
        importePagado: parseNumber(row[4]) || 0,
        moneda: (String(row[5]) as 'ARS' | 'USD') || 'ARS',
        referencia: row[6] ? String(row[6]) : undefined,
        cuitPagador: row[7] ? String(row[7]) : undefined,
        nombrePagador: row[8] ? String(row[8]) : undefined,
        cuitBeneficiario: String(row[7] || ''), // For Pagos Enviados, beneficiary is in columns H:I
        nombreBeneficiario: String(row[8] || ''),
        concepto: row[9] ? String(row[9]) : undefined,
        processedAt: String(row[10] || ''),
        confidence: Number(row[11]) || 0,
        needsReview: row[12] === 'YES',
        matchedFacturaFileId: row[13] ? String(row[13]) : undefined,
        matchConfidence: row[14] ? (String(row[14]) as MatchConfidence) : undefined,
      });
    }
  }

  // Find unmatched documents
  const unmatchedPagos = pagos.filter(p => !p.matchedFacturaFileId); // Recibos can also match in this field

  debug('Found unmatched documents', {
    module: 'matching',
    phase: 'recibo-pago',
    totalRecibos: recibos.length,
    unmatchedPagos: unmatchedPagos.length,
    correlationId,
  });

  if (unmatchedPagos.length === 0) {
    return 0;
  }

  // Run matching with cascading displacement
  const matcher = new ReciboPagoMatcher(
    config.matchDaysBefore,
    config.matchDaysAfter
  );

  // Initialize cascade infrastructure
  const displacementQueue = new DisplacementQueue();
  const cascadeState: CascadeState = {
    updates: new Map(),
    displacedCount: 0,
    maxDepthReached: 0,
    cycleDetected: false,
    startTime: Date.now()
  };
  const claims: CascadeClaims = {
    claimedFacturas: new Set(),
    claimedPagos: new Set(),
    claimedRecibos: new Set()
  };

  // Create pago map for quick lookup during cascading
  const pagosMap = new Map<string, Pago & { row: number }>();
  for (const pago of pagos) {
    pagosMap.set(pago.fileId, pago);
  }

  info('Starting cascading match displacement (recibos)', {
    module: 'matching',
    phase: 'cascade-recibo',
    unmatchedPagos: unmatchedPagos.length,
    correlationId,
  });

  // Process unmatched pagos - try to match against ALL recibos (including matched ones)
  for (const pago of unmatchedPagos) {
    const matches = matcher.findMatches(pago, recibos, true, pagosMap); // includeMatched=true

    if (matches.length > 0) {
      const bestMatch = matches[0];

      // Only accept high-confidence unique matches
      if (bestMatch.confidence === 'HIGH' || matches.length === 1) {
        // Check if this is an upgrade (recibo already matched)
        if (bestMatch.isUpgrade && bestMatch.existingPagoFileId) {
          // hasCuitMatch for existing match: HIGH confidence implies CUIT match was present
          const existingQuality: MatchQuality = {
            confidence: bestMatch.existingMatchConfidence || 'LOW',
            hasCuitMatch: bestMatch.existingMatchConfidence === 'HIGH',
            dateProximityDays: bestMatch.existingDateProximityDays ?? 999
          };
          const newQuality: MatchQuality = {
            confidence: bestMatch.confidence,
            hasCuitMatch: bestMatch.hasCuilMatch || false,
            dateProximityDays: bestMatch.dateProximityDays || 999
          };

          if (isBetterMatch(newQuality, existingQuality)) {
            // Displace! Queue the old pago for re-matching
            const displacedPago = pagosMap.get(bestMatch.existingPagoFileId);
            if (displacedPago) {
              debug('Match displaced (recibo)', {
                module: 'matching',
                phase: 'cascade-recibo',
                fromPago: bestMatch.existingPagoFileId,
                toPago: pago.fileId,
                recibo: bestMatch.reciboFileId,
                reason: `${existingQuality.confidence} -> ${newQuality.confidence}`,
                correlationId,
              });

              displacementQueue.add({
                documentType: 'pago',
                document: displacedPago,
                row: displacedPago.row,
                previousMatchFileId: bestMatch.reciboFileId,
                depth: 1
              });

              claims.claimedRecibos.add(bestMatch.reciboFileId);
              cascadeState.updates.set(
                bestMatch.reciboFileId,
                buildReciboMatchUpdate(
                  bestMatch.reciboFileId,
                  bestMatch.reciboRow,
                  pago.fileId,
                  bestMatch.confidence,
                  bestMatch.hasCuilMatch || false
                )
              );
              cascadeState.displacedCount++;
            }
          }
        } else {
          // New match, not displacing
          claims.claimedRecibos.add(bestMatch.reciboFileId);
          cascadeState.updates.set(
            bestMatch.reciboFileId,
            buildReciboMatchUpdate(
              bestMatch.reciboFileId,
              bestMatch.reciboRow,
              pago.fileId,
              bestMatch.confidence,
              bestMatch.hasCuilMatch || false
            )
          );

          debug('Match found (recibo)', {
            module: 'matching',
            phase: 'recibo-pago',
            pagoId: pago.fileId,
            reciboId: bestMatch.reciboFileId,
            confidence: bestMatch.confidence,
            hasCuilMatch: bestMatch.hasCuilMatch,
            correlationId,
          });
        }
      }
    }
  }

  // Process cascading displacements
  const cascadeResult = await processCascadingReciboDisplacements(
    displacementQueue,
    cascadeState,
    recibos,
    pagosMap,
    matcher,
    claims
  );

  if (!cascadeResult.ok) {
    throw cascadeResult.error;
  }

  info('Cascade complete (recibos)', {
    module: 'matching',
    phase: 'cascade-recibo',
    displacedCount: cascadeState.displacedCount,
    maxDepth: cascadeState.maxDepthReached,
    cycleDetected: cascadeState.cycleDetected,
    duration: Date.now() - cascadeState.startTime,
    correlationId,
  });

  // Build sheet updates from cascade state
  const updates: Array<{ range: string; values: (string | number)[][] }> = [];
  let matchesFound = 0;

  for (const [reciboFileId, update] of cascadeState.updates) {
    if (update.reciboFileId && update.reciboRow) {
      matchesFound++;

      // Update recibo with match info (columns Q:R)
      updates.push({
        range: `'Recibos'!Q${update.reciboRow}:R${update.reciboRow}`,
        values: [[
          update.pagoFileId,
          update.confidence,
        ]],
      });

      // Update pago with match info (columns N:O)
      const pago = pagosMap.get(update.pagoFileId);
      if (pago) {
        updates.push({
          range: `'Pagos Enviados'!N${pago.row}:O${pago.row}`,
          values: [[
            reciboFileId,
            update.confidence,
          ]],
        });
      }
    }
  }

  // Apply updates
  if (updates.length > 0) {
    info('Applying recibo match updates', {
      module: 'matching',
      phase: 'recibo-pago',
      updateCount: updates.length,
      matchesFound,
      correlationId,
    });

    const updateResult = await batchUpdate(spreadsheetId, updates);
    if (!updateResult.ok) {
      throw updateResult.error;
    }
  }

  return matchesFound;
}
