


# Improvement #1

When parsing the Resumenes to get the Movimientos movimientos should be all included in the month the Resumen belongs to.

The month the Resumen belongs to is given by the fechaHasta field. Sometimes there can be movimientos with fecha from the end of the
previous month. This is ok, the fecha should be preserved, but the transaction should appear in the page of the month the Resumen belong
to.

For example

Resumen dates:

| fechaDesde | fechaHasta |
| ---------- | ---------- |
| 2024-12-30 | 2025-01-31 |

Transaction:

| fecha | origenConcepto | debito | credito | saldo |
| ----- | -------------- | ------ | ------- | ----- |
| 2024-12-30 | IMP.LEY 25413 30/12/24 00002 | 71.34 | 6,357,095.40 |

This transaction, contained as the first of a Resumen for 2025-01, should go in the page 2025-01.



