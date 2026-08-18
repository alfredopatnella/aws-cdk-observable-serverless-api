# Runbook: Tasa de errores elevada

🌐 Idioma: [English](../../runbooks/high-error-rate.md) | **Español**

> Una alarma le dice a un operador que algo puede estar mal. Un runbook
> le dice al operador qué hacer a continuación.

## Propósito

Responder a la alarma de errores de Lambda (`<stack-name>-lambda-errors`)
o a la alarma de 5xx de API Gateway (`<stack-name>-api-5xx`) al entrar en
estado `ALARM`.

## Alarma

| | Errores de Lambda | API 5xx |
| --- | --- | --- |
| Métrica | `AWS/Lambda Errors` | `AWS/ApiGateway 5XXError` |
| Estadística | Sum | Sum |
| Período | 1 minuto | 1 minuto |
| Umbral | `>= 1` | `>= 1` |
| Períodos de evaluación | 1 | 1 |
| Datos faltantes | `notBreaching` | `notBreaching` |

Ambas alarmas son **intencionalmente sensibles** -- un solo error en un
solo minuto es suficiente para dispararlas. Eso es apropiado para
demostrar a demanda el pipeline de alarma a SNS, no para un error budget
de producción. Una versión de producción de esta alarma debería tener en
cuenta los niveles normales de tráfico, las tasas de fallos transitorios
esperadas, y la criticidad del negocio (ver las consideraciones para
producción del README) en lugar de alarmar ante cualquier error
individual.

## Verificaciones inmediatas

1. Confirma el estado real de la alarma y la ventana de tiempo en la que
   se disparó (consola de CloudWatch Alarms, o `aws cloudwatch
   describe-alarms --alarm-names <stack-name>-lambda-errors`).
2. Mira **Lambda Invocations** junto a **Lambda Errors** en el panel para
   la misma ventana -- un error de una invocación se lee muy distinto a
   un error de mil.
3. Mira **API 4XX / 5XX Errors** en el panel -- confirma si API Gateway
   también está reportando el fallo (debería, para cualquier error que
   escape sin manejar del handler de Lambda).

## Investigación

4. Abre el grupo de logs de CloudWatch Logs de la Lambda
   (`/aws/lambda/<stack-name>-api`, enlazado desde la consola de Lambda o
   la salida del stack `LambdaLogGroupName`).
5. Ejecuta esta consulta de Logs Insights para la ventana de tiempo de la
   alarma:

   ```
   fields @timestamp, requestId, message, route, statusCode
   | filter level = "ERROR"
   | sort @timestamp desc
   | limit 50
   ```

6. Para cada `requestId` distinto que aparezca, extrae cada línea de log
   de esa solicitud para ver la historia completa:

   ```
   fields @timestamp, level, message, requestId, route, durationMs
   | filter requestId = "REQUEST_ID_HERE"
   | sort @timestamp asc
   ```

7. Identifica qué **ruta (route)** está afectada. Si todas las
   solicitudes fallidas tienen `"route": "/work"` y
   `"simulateFailure": true` en su entrada de log, este es el mecanismo
   de demostración `fail=true` funcionando exactamente como fue
   diseñado -- no un incidente real. Confírmalo con quien esté ejecutando
   la demostración antes de tratarlo como uno.
8. Si los fallos no son la demostración de fallo simulado, determina en
   qué categoría cae el fallo:
   - **Código de la aplicación** -- un bug en la lógica del handler en
     sí.
   - **Configuración** -- p. ej. una variable de entorno faltante, un
     permiso incorrecto.
   - **Dependencia** -- esta muestra no tiene dependencias externas (sin
     base de datos, sin API posterior), así que una causa relacionada
     con una dependencia aquí apuntaría a algo agregado desde el alcance
     original de este proyecto.
   - **Capacidad** -- revisa si hay `Throttles` en el widget del panel de
     Lambda; el throttling también se manifiesta como errores desde la
     perspectiva de quien llama.

## Mitigación

9. Para el mecanismo de demostración: simplemente deja de enviar
   solicitudes con `fail=true`. La tasa de error volverá a cero por sí
   sola.
10. Para un bug real de la aplicación: revierte el despliegue más
    reciente si el momento coincide, o corrige y vuelve a desplegar
    (`npm run build && npx cdk deploy`).
11. Para un problema de configuración: corrige la configuración del stack
    de CDK (variables de entorno, permisos IAM) y vuelve a desplegar.

## Validación de la recuperación

12. Confirma que los widgets **Lambda Errors** y **API 5XX Errors**
    vuelvan a cero en los períodos de 1 minuto siguientes.
13. Confirma que la alarma regrese al estado `OK`. Como ambas alarmas
    tienen una acción de OK conectada al mismo topic de SNS, también
    deberías recibir una notificación de "recuperado" si suscribiste una
    dirección de correo.

## Escalamiento / consideraciones para producción

Esta muestra no tiene rotación de guardia (on-call), política de
escalamiento, ni herramientas de gestión de incidentes -- es un
laboratorio. Un despliegue de producción de un patrón como este
típicamente agregaría:

- Alarmas por tasa de error (porcentaje) en lugar de conteos absolutos,
  reflejando un error budget/SLO real.
- Políticas de escalamiento y paging (p. ej. PagerDuty) en lugar de una
  simple suscripción por email de SNS.
- Una distinción entre "errores transitorios conocidos y esperados" y
  "fallos nuevos," a menudo mediante alarmas compuestas o detección de
  anomalías.
- Correlación con despliegues recientes (un flujo de salud de
  despliegue/rollback) como paso de investigación de primera clase.

Consulta la sección de
[consideraciones para producción del README](../../../README.es.md#qué-cambiaría-para-producción)
para la lista completa.
