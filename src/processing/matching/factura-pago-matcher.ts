/**
 * Factura-Pago matching with cascading displacement
 * Handles matching between facturas and pagos with upgrade detection
 */

import type { Result, Factura, Pago, MatchConfidence } from '../../types/index.js';
import { getConfig, MAX_CASCADE_DEPTH, CASCADE_TIMEOUT_MS } from '../../config.js';
import { getValues, batchUpdate } from '../../services/sheets.js';
import { FacturaPagoMatcher, type MatchQuality } from '../../matching/matcher.js';
import {
  DisplacementQueue,
  type CascadeState,
  type CascadeClaims,
  isBetterMatch,
  detectCycle,
  buildFacturaMatchUpdate,
  buildUnmatchUpdate,
} from '../../matching/cascade-matcher.js';
import { parseNumber } from '../../utils/numbers.js';
import { normalizeSpreadsheetDate } from '../../utils/date.js';
import { debug, info, warn } from '../../utils/logger.js';
import { getCorrelationId } from '../../utils/correlation.js';
import { withLock, withRetry } from '../../utils/concurrency.js';

/**
 * Processes cascading displacements for factura-pago matches
 * Handles the chain of re-matching when better matches displace existing ones
 *
 * @param queue - Queue of displaced pagos to re-match
 * @param cascadeState - State tracking for the cascade operation
 * @param facturas - All available facturas (including matched ones)
 * @param pagosMap - Map of pago fileId to pago object (for finding displaced pagos)
 * @param matcher - Matcher instance to use
 * @param claims - Tracks which documents have been claimed
 * @returns Result with void on success or error
 */
async function processCascadingFacturaDisplacements(
  queue: DisplacementQueue,
  cascadeState: CascadeState,
  facturas: Array<Factura & { row: number }>,
  pagosMap: Map<string, Pago & { row: number }>,
  matcher: FacturaPagoMatcher,
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
        phase: 'cascade',
        depth: displaced.depth,
        pagoId: displacedPago.fileId,
        correlationId,
      });
      break;
    }

    if (Date.now() - cascadeState.startTime > CASCADE_TIMEOUT_MS) {
      warn('Cascade timeout exceeded', {
        module: 'matching',
        phase: 'cascade',
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
        phase: 'cascade',
        pagoId: displacedPago.fileId,
        chain: Array.from(visited),
        correlationId,
      });
      break;
    }

    visited.add(displacedPago.fileId);

    // Find best remaining match (exclude already claimed facturas)
    const availableFacturas = facturas.filter(f => !claims.claimedFacturas.has(f.fileId));
    const matches = matcher.findMatches(displacedPago, availableFacturas, true, pagosMap);

    if (matches.length > 0) {
      const bestMatch = matches[0];

      if (bestMatch.isUpgrade && bestMatch.existingPagoFileId) {
        // This match would displace another pago - check if it's strictly better
        const existingQuality: MatchQuality = {
          confidence: bestMatch.existingMatchConfidence || 'LOW',
          hasCuitMatch: bestMatch.factura.hasCuitMatch || false,
          dateProximityDays: bestMatch.existingDateProximityDays ?? 999
        };
        const newQuality: MatchQuality = {
          confidence: bestMatch.confidence,
          hasCuitMatch: bestMatch.hasCuitMatch || false,
          dateProximityDays: bestMatch.dateProximityDays || 999
        };

        if (isBetterMatch(newQuality, existingQuality)) {
          // Cascade displacement - add the currently matched pago to queue
          const displacedPagoId = bestMatch.existingPagoFileId;
          const nextDisplacedPago = pagosMap.get(displacedPagoId);

          if (nextDisplacedPago) {
            debug('Cascading displacement', {
              module: 'matching',
              phase: 'cascade',
              fromPago: displacedPagoId,
              toPago: displacedPago.fileId,
              factura: bestMatch.facturaFileId,
              depth: displaced.depth + 1,
              correlationId,
            });

            queue.add({
              documentType: 'pago',
              document: nextDisplacedPago,
              row: nextDisplacedPago.row,
              previousMatchFileId: bestMatch.facturaFileId,
              depth: displaced.depth + 1
            });
          }

          // Claim the factura and create update
          claims.claimedFacturas.add(bestMatch.facturaFileId);
          cascadeState.updates.set(
            bestMatch.facturaFileId,
            buildFacturaMatchUpdate(
              bestMatch.facturaFileId,
              bestMatch.facturaRow,
              displacedPago.fileId,
              bestMatch.confidence,
              bestMatch.hasCuitMatch || false
            )
          );
          cascadeState.displacedCount++;
        }
      } else {
        // Found an unmatched factura
        claims.claimedFacturas.add(bestMatch.facturaFileId);
        cascadeState.updates.set(
          bestMatch.facturaFileId,
          buildFacturaMatchUpdate(
            bestMatch.facturaFileId,
            bestMatch.facturaRow,
            displacedPago.fileId,
            bestMatch.confidence,
            bestMatch.hasCuitMatch || false
          )
        );

        debug('Displaced pago re-matched', {
          module: 'matching',
          phase: 'cascade',
          pagoId: displacedPago.fileId,
          facturaId: bestMatch.facturaFileId,
          confidence: bestMatch.confidence,
          correlationId,
        });
      }
    } else {
      // No match found - pago becomes unmatched
      // If this pago was previously matched to a factura that wasn't claimed, unmatch it
      if (displaced.previousMatchFileId && !claims.claimedFacturas.has(displaced.previousMatchFileId)) {
        const previousFactura = facturas.find(f => f.fileId === displaced.previousMatchFileId);
        if (previousFactura) {
          cascadeState.updates.set(
            displaced.previousMatchFileId,
            buildUnmatchUpdate(
              displaced.previousMatchFileId,
              previousFactura.row,
              'factura'
            )
          );

          debug('Unmatched factura due to displaced pago with no new match', {
            module: 'matching',
            phase: 'cascade',
            pagoId: displacedPago.fileId,
            facturaId: displaced.previousMatchFileId,
            correlationId,
          });
        }
      }

      debug('Displaced pago has no remaining matches', {
        module: 'matching',
        phase: 'cascade',
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
 * Matches facturas with pagos in a single spreadsheet
 *
 * @param spreadsheetId - Spreadsheet ID (Control de Ingresos or Control de Egresos)
 * @param facturasSheetName - Facturas sheet name ('Facturas Emitidas' or 'Facturas Recibidas')
 * @param pagosSheetName - Pagos sheet name ('Pagos Recibidos' or 'Pagos Enviados')
 * @param facturaCuitField - CUIT field name in factura to match (e.g., 'cuitReceptor' or 'cuitEmisor')
 * @param pagoCuitField - CUIT field name in pago to match (e.g., 'cuitPagador' or 'cuitBeneficiario')
 * @param config - Configuration with matching parameters
 * @returns Number of matches found
 */
export async function matchFacturasWithPagos(
  spreadsheetId: string,
  facturasSheetName: 'Facturas Emitidas' | 'Facturas Recibidas',
  pagosSheetName: 'Pagos Recibidos' | 'Pagos Enviados',
  facturaCuitField: 'cuitReceptor' | 'cuitEmisor',
  pagoCuitField: 'cuitPagador' | 'cuitBeneficiario',
  config: ReturnType<typeof getConfig>
): Promise<Result<number, Error>> {
  const correlationId = getCorrelationId();

  debug('Starting factura-pago matching', {
    module: 'matching',
    phase: 'factura-pago',
    spreadsheetId,
    facturasSheet: facturasSheetName,
    pagosSheet: pagosSheetName,
    correlationId,
  });

  // Use lock to prevent concurrent matching on the same spreadsheet
  const lockKey = `match:${spreadsheetId}:${facturasSheetName}:${pagosSheetName}`;

  return withLock(lockKey, async () => {
    // Use retry for resilience against transient failures
    const result = await withRetry(async () => {
      return await doMatchFacturasWithPagos(
        spreadsheetId,
        facturasSheetName,
        pagosSheetName,
        facturaCuitField,
        pagoCuitField,
        config
      );
    }, { maxRetries: 2 });

    if (!result.ok) {
      throw result.error;
    }

    return result.value;
  });
}

/**
 * Internal implementation of factura-pago matching
 */
async function doMatchFacturasWithPagos(
  spreadsheetId: string,
  facturasSheetName: 'Facturas Emitidas' | 'Facturas Recibidas',
  pagosSheetName: 'Pagos Recibidos' | 'Pagos Enviados',
  facturaCuitField: 'cuitReceptor' | 'cuitEmisor',
  pagoCuitField: 'cuitPagador' | 'cuitBeneficiario',
  config: ReturnType<typeof getConfig>
): Promise<number> {
  const correlationId = getCorrelationId();

  // Determine correct column ranges based on sheet type
  // Facturas Recibidas has pagada column (A:S), Facturas Emitidas doesn't (A:R)
  const facturasRange = facturasSheetName === 'Facturas Recibidas'
    ? `${facturasSheetName}!A:S`
    : `${facturasSheetName}!A:R`;
  const pagosRange = `${pagosSheetName}!A:O`; // Both pago sheets use A:O

  // Get all facturas
  const facturasResult = await getValues(spreadsheetId, facturasRange);
  if (!facturasResult.ok) {
    throw facturasResult.error;
  }

  // Get all pagos
  const pagosResult = await getValues(spreadsheetId, pagosRange);
  if (!pagosResult.ok) {
    throw pagosResult.error;
  }

  // Parse data (skip header row)
  const facturas: Array<Factura & { row: number }> = [];
  const pagos: Array<Pago & { row: number }> = [];

  if (facturasResult.value.length > 1) {
    for (let i = 1; i < facturasResult.value.length; i++) {
      const row = facturasResult.value[i];
      if (!row || !row[0]) continue;

      // Build factura object based on sheet type
      const factura: Factura & { row: number } = {
        row: i + 1, // Sheet rows are 1-indexed
        fechaEmision: normalizeSpreadsheetDate(row[0]),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        tipoComprobante: (row[3] || 'A') as Factura['tipoComprobante'],
        nroFactura: String(row[4] || ''),
        // Column 5 (F) and 6 (G) contain either emisor or receptor info depending on sheet
        cuitEmisor: facturaCuitField === 'cuitEmisor' ? String(row[5] || '') : '',
        razonSocialEmisor: facturaCuitField === 'cuitEmisor' ? String(row[6] || '') : '',
        cuitReceptor: facturaCuitField === 'cuitReceptor' ? String(row[5] || '') : undefined,
        razonSocialReceptor: facturaCuitField === 'cuitReceptor' ? String(row[6] || '') : undefined,
        importeNeto: parseNumber(row[7]) || 0,
        importeIva: parseNumber(row[8]) || 0,
        importeTotal: parseNumber(row[9]) || 0,
        moneda: (row[10] || 'ARS') as Factura['moneda'],
        concepto: row[11] ? String(row[11]) : undefined,
        processedAt: String(row[12] || ''),
        confidence: Number(row[13]) || 0,
        needsReview: row[14] === 'YES',
        matchedPagoFileId: row[15] ? String(row[15]) : undefined,
        matchConfidence: row[16] ? (String(row[16]) as MatchConfidence) : undefined,
        hasCuitMatch: row[17] === 'YES',
      };

      facturas.push(factura);
    }
  }

  if (pagosResult.value.length > 1) {
    for (let i = 1; i < pagosResult.value.length; i++) {
      const row = pagosResult.value[i];
      if (!row || !row[0]) continue;

      // Build pago object based on sheet type
      // Column 7 (H) and 8 (I) contain either pagador or beneficiario info depending on sheet
      const pago: Pago & { row: number } = {
        row: i + 1,
        fechaPago: normalizeSpreadsheetDate(row[0]),
        fileId: String(row[1] || ''),
        fileName: String(row[2] || ''),
        banco: String(row[3] || ''),
        importePagado: parseNumber(row[4]) || 0,
        moneda: (String(row[5]) as 'ARS' | 'USD') || 'ARS',
        referencia: row[6] ? String(row[6]) : undefined,
        cuitPagador: pagoCuitField === 'cuitPagador' ? String(row[7] || '') : undefined,
        nombrePagador: pagoCuitField === 'cuitPagador' ? String(row[8] || '') : undefined,
        cuitBeneficiario: pagoCuitField === 'cuitBeneficiario' ? String(row[7] || '') : undefined,
        nombreBeneficiario: pagoCuitField === 'cuitBeneficiario' ? String(row[8] || '') : undefined,
        concepto: row[9] ? String(row[9]) : undefined,
        processedAt: String(row[10] || ''),
        confidence: Number(row[11]) || 0,
        needsReview: row[12] === 'YES',
        matchedFacturaFileId: row[13] ? String(row[13]) : undefined,
        matchConfidence: row[14] ? (String(row[14]) as MatchConfidence) : undefined,
      };

      pagos.push(pago);
    }
  }

  // Find unmatched documents
  const unmatchedPagos = pagos.filter(p => !p.matchedFacturaFileId);

  debug('Found unmatched documents', {
    module: 'matching',
    phase: 'factura-pago',
    totalFacturas: facturas.length,
    unmatchedPagos: unmatchedPagos.length,
    correlationId,
  });

  if (unmatchedPagos.length === 0) {
    return 0;
  }

  // Run matching with cascading displacement
  const matcher = new FacturaPagoMatcher(
    config.matchDaysBefore,
    config.matchDaysAfter,
    config.usdArsTolerancePercent
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

  info('Starting cascading match displacement', {
    module: 'matching',
    phase: 'cascade',
    unmatchedPagos: unmatchedPagos.length,
    correlationId,
  });

  // Process unmatched pagos - try to match against ALL facturas (including matched ones)
  for (const pago of unmatchedPagos) {
    const matches = matcher.findMatches(pago, facturas, true, pagosMap); // includeMatched=true

    if (matches.length > 0) {
      const bestMatch = matches[0];

      // Only accept high-confidence unique matches
      if (bestMatch.confidence === 'HIGH' || matches.length === 1) {
        // Check if this is an upgrade (factura already matched)
        if (bestMatch.isUpgrade && bestMatch.existingPagoFileId) {
          const existingQuality: MatchQuality = {
            confidence: bestMatch.existingMatchConfidence || 'LOW',
            hasCuitMatch: bestMatch.factura.hasCuitMatch || false,
            dateProximityDays: bestMatch.existingDateProximityDays ?? 999
          };
          const newQuality: MatchQuality = {
            confidence: bestMatch.confidence,
            hasCuitMatch: bestMatch.hasCuitMatch || false,
            dateProximityDays: bestMatch.dateProximityDays || 999
          };

          if (isBetterMatch(newQuality, existingQuality)) {
            // Displace! Queue the old pago for re-matching
            const displacedPago = pagosMap.get(bestMatch.existingPagoFileId);
            if (displacedPago) {
              debug('Match displaced', {
                module: 'matching',
                phase: 'cascade',
                fromPago: bestMatch.existingPagoFileId,
                toPago: pago.fileId,
                factura: bestMatch.facturaFileId,
                reason: `${existingQuality.confidence} -> ${newQuality.confidence}`,
                correlationId,
              });

              displacementQueue.add({
                documentType: 'pago',
                document: displacedPago,
                row: displacedPago.row,
                previousMatchFileId: bestMatch.facturaFileId,
                depth: 1
              });

              claims.claimedFacturas.add(bestMatch.facturaFileId);
              cascadeState.updates.set(
                bestMatch.facturaFileId,
                buildFacturaMatchUpdate(
                  bestMatch.facturaFileId,
                  bestMatch.facturaRow,
                  pago.fileId,
                  bestMatch.confidence,
                  bestMatch.hasCuitMatch || false
                )
              );
              cascadeState.displacedCount++;
            }
          }
        } else {
          // New match, not displacing
          claims.claimedFacturas.add(bestMatch.facturaFileId);
          cascadeState.updates.set(
            bestMatch.facturaFileId,
            buildFacturaMatchUpdate(
              bestMatch.facturaFileId,
              bestMatch.facturaRow,
              pago.fileId,
              bestMatch.confidence,
              bestMatch.hasCuitMatch || false
            )
          );

          debug('Match found', {
            module: 'matching',
            phase: 'factura-pago',
            pagoId: pago.fileId,
            facturaId: bestMatch.facturaFileId,
            confidence: bestMatch.confidence,
            hasCuitMatch: bestMatch.hasCuitMatch,
            correlationId,
          });
        }
      }
    }
  }

  // Process cascading displacements
  const cascadeResult = await processCascadingFacturaDisplacements(
    displacementQueue,
    cascadeState,
    facturas,
    pagosMap,
    matcher,
    claims
  );

  if (!cascadeResult.ok) {
    throw cascadeResult.error;
  }

  info('Cascade complete', {
    module: 'matching',
    phase: 'cascade',
    displacedCount: cascadeState.displacedCount,
    maxDepth: cascadeState.maxDepthReached,
    cycleDetected: cascadeState.cycleDetected,
    duration: Date.now() - cascadeState.startTime,
    correlationId,
  });

  // Build sheet updates from cascade state
  const updates: Array<{ range: string; values: (string | number)[][] }> = [];
  let matchesFound = 0;

  for (const [facturaFileId, update] of cascadeState.updates) {
    if (update.facturaFileId && update.facturaRow && update.pagoFileId) {
      matchesFound++;

      // Update factura with match info
      // For Facturas Recibidas: columns P:S (includes pagada)
      // For Facturas Emitidas: columns P:R (no pagada)
      if (facturasSheetName === 'Facturas Recibidas') {
        updates.push({
          range: `'${facturasSheetName}'!P${update.facturaRow}:S${update.facturaRow}`,
          values: [[
            update.pagoFileId,
            update.confidence,
            update.hasCuitMatch ? 'YES' : 'NO',
            update.pagada !== undefined ? (update.pagada ? 'SI' : 'NO') : '',
          ]],
        });
      } else {
        updates.push({
          range: `'${facturasSheetName}'!P${update.facturaRow}:R${update.facturaRow}`,
          values: [[
            update.pagoFileId,
            update.confidence,
            update.hasCuitMatch ? 'YES' : 'NO',
          ]],
        });
      }

      // Update pago with match info (columns N:O)
      const pago = pagosMap.get(update.pagoFileId);
      if (pago) {
        updates.push({
          range: `'${pagosSheetName}'!N${pago.row}:O${pago.row}`,
          values: [[
            facturaFileId,
            update.confidence,
          ]],
        });
      }
    }
  }

  // Apply updates
  if (updates.length > 0) {
    info('Applying match updates', {
      module: 'matching',
      phase: 'factura-pago',
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
