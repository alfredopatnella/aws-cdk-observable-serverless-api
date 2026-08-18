# Runbook: Latencia elevada

🌐 Idioma: [English](../../runbooks/high-latency.md) | **Español**

> Una alarma le dice a un operador que algo puede estar mal. Un runbook
> le dice al operador qué hacer a continuación.

## Propósito

Responder a la alarma de duración de Lambda (`<stack-name>-lambda-duration`)
o a la alarma de latencia de API Gateway (`<stack-name>-api-latency`) al
entrar en estado `ALARM`.

## Alarma

| | Duración de Lambda | Latencia de la API |
| --- | --- | --- |
| Métrica | `AWS/Lambda Duration` | `AWS/ApiGateway Latency` |
| Estadística | Average | Average |
| Período | 1 minuto | 1 minuto |
| Umbral | `> 1500 ms` | `> 1500 ms` |
| Períodos de evaluación | 1 | 1 |
| Datos faltantes | `notBreaching` | `notBreaching` |

Ambos umbrales están alineados con la demostración `/work?delayMs=`: las
respuestas normales de `/health` y `/hello` se completan muy por debajo
de los 100ms, así que una duración/latencia promedio por encima de
1500ms en un minuto dado casi siempre significa que alguien (a propósito
o no) solicitó un valor grande de `delayMs`, o que los cold starts/
throttling de Lambda están agregando una sobrecarga real. Este proyecto
usa la estadística `Average` por simplicidad; los sistemas en producción
generalmente prefieren p90/p95/p99 porque los promedios pueden ocultar
la latencia de cola (tail latency) que un percentil sí detectaría.
Consulta la sección de consideraciones para producción del README.

## Verificaciones inmediatas

1. Confirma el estado real de la alarma y la ventana de tiempo.
2. Revisa **API Latency** en el panel para esa ventana.
3. Revisa **Lambda Duration** en el panel para la misma ventana.
4. Revisa **Lambda Throttles** en el mismo widget -- los límites de
   concurrencia pueden inflar la latencia percibida incluso cuando las
   invocaciones individuales son rápidas, porque las solicitudes se
   encolan.
5. Revisa el volumen de solicitudes (**API Requests** / **Lambda
   Invocations**) -- un pico de latencia durante un pico de tráfico se
   lee diferente a uno durante un período tranquilo.

## Investigación

6. Consulta los logs de solicitudes lentas para la ventana de tiempo de
   la alarma:

   ```
   fields @timestamp, requestId, route, durationMs
   | filter durationMs > 1000
   | sort durationMs desc
   | limit 50
   ```

7. Para las entradas más lentas, revisa si la `route` es `/work` y si la
   respuesta indica que se solicitó deliberadamente un valor de
   `delayMs` (el handler registra `requestedDelayMs`/`appliedDelayMs` en
   las líneas de log correspondientes). Si es así, este es el mecanismo
   de demostración, no un incidente real.
8. Si las solicitudes lentas no se explican por la demostración de
   `delayMs`, aplica la distinción diagnóstica central:

   - **Alta latencia de la API + alta duración de Lambda** → el propio
     backend/aplicación está lento. Revisa dentro de la función: cold
     starts (revisa el campo `coldStart` en las entradas de log), trabajo
     inesperadamente grande, o el dimensionamiento de memoria/CPU
     (`memorySize` en el stack de CDK).
   - **Alta latencia de la API + duración de Lambda normal** → la
     ralentización está fuera del tiempo de ejecución propio de la
     función. Revisa específicamente `IntegrationLatency` (la porción de
     `Latency` gastada invocando la integración) frente a la `Latency`
     total, y considera factores de red/del lado de API Gateway.

9. Compara `IntegrationLatency` con `Latency`: `Latency` es el ciclo
   completo de ida y vuelta medido por API Gateway (desde que entra la
   solicitud del cliente hasta que sale la respuesta); `IntegrationLatency`
   es solo el tiempo que API Gateway esperó a la integración con Lambda.
   Una brecha grande entre ambas apunta lejos de la propia función
   Lambda.

## Mitigación

10. Para el mecanismo de demostración: deja de enviar valores grandes de
    `delayMs`.
11. Para latencia real causada por cold starts: considera concurrencia
    aprovisionada (provisioned concurrency) (no configurada en esta
    muestra, para mantener el stack mínimo), o confirma si los cold
    starts se correlacionan con un despliegue reciente (que reinicia los
    entornos de ejecución ya inicializados, o "warm").
12. Para lentitud real de la aplicación: perfila y optimiza el código del
    handler directamente, o aumenta `memorySize` (lo cual también
    aumenta la asignación de CPU proporcional para funciones Lambda).
13. Para throttling: revisa si se están alcanzando los límites de
    concurrencia reservada/de la cuenta, y ajústalos según corresponda.

## Validación de la recuperación

14. Confirma que **API Latency** y **Lambda Duration** vuelvan a la
    normalidad (bien por debajo del umbral de 1500ms) en los períodos
    siguientes.
15. Confirma que la alarma regrese al estado `OK` y, si estás suscrito,
    que llegue una notificación de recuperación vía SNS.

## Escalamiento / consideraciones para producción

- Alarmas de latencia basadas en percentiles (p90/p95/p99) en lugar de
  `Average`, para detectar la latencia de cola que los promedios pueden
  enmascarar.
- Correlacionar las regresiones de latencia con el historial de
  despliegues como paso estándar (¿hubo un despliegue justo antes de que
  se disparara la alarma?).
- Canarios sintéticos (synthetic canaries) para detectar la degradación
  de latencia de forma proactiva, en lugar de esperar a que el tráfico
  real de usuarios dispare una alarma.

Consulta la sección de
[consideraciones para producción del README](../../../README.es.md#qué-cambiaría-para-producción)
para la lista completa.
