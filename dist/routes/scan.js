/**
 * Scan and processing routes
 */
import { scanFolder, rematch } from '../processing/scanner.js';
import { autoFillBankMovements } from '../bank/autofill.js';
/**
 * Register scan routes
 */
export async function scanRoutes(server) {
    /**
     * POST /api/scan - Trigger a manual scan of the Drive folder
     */
    server.post('/scan', async (request, reply) => {
        const { folderId } = request.body || {};
        server.log.info({ folderId }, 'Starting manual scan');
        const result = await scanFolder(folderId);
        if (!result.ok) {
            reply.status(500);
            return {
                error: result.error.message,
            };
        }
        return result.value;
    });
    /**
     * POST /api/rematch - Re-run matching on unmatched documents
     */
    server.post('/rematch', async (request, reply) => {
        const { documentType = 'all' } = request.body || {};
        server.log.info({ documentType }, 'Starting rematch');
        const result = await rematch();
        if (!result.ok) {
            reply.status(500);
            return {
                error: result.error.message,
            };
        }
        return result.value;
    });
    /**
     * POST /api/autofill-bank - Auto-fill bank movement descriptions
     */
    server.post('/autofill-bank', async (request, reply) => {
        const { bankName } = request.body || {};
        server.log.info({ bankName }, 'Starting bank autofill');
        const result = await autoFillBankMovements(bankName);
        if (!result.ok) {
            reply.status(500);
            return {
                error: result.error.message,
            };
        }
        return result.value;
    });
}
