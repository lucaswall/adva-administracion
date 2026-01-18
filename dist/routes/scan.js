/**
 * Scan and processing routes
 */
/**
 * Register scan routes
 */
export async function scanRoutes(server) {
    /**
     * POST /api/scan - Trigger a manual scan of the Drive folder
     */
    server.post('/scan', async (request, _reply) => {
        const { folderId, force } = request.body || {};
        server.log.info({ folderId, force }, 'Starting manual scan');
        // TODO: Implement actual scanning logic
        // This will be implemented in Phase 2
        return {
            filesProcessed: 0,
            facturasAdded: 0,
            pagosAdded: 0,
            recibosAdded: 0,
            matchesFound: 0,
            errors: 0,
            duration: 0
        };
    });
    /**
     * POST /api/rematch - Re-run matching on unmatched documents
     */
    server.post('/rematch', async (request, _reply) => {
        const { documentType = 'all' } = request.body || {};
        server.log.info({ documentType }, 'Starting rematch');
        // TODO: Implement rematch logic
        // This will be implemented in Phase 2
        return {
            matchesFound: 0,
            duration: 0
        };
    });
    /**
     * POST /api/autofill-bank - Auto-fill bank movement descriptions
     */
    server.post('/autofill-bank', async (_request, _reply) => {
        server.log.info('Starting bank autofill');
        // TODO: Implement bank autofill logic
        // This will be implemented in Phase 2
        return {
            rowsProcessed: 0,
            rowsFilled: 0,
            duration: 0
        };
    });
}
