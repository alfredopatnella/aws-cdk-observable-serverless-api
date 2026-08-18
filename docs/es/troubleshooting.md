# Solución de problemas

🌐 Idioma: [English](../troubleshooting.md) | **Español**

Flujos de trabajo prácticos, organizados por síntoma, para este
proyecto. Para procedimientos de incidentes paso a paso vinculados a las
dos alarmas, consulta los runbooks en `docs/es/runbooks/`. Este
documento es más amplio: cubre situaciones que no necesariamente
implican que se dispare una alarma, incluyendo problemas con la propia
herramienta de observabilidad.

## La API devuelve 5xx

1. Revisa el widget **Lambda Errors** en el panel (o `AWS/Lambda Errors`
   para la función) -- ¿fallaron las invocaciones?
2. Revisa **API 4XX / 5XX Errors** en el panel (`AWS/ApiGateway
   5XXError`) -- confirma que la API realmente esté reportando el fallo,
   no solo el cliente.
3. Abre el grupo de logs de CloudWatch Logs de la Lambda
   (`/aws/lambda/<stack-name>-api`).
4. Ejecuta la consulta de Logs Insights de nivel ERROR (más abajo) para
   encontrar las solicitudes específicas que fallaron.
5. Identifica el `requestId` y la `route` en las entradas que fallaron.
6. Si todos los fallos tienen `"simulateFailure": true`, esto es la
   demostración de `/work?fail=true` funcionando como se espera, no un
   incidente real.
7. Si los fallos son inesperados, consulta
   `docs/es/runbooks/high-error-rate.md`.

## La API está lenta

1. Revisa **API Latency** en el panel (`AWS/ApiGateway Latency`, la
   estadística `Average` con un período de 1 minuto).
2. Compárala con `IntegrationLatency` (disponible en la consola de API
   Gateway para el stage, o vía `api.metricIntegrationLatency()` si la
   agregas al panel) -- ver la distinción más abajo.
3. Revisa **Lambda Duration** en el panel.
4. Revisa **Lambda Throttles** -- los límites de concurrencia pueden
   manifestarse como solicitudes lentas o fallidas bajo carga.
5. Consulta los logs de solicitudes lentas (más abajo) para encontrar
   valores específicos de `durationMs` y las rutas/solicitudes
   responsables.

**Relación diagnóstica:**

- Alta latencia de la API **y** alta duración de Lambda → el propio
  backend/aplicación está lento (p. ej. alguien está invocando
  `/work?delayMs=`, o la lógica real de la aplicación se ha vuelto más
  lenta).
- Alta latencia de la API **y** duración de Lambda normal → revisa la
  capa de API Gateway/integración o el comportamiento de red en lugar de
  la función en sí -- `Latency` incluye tiempo fuera de la invocación de
  Lambda (`IntegrationLatency` es específicamente la porción de la
  invocación de Lambda).

## Se disparó una alarma de Lambda

Consulta `docs/es/runbooks/high-error-rate.md` o
`docs/es/runbooks/high-latency.md` según cuál alarma (`*-lambda-errors` o
`*-lambda-duration`) esté en estado `ALARM`. En resumen: compara los
valores de error/duración contra el volumen de tráfico reciente, revisa
los logs de la ventana de tiempo afectada, y confirma si la causa es la
demostración intencional de fallo/latencia o algo inesperado.

## Se disparó la alarma de latencia de la API

Compara tres cosas para la ventana de tiempo de la alarma:

- `Latency` de API Gateway
- `Duration` de Lambda
- Volumen de solicitudes (`Count` / `Invocations`)

Si la duración de Lambda sigue de cerca a la latencia de la API, la
ralentización está dentro de la función (lo más probable es que alguien
esté probando `/work?delayMs=`). Si la latencia de la API está elevada
pero la duración de Lambda es normal, investiga la capa de API Gateway/
integración en lugar del código de la función.

## Las notificaciones de SNS no están llegando

1. Confirma que la alarma realmente pasó a `ALARM` (consola de Alarms) --
   sin cambio de estado no hay notificación, por diseño.
2. Confirma que las **Actions** de la alarma incluyan el topic de SNS
   (`<stack-name>-alarms`) -- este stack conecta las cuatro alarmas a él
   por defecto, así que una acción faltante generalmente significa que se
   hizo un cambio manual.
3. Revisa la pestaña **Subscriptions** del topic de SNS. Si desplegaste
   sin `-c alarmEmail=...`, no hay suscripciones y nunca se entregará
   ninguna notificación -- esto es esperado, no un bug.
4. Si existe una suscripción, revisa su estado. Las suscripciones por
   email de SNS comienzan en `PendingConfirmation` y se quedan ahí --sin
   entregar nada-- hasta que el destinatario hace clic en el enlace de
   confirmación del correo inicial de SNS. Revisa las carpetas de spam/
   correo no deseado en busca de ese correo de confirmación.
5. Confirma que el protocolo/endpoint de la suscripción coincidan con lo
   que pretendías (errores de tipeo en la dirección de correo pasada a
   `-c alarmEmail=`).

## El panel no muestra datos

1. Confirma que estás viendo la consola de CloudWatch en la **misma
   región de AWS** en la que se desplegó el stack (`echo
   $CDK_DEFAULT_REGION`, o revisa la salida del despliegue).
2. Confirma que el rango de tiempo del panel realmente cubre el momento
   en que generaste tráfico (el rango por defecto de la consola puede
   ser demasiado angosto o demasiado amplio).
3. Confirma que efectivamente enviaste tráfico -- una API inactiva no
   produce puntos de datos nuevos, lo cual es esperado (ver el
   comportamiento ante datos faltantes en
   [`docs/es/architecture.md`](architecture.md)), no un bug del panel.
4. Verifica el **namespace** de la métrica: los widgets administrados por
   AWS usan `AWS/Lambda` y `AWS/ApiGateway`; los widgets personalizados
   usan `ObservableServerlessApi` (o tu namespace personalizado si
   cambiaste `src/shared/metrics.ts#METRIC_NAMESPACE`).
5. Confirma que las **dimensiones** configuradas (`Environment`,
   `Operation`) coincidan con lo que la Lambda en ejecución realmente
   está emitiendo -- p. ej. si cambiaste la variable de entorno
   `ENVIRONMENT` después de desplegar el panel, los widgets antiguos
   anclados al valor previo dejarán de mostrar datos.
6. Confirma que estás viendo el panel del stack que realmente
   desplegaste -- el nombre del panel es `<stack-name>-observability`; si
   desplegaste con un nombre de stack diferente, los nombres de los
   recursos también son diferentes.

## Faltan las métricas personalizadas

1. Confirma que el namespace coincide: `ObservableServerlessApi` (ver
   `src/shared/metrics.ts#METRIC_NAMESPACE`).
2. Confirma que el rol de ejecución de Lambda puede escribir logs -- si
   la ingesta de CloudWatch Logs está rota (p. ej. una mala
   configuración de IAM), la extracción de EMF no tiene nada que
   analizar. Busca errores `AccessDenied` en la propia salida de error/
   consola de la Lambda.
3. Como este proyecto usa EMF, revisa los logs crudos de la Lambda en
   busca del bloque de metadatos `_aws` mostrado en
   [`docs/es/architecture.md`](architecture.md) -- si ese bloque falta o
   está malformado, CloudWatch no tiene nada de dónde extraer una
   métrica. Un bug de parseo JSON en `src/shared/metrics.ts` se
   evidenciaría aquí primero.
4. Confirma que las dimensiones usadas en una consulta/widget
   (`Environment`/`Operation`) coincidan exactamente con un valor que la
   Lambda realmente esté emitiendo (distingue mayúsculas de minúsculas).
5. Recuerda que la extracción de EMF es asíncrona y puede rezagarse un
   poco respecto al momento en que se escribe la línea de log -- espera
   uno o dos minutos antes de asumir que una métrica realmente falta.

## Referencia de Logs Insights

Estas consultas asumen la estructura de log JSON descrita en la sección
[Registro estructurado en JSON](../../README.es.md#registro-estructurado-en-json)
del README.

**Todos los eventos de nivel ERROR, más recientes primero:**

```
fields @timestamp, requestId, message, route, statusCode
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```

**Solicitudes lentas (más de 1 segundo):**

```
fields @timestamp, requestId, route, durationMs
| filter durationMs > 1000
| sort durationMs desc
| limit 50
```

**Cada línea de log de una solicitud específica (correlación por ID de
solicitud):**

```
fields @timestamp, level, message, requestId, route, durationMs
| filter requestId = "REQUEST_ID_HERE"
| sort @timestamp asc
```
