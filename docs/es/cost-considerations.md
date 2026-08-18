# Consideraciones de costos

🌐 Idioma: [English](../cost-considerations.md) | **Español**

**La observabilidad tiene un costo.** Cada línea de log, cada métrica
personalizada, cada alarma y cada panel es un recurso de AWS facturable,
o contribuye a uno. Más telemetría no es automáticamente mejor
telemetría -- el objetivo de este documento es explicar qué impulsa el
costo en este diseño, no prometer montos exactos en dólares, que cambian
con el tiempo y según la región. Revisa las páginas de precios vigentes
de AWS para obtener cifras exactas antes de estimar un presupuesto real.

## Factores de costo en este proyecto

### API Gateway

Se factura por solicitud a la API (más transferencia de datos). Cada
`curl` contra `/health`, `/hello`, o `/work` es una solicitud facturada,
sin importar si tiene éxito o falla.

### Lambda

Se factura por número de invocaciones y por duración de ejecución
(redondeada hacia arriba), escalada según la memoria asignada. La
demostración `/work?delayMs=` controla directamente la duración: una
solicitud con `delayMs=5000` cuesta aproximadamente 10 veces lo que
cuesta una con `delayMs=500`, porque la facturación de duración de
Lambda es (aproximadamente) lineal respecto al tiempo real de ejecución.

### CloudWatch Logs

Dos componentes de costo separados:

- **Ingesta** -- se factura por GB de datos de log escritos. Cada línea
  de log estructurado y cada línea de log de métrica EMF cuentan para
  esto. El registro detallado (por ejemplo, registrar cuerpos completos
  de solicitud/respuesta) lo aumenta directamente.
- **Almacenamiento** -- se factura por GB-mes de datos de log retenidos.
  Por eso la retención importa: ver más abajo.

### Retención de logs

Este proyecto retiene los logs de acceso de Lambda y de API Gateway
durante **7 días** (`logs.RetentionDays.ONE_WEEK`, configurado en
`lib/aws-cdk-observable-serverless-api-stack.ts`). Dos modos de fallo a
evitar:

- **Retención demasiado corta**: los logs necesarios para investigar un
  incidente descubierto algunas semanas después ya no existen.
- **Retención demasiado larga (o ilimitada, el valor por defecto de
  CloudWatch)**: el costo de almacenamiento se acumula indefinidamente
  para logs que nadie volverá a mirar, y encontrar logs relevantes en
  Logs Insights se vuelve más lento a medida que crece el grupo de logs.

Siete días es un valor por defecto razonable para un laboratorio que vas
a ejecutar y desarmar activamente en cuestión de días, no de semanas. Un
sistema en producción debería elegir la retención en función de cuánto
tiempo toma realísticamente notar e investigar un incidente, más
cualquier mínimo exigido por cumplimiento normativo -- consulta
[`docs/es/security.md`](security.md).

### Métricas personalizadas (EMF)

Las métricas personalizadas de este proyecto (`SuccessfulRequests`,
`FailedRequests`, `WorkDuration`) se extraen de datos de log mediante
Embedded Metric Format, así que no cargan un costo separado por cada
llamada a `PutMetricData` -- pero CloudWatch igual cobra por el
**almacenamiento** de la métrica personalizada resultante, de la misma
forma que lo haría para métricas publicadas vía `PutMetricData`. A
escala significativa, las métricas personalizadas se convierten en un
rubro de costo real, por lo cual:

- Este proyecto publica solo **tres** métricas personalizadas.
- Las dimensiones se limitan a `Environment` y `Operation`, ambas con un
  conjunto pequeño y fijo de valores (tres operaciones: `health`,
  `hello`, `work`). CloudWatch factura (y almacena) las métricas por
  cada combinación única de nombre de métrica + valores de dimensión --
  una *serie temporal de métrica*. Agregar una dimensión de alta
  cardinalidad como `requestId` significaría una serie temporal
  facturable nueva y separada por cada solicitud individual, la mayoría
  de las cuales nunca se volvería a consultar. Consulta
  [`docs/es/security.md`](security.md) y la sección de métricas del
  README para más detalles sobre por qué se evitan por completo las
  dimensiones de alta cardinalidad en este proyecto.

### Paneles (Dashboards)

CloudWatch cobra por panel, por mes, más allá de una pequeña cantidad de
paneles gratuitos incluidos en cada cuenta. Este proyecto crea
exactamente **un** panel.

### Alarmas

CloudWatch cobra por alarma, por mes (alarmas de resolución estándar,
que es lo que usa este proyecto -- todos los períodos son de 1 minuto).
Este proyecto crea exactamente **cuatro** alarmas. Cada alarma adicional
que agregues es un costo adicional continuo, por pequeño que sea.

### SNS

La entrega de notificaciones (p. ej. un correo por cada cambio de estado
de alarma) suele ser económica a escala de demostración, pero no es
gratis -- SNS cobra por notificación entregada, por protocolo. Ejecutar
repetidamente las demostraciones de fallo/latencia generará la cantidad
correspondiente de notificaciones de cambio de estado de alarma si
suscribiste una dirección de correo.

## Un escenario concreto

Considera aproximadamente **10,000 solicitudes/mes** repartidas entre
las tres rutas, cada una produciendo:

- 1 solicitud a API Gateway
- 1 invocación de Lambda
- 2-3 líneas de log JSON estructurado (finalización de la solicitud, más
  advertencias/errores en las rutas de fallo y de limitación de
  `/work`)
- 1-2 líneas de log de métrica EMF (`SuccessfulRequests`/
  `FailedRequests`, más `WorkDuration` para las llamadas a `/work`)

Eso equivale aproximadamente a 10,000 solicitudes de API Gateway, 10,000
invocaciones de Lambda que totalizan una cantidad pequeña de GB-segundos
de cómputo (este handler prácticamente no hace trabajo de CPU fuera del
retraso intencional de `/work`), y aproximadamente 20,000-30,000 líneas
JSON pequeñas de log -- probablemente muy por debajo de 1 GB de ingesta
de logs al mes. A este volumen, los costos dominantes casi con seguridad
son los cargos fijos por panel y por alarma, no los costos de uso por
solicitud/por GB. Esto cambia a mayor volumen, que es exactamente por
qué las decisiones de diseño mencionadas arriba (métricas personalizadas
acotadas, baja cardinalidad de dimensiones, retención finita, un panel
curado en lugar de uno extenso) importan cada vez más a medida que
crece el tráfico.

## Conceptos de optimización de costos que demuestra este proyecto

- **Registra solo contexto operativo útil.** El logger nunca recibe
  payloads completos de solicitud/respuesta ni headers -- consulta
  [`docs/es/security.md`](security.md).
- **Elige la retención de forma deliberada.** Siete días, elegidos y
  documentados, no "lo que sea que CloudWatch use por defecto."
- **Mantén acotados el número de métricas personalizadas y las
  dimensiones.** Tres métricas, dos dimensiones de baja cardinalidad.
- **Evita paneles innecesarios.** Un panel, organizado en tres filas que
  responden preguntas operativas específicas, en lugar de un widget por
  cada métrica que CloudWatch expone.
- **Elige los períodos de las alarmas con criterio.** Cuatro alarmas,
  cada una asociada a un runbook específico -- no una alarma por cada
  métrica "por si acaso."
- **No publiques telemetría duplicada sin propósito.** Las métricas de la
  aplicación (`SuccessfulRequests`/`FailedRequests`) son
  intencionalmente distintas en significado de las métricas administradas
  por AWS (`5XXError` de API Gateway, `Errors` de Lambda) junto a las que
  aparecen en el panel, no una copia redundante de la misma señal.
