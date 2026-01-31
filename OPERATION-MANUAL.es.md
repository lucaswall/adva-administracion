# Manual de Operación - ADVA Administración

Este manual describe cómo usar el sistema ADVA Administración en el día a día. Está dirigido a usuarios que trabajan con Google Drive y Google Sheets regularmente.

---

## Tabla de Contenidos

1. [Resumen del Sistema](#resumen-del-sistema)
2. [Estructura de Carpetas en Google Drive](#estructura-de-carpetas-en-google-drive)
3. [Cómo Subir Documentos](#cómo-subir-documentos)
4. [Planillas de Control](#planillas-de-control)
5. [Menú ADVA en Google Sheets](#menú-adva-en-google-sheets)
6. [Estados de los Documentos](#estados-de-los-documentos)
7. [Sistema de Matching (Vinculación)](#sistema-de-matching-vinculación)
8. [Movimientos Bancarios](#movimientos-bancarios)
9. [Documentos que Requieren Revisión](#documentos-que-requieren-revisión)
10. [Resolución de Problemas Comunes](#resolución-de-problemas-comunes)

---

## Resumen del Sistema

ADVA Administración es un sistema automatizado que:

- **Procesa documentos** PDF subidos a Google Drive (facturas, comprobantes de pago, recibos de sueldo, resúmenes bancarios)
- **Extrae información** automáticamente usando inteligencia artificial
- **Organiza archivos** en carpetas por año y mes
- **Registra datos** en planillas de Google Sheets
- **Vincula documentos** relacionados (por ejemplo, una factura con su pago correspondiente)
- **Completa detalles** de movimientos bancarios automáticamente

**El flujo básico es:**
1. Subir documento PDF a la carpeta `Entrada`
2. El sistema lo procesa automáticamente
3. El documento se mueve a su carpeta correspondiente
4. Los datos se registran en la planilla correspondiente

---

## Estructura de Carpetas en Google Drive

La estructura de carpetas en Google Drive es la siguiente:

```
📁 ADVA (carpeta raíz)
├── 📊 Control de Ingresos.gsheet
├── 📊 Control de Egresos.gsheet
├── 📊 Dashboard Operativo Contable.gsheet
├── 📁 Entrada/              ← Subir documentos aquí
├── 📁 Sin Procesar/         ← Documentos con problemas
├── 📁 Duplicado/            ← Documentos duplicados detectados
└── 📁 2025/                 ← Carpetas por año
    ├── 📁 Ingresos/
    │   ├── 📁 01 - Enero/
    │   ├── 📁 02 - Febrero/
    │   └── ... (un folder por mes)
    ├── 📁 Egresos/
    │   ├── 📁 01 - Enero/
    │   ├── 📁 02 - Febrero/
    │   └── ... (un folder por mes)
    └── 📁 Bancos/
        ├── 📁 BBVA 1234567890 ARS/      ← Cuenta bancaria
        ├── 📁 BBVA Visa 4563/           ← Tarjeta de crédito
        └── 📁 BALANZ CAPITAL 123456/    ← Cuenta broker
```

### Carpetas Especiales

| Carpeta | Descripción |
|---------|-------------|
| **Entrada** | Carpeta donde se suben los documentos para procesar |
| **Sin Procesar** | Documentos que el sistema no pudo procesar (ver [Resolución de Problemas](#resolución-de-problemas-comunes)) |
| **Duplicado** | Documentos que ya existen en el sistema |

---

## Cómo Subir Documentos

### Paso 1: Preparar el documento

- El documento debe estar en formato **PDF**
- Asegurarse de que sea legible (no borroso ni cortado)
- Un solo documento por archivo (no combinar múltiples facturas en un PDF)

### Paso 2: Subir a la carpeta Entrada

1. Abrir Google Drive
2. Navegar a la carpeta `Entrada`
3. Arrastrar el archivo PDF o usar el botón "Nuevo" → "Subir archivo"
4. Esperar a que termine la carga

### Paso 3: Esperar el procesamiento

- El sistema detecta automáticamente los nuevos archivos
- El procesamiento toma entre 10 segundos y 2 minutos por documento
- Una vez procesado, el archivo se mueve a su carpeta correspondiente

### Tipos de Documentos Soportados

| Tipo de Documento | Destino | Planilla |
|-------------------|---------|----------|
| Factura emitida por ADVA | Ingresos/{Año}/{Mes} | Control de Ingresos - Facturas Emitidas |
| Factura recibida (de proveedores) | Egresos/{Año}/{Mes} | Control de Egresos - Facturas Recibidas |
| Comprobante de pago recibido | Ingresos/{Año}/{Mes} | Control de Ingresos - Pagos Recibidos |
| Comprobante de pago enviado | Egresos/{Año}/{Mes} | Control de Egresos - Pagos Enviados |
| Certificado de retención | Ingresos/{Año}/{Mes} | Control de Ingresos - Retenciones |
| Recibo de sueldo | Egresos/{Año}/{Mes} | Control de Egresos - Recibos |
| Resumen de cuenta bancaria | Bancos/{Banco} {Cuenta} {Moneda} | Control de Resumenes |
| Resumen de tarjeta de crédito | Bancos/{Banco} {Tipo} {Últimos dígitos} | Control de Resumenes |
| Resumen de broker | Bancos/{Broker} {Comitente} | Control de Resumenes |

---

## Planillas de Control

El sistema utiliza varias planillas de Google Sheets para registrar la información.

### Control de Ingresos

Registra el dinero que **entra** a ADVA:

**Hoja "Facturas Emitidas"** - Facturas que ADVA emite a clientes
- Fecha de emisión
- Tipo de comprobante (A, B, C, etc.)
- Número de factura
- CUIT y razón social del cliente
- Importes (neto, IVA, total)
- Moneda (ARS/USD)

**Hoja "Pagos Recibidos"** - Pagos que ADVA recibe de clientes
- Fecha del pago
- Banco
- Importe pagado
- CUIT y nombre del pagador

**Hoja "Retenciones Recibidas"** - Certificados de retención cuando ADVA cobra
- Fecha de emisión
- Número de certificado
- CUIT del agente de retención
- Tipo de impuesto (IVA, Ganancias, IIBB)
- Monto retenido

### Control de Egresos

Registra el dinero que **sale** de ADVA:

**Hoja "Facturas Recibidas"** - Facturas que ADVA recibe de proveedores
- Fecha de emisión
- Tipo de comprobante
- Número de factura
- CUIT y razón social del proveedor
- Importes
- Estado de pago (SI/NO en columna "pagada")

**Hoja "Pagos Enviados"** - Pagos que ADVA realiza a proveedores
- Fecha del pago
- Banco
- Importe pagado
- CUIT y nombre del beneficiario

**Hoja "Recibos"** - Recibos de sueldo de empleados
- Fecha de pago
- Nombre y CUIL del empleado
- Legajo
- Período abonado
- Importes (remuneraciones, descuentos, neto)

### Dashboard Operativo Contable

Panel de control con información útil:

**Hoja "Pagos Pendientes"** - Facturas de proveedores sin pagar
- Lista de facturas recibidas que aún no tienen un pago vinculado
- Se actualiza automáticamente después de cada procesamiento

**Hoja "API Mensual"** - Estadísticas del sistema
- Cantidad de documentos procesados por mes
- Costos del servicio de IA

**Hoja "Uso de API"** - Detalle de cada procesamiento
- Registro técnico de cada documento procesado

### Control de Resumenes (en carpetas de Bancos)

Cada cuenta bancaria, tarjeta o broker tiene su propia planilla con:

**Hoja principal** - Resumen de cada período
- Período (YYYY-MM)
- Fechas desde/hasta
- Saldos (inicial, final)
- Link al archivo PDF

**Hojas mensuales (ej: "2025-01")** - Detalle de movimientos
- Fecha del movimiento
- Concepto
- Débitos y créditos
- Saldo
- Detalle vinculado (completado automáticamente)

---

## Menú ADVA en Google Sheets

En el Dashboard Operativo Contable, hay un menú especial llamado **"ADVA"** que permite ejecutar acciones manualmente.

### Cómo acceder al menú

1. Abrir el archivo **Dashboard Operativo Contable** en Google Sheets
2. En la barra de menú superior, buscar **"ADVA"** (a la derecha de "Ayuda")
3. Hacer clic para ver las opciones disponibles

### Opciones del menú

| Opción | Descripción | Cuándo usar |
|--------|-------------|-------------|
| **Trigger Scan** | Fuerza el procesamiento de archivos en Entrada | Cuando subiste documentos y quieres procesarlos inmediatamente |
| **Trigger Re-match** | Vuelve a buscar vínculos entre documentos | Después de corregir datos manualmente |
| **Auto-fill Bank Data** | Completa datos bancarios automáticamente | Después de procesar nuevos resúmenes |
| **Completar Detalles Movimientos** | Vincula movimientos bancarios con documentos | Después de procesar nuevos documentos |
| **About** | Muestra información del sistema y estado del servidor | Para verificar que el sistema está funcionando |

### Uso recomendado

En la mayoría de los casos, **no es necesario usar el menú** ya que el sistema procesa automáticamente. Use el menú cuando:

- Subió documentos y después de 5 minutos aún no se procesaron
- Corrigió datos manualmente y quiere actualizar vínculos
- Quiere verificar que el servidor está funcionando (opción "About")

---

## Estados de los Documentos

### En la planilla Dashboard - Archivos Procesados

| Estado | Significado |
|--------|-------------|
| `processing` | El documento se está procesando |
| `success` | El documento se procesó correctamente |
| `failed: [mensaje]` | El procesamiento falló (ver mensaje de error) |

### Indicadores en las planillas de Control

**Columna "needsReview"** (Requiere revisión)
- `TRUE` = El documento necesita verificación manual
- `FALSE` o vacío = El documento se procesó correctamente

**Columna "confidence"** (Confianza)
- Valor entre 0 y 1 (ej: 0.95 = 95% de confianza)
- Valores bajos (< 0.80) indican que la extracción puede tener errores

---

## Sistema de Matching (Vinculación)

El sistema intenta vincular automáticamente documentos relacionados:

- **Facturas con Pagos**: Una factura emitida se vincula con el pago recibido correspondiente
- **Movimientos bancarios con documentos**: Los débitos/créditos se vinculan con facturas y pagos

### Niveles de Confianza del Matching

| Nivel | Significado | Criterios |
|-------|-------------|-----------|
| **HIGH** | Muy confiable | Monto coincide + Fecha cercana + CUIT coincide |
| **MEDIUM** | Probable | Monto coincide + Fecha cercana |
| **LOW** | Posible | Solo monto coincide en rango extendido |

### Columnas de Matching en las planillas

- **matchedPagoFileId** / **matchedFacturaFileId**: ID del documento vinculado
- **matchConfidence**: Nivel de confianza (HIGH/MEDIUM/LOW)
- **hasCuitMatch**: `TRUE` si el CUIT coincide exactamente

### Matching de Monedas Diferentes (USD → ARS)

El sistema puede vincular facturas en USD con pagos en ARS:
- Usa el tipo de cambio oficial del día del pago
- Permite una tolerancia del ±5% en el monto
- El nivel de confianza máximo es MEDIUM (nunca HIGH)

---

## Movimientos Bancarios

### Cómo funciona

Cuando se procesa un resumen bancario:
1. Se extraen todos los movimientos (débitos y créditos)
2. Se registran en la hoja mensual correspondiente (ej: "2025-01")
3. El sistema intenta vincular cada movimiento con documentos existentes

### Columnas en las hojas de movimientos

| Columna | Descripción |
|---------|-------------|
| **fecha** | Fecha del movimiento |
| **origenConcepto** | Descripción del banco |
| **debito** | Monto si es salida de dinero |
| **credito** | Monto si es entrada de dinero |
| **saldo** | Saldo según el extracto PDF |
| **saldoCalculado** | Saldo calculado por fórmula (para verificar) |
| **matchedFileId** | ID del documento vinculado |
| **detalle** | Descripción del vínculo encontrado |

### Ejemplos de Detalle Automático

| Detalle | Significado |
|---------|-------------|
| `Pago Factura de [Proveedor]` | Débito vinculado a una factura recibida |
| `Cobro Factura de [Cliente]` | Crédito vinculado a una factura emitida |
| `Impuesto bancario` | Comisiones o impuestos detectados automáticamente |
| `Pago tarjeta [Banco]` | Pago de tarjeta de crédito |
| `REVISAR! Pago a [Beneficiario]` | Pago sin factura vinculada - requiere revisión |
| `REVISAR! Cobro de [Pagador]` | Cobro sin factura vinculada - requiere revisión |

### Verificación de Saldos

La columna **saldoCalculado** permite verificar que los movimientos están completos:
- Si coincide con **saldo**, todo está correcto
- Si hay diferencia, puede faltar algún movimiento o hay un error en el extracto

---

## Documentos que Requieren Revisión

### Cuándo un documento requiere revisión

1. **CUIT del receptor vacío** en factura emitida
   - Puede ser factura a consumidor final
   - Verificar manualmente si es correcto

2. **Confianza baja** (< 80%)
   - El documento puede estar borroso o mal escaneado
   - Verificar que los datos extraídos sean correctos

3. **No se encontró match** para un pago
   - El sistema marca con "REVISAR!" en el detalle
   - Buscar manualmente la factura correspondiente

### Cómo hacer una revisión

1. Abrir el documento original (click en el link de la columna "fileName")
2. Comparar con los datos en la planilla
3. Corregir manualmente si es necesario
4. Cambiar `needsReview` a `FALSE` después de revisar

---

## Resolución de Problemas Comunes

### El documento fue a "Sin Procesar"

**Posibles causas:**
- PDF ilegible o muy borroso
- Documento dañado o incompleto
- Tipo de documento no soportado
- Error temporal del servicio de IA

**Qué hacer:**
1. Abrir el documento en la carpeta "Sin Procesar"
2. Verificar que sea legible
3. Si está bien, moverlo de vuelta a "Entrada" para reprocesar
4. Si está dañado, obtener una mejor versión del documento

### El documento fue a "Duplicado"

**Significado:** El sistema detectó que este documento ya fue procesado antes.

**Qué hacer:**
1. Verificar en las planillas que el documento original esté registrado
2. Si fue un error, eliminar el duplicado de la carpeta "Duplicado"
3. Si necesita procesarse, primero eliminar el registro anterior de la planilla

### Los documentos no se procesan

**Verificaciones:**
1. Usar menú ADVA → "About" para verificar que el servidor está online
2. Esperar 5 minutos (puede haber cola de procesamiento)
3. Usar menú ADVA → "Trigger Scan" para forzar el procesamiento

### El matching encontró un documento incorrecto

**Qué hacer:**
1. Borrar el contenido de las columnas de matching (matchedFileId, matchConfidence, etc.)
2. Usar menú ADVA → "Trigger Re-match" para buscar nuevos vínculos
3. Si persiste el error, dejar el campo vacío para indicar que no hay match

### Faltan movimientos en la planilla de banco

**Posibles causas:**
- El resumen PDF no se procesó correctamente
- Hay un desfasaje entre períodos

**Qué hacer:**
1. Verificar que el resumen bancario esté en su carpeta (Bancos/{Cuenta})
2. Verificar que la hoja mensual exista (ej: "2025-01")
3. Si falta, volver a subir el resumen a "Entrada"

### El saldoCalculado no coincide con el saldo

**Posibles causas:**
- Falta algún movimiento en el extracto
- El saldo inicial está incorrecto
- Error en la extracción de algún monto

**Qué hacer:**
1. Verificar el saldo inicial contra el extracto PDF
2. Comparar movimiento por movimiento
3. Corregir manualmente el monto erróneo

---

## Consejos Útiles

### Para subir documentos

- Subir documentos uno a la vez para identificar errores más fácilmente
- Usar nombres de archivo descriptivos (el sistema no usa el nombre, pero ayuda a identificarlos)
- No subir documentos que no sean de ADVA (el sistema los rechazará)

### Para verificar datos

- Revisar periódicamente la columna `needsReview`
- Verificar que los saldos calculados coincidan con los extractos
- Revisar los items marcados con "REVISAR!" en los detalles de movimientos

### Para mantener el orden

- Vaciar periódicamente la carpeta "Sin Procesar" después de resolver los problemas
- Eliminar documentos de "Duplicado" después de verificar
- No modificar la estructura de carpetas manualmente

---

## Glosario

| Término | Definición |
|---------|------------|
| **CUIT** | Clave Única de Identificación Tributaria (identificador de empresas) |
| **CUIL** | Clave Única de Identificación Laboral (identificador de personas) |
| **Matching** | Proceso de vincular documentos relacionados automáticamente |
| **Entrada** | Carpeta donde se suben documentos para procesar |
| **Sin Procesar** | Carpeta donde van documentos que no pudieron procesarse |
| **fileId** | Identificador único de Google Drive para cada archivo |
| **needsReview** | Indicador de que un documento necesita verificación manual |
| **confidence** | Nivel de confianza de la extracción de datos (0 a 1) |

---

*Este manual se actualiza junto con el sistema. Última actualización: Enero 2026*
