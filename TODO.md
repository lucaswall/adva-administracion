# TODO

## item #1 [investigation] [low]
Manually audit Duplicados folder contents to verify duplicate detection accuracy. System uses content-based duplicate detection comparing business keys (nroFactura + fecha + importe + CUIT for facturas) without file hashing. Currently 5 files in Duplicados folder. Audit steps: (1) Sample 5-10 files, (2) Cross-reference logs to find existingFileId, (3) Compare metadata in spreadsheet rows, (4) Check edge cases: empty CUIT fields, amounts differing by <0.01 rounding tolerance, resumenes with overlapping dates, manually edited spreadsheet rows. Files involved: `src/processing/caches/duplicate-cache.ts`, `src/processing/storage/factura-store.ts`, `src/processing/storage/resumen-store.ts`, `src/services/document-sorter.ts`.
