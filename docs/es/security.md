# Seguridad

🌐 Idioma: [English](../security.md) | **Español**

Este documento resume los límites de confianza (trust boundaries), los
permisos de IAM, y las decisiones de seguridad relacionadas con el
registro (logging) en esta muestra, y separa lo que está implementado
aquí de lo que debería agregar un despliegue en producción.

## Límites de confianza

```text
Internet (sin autenticar) ──HTTPS──> API Gateway ──rol IAM──> Lambda ──rol IAM──> CloudWatch Logs / Metrics
                                                                                 └─rol IAM──> (SNS: solo alarmas, no código de la app)
```

- La API es **pública y no requiere autenticación** por diseño -- esto es
  una demostración pensada para invocarse con `curl` desde una terminal
  sin configurar credenciales. Consulta
  [Controles de seguridad recomendados para producción](#controles-de-seguridad-recomendados-para-producción)
  para ver qué cambia aquí.
- El tráfico entre un cliente y API Gateway está cifrado con TLS
  (`https://...execute-api...`). Las REST API de API Gateway no ofrecen
  una opción de HTTP sin cifrar.
- El rol de ejecución de la función Lambda está acotado a lo que
  realmente necesita: escribir en su propio grupo de logs de CloudWatch
  Logs. No tiene permisos sobre ningún otro recurso de AWS en esta
  cuenta.

## IAM con mínimo privilegio

| Rol | Permisos otorgados | Por qué |
| --- | --- | --- |
| Rol de ejecución de Lambda | Política administrada `AWSLambdaBasicExecutionRole` (escritura en CloudWatch Logs) | Necesario para enviar logs (y por lo tanto las métricas personalizadas derivadas de EMF) a CloudWatch |
| Rol de CloudWatch de API Gateway | Política administrada `AmazonAPIGatewayPushToCloudWatchLogs` | Necesario una vez por cuenta/región para que API Gateway escriba logs de ejecución/acceso |
| Política del topic de SNS | Por defecto (se permite que las alarmas de CloudWatch publiquen) | Permite que las cuatro alarmas de este stack notifiquen al topic |

No se otorga ningún permiso IAM para `cloudwatch:PutMetricData`, porque
las métricas personalizadas usan Embedded Metric Format (EMF) en lugar
de la API `PutMetricData` -- consulta
[`docs/es/architecture.md`](architecture.md) para saber por qué. Si
extiendes este proyecto para llamar directamente a `PutMetricData`,
debes agregar ese permiso explícitamente; no está implícito en nada de
lo que ya se otorga aquí.

Los permisos de CloudWatch Logs del rol de ejecución de Lambda provienen
de la política administrada de AWS `AWSLambdaBasicExecutionRole`, que
está acotada a `arn:aws:logs:*:*:*` (todos los grupos de logs en la
cuenta/región), no solo al grupo de logs propio de esta función. Este es
el comportamiento estándar por defecto de CDK/Lambda. Para una carga de
trabajo en producción, considera reemplazarla con una política en línea
acotada al ARN específico del grupo de logs.

## Datos sensibles en los logs

Registro estructurado **no** significa "registrar todo." El logger de
este proyecto (`src/shared/logger.ts`) solo recibe los campos que el
handler le pasa explícitamente: `requestId`, `route`, `method`,
`statusCode`, `durationMs`, `coldStart`, `functionName`, y un pequeño
número de campos específicos de cada solicitud (p. ej.
`requestedDelayMs`).

El handler deliberadamente **no** registra:

- Headers de autorización ni ningún otro header de la solicitud
- El objeto completo del evento de API Gateway
- Cuerpos de solicitud sin procesar ni payloads arbitrarios
  proporcionados por el usuario
- Cookies, tokens, ni credenciales de ningún tipo

Si extiendes el handler para aceptar cuerpos de solicitud o headers
adicionales, resiste la tentación de registrar el objeto `event`
completo por conveniencia -- extrae solo los campos específicos que
necesitas, tal como lo hace el handler existente.

## Inyección de logs (log injection)

Como cada línea de log pasa por `JSON.stringify` antes de escribirse,
los valores que contienen caracteres como saltos de línea o comillas
quedan escapados de forma segura dentro de la cadena JSON, en lugar de
poder falsificar líneas o campos de log adicionales. Evita cambiar a
concatenación manual de strings para los mensajes de log, ya que eso
reintroduciría ese riesgo.

## Acceso a CloudWatch y SNS

Nada en este stack cambia quién puede *leer* los logs, métricas o
paneles de CloudWatch, ni quién puede suscribirse al topic de SNS -- eso
lo rigen los permisos IAM de quien opera en la cuenta de AWS, algo que
esta muestra no intenta restringir más allá de la configuración IAM ya
existente en la cuenta. El propio topic de SNS no tiene ninguna política
de recursos más allá de la predeterminada (se permite que las alarmas de
CloudWatch de esta cuenta publiquen en él); no acepta publicaciones de
cuentas de AWS arbitrarias.

Las notificaciones de alarmas enviadas a SNS incluyen el nombre de la
alarma, la métrica y el umbral que se superaron, y el estado nuevo/
anterior de la alarma -- no incluyen ningún dato de la aplicación, ya que
las alarmas solo evalúan valores de métricas.

## Política de eliminación y retención de datos

Los grupos de logs en este stack usan `RemovalPolicy.DESTROY` y un
período de retención de 7 días, para que `cdk destroy` limpie por
completo un entorno de laboratorio sin dejar grupos de logs huérfanos.
Esta es una elección **conveniente para un laboratorio**, no para
producción: los sistemas en producción deberían elegir la retención en
función de las ventanas de investigación de incidentes, los requisitos
de cumplimiento normativo, y el costo -- consulta
[`docs/es/cost-considerations.md`](cost-considerations.md) -- y deberían
pensarlo bien antes de usar `DESTROY` por defecto en algo que pueda
contener evidencia necesaria después de eliminar un stack.

## Controles de seguridad implementados en esta muestra

- Acceso a la API únicamente por TLS (impuesto por API Gateway)
- Rol de ejecución de Lambda con mínimo privilegio (solo CloudWatch Logs,
  sin acceso a ningún otro recurso de AWS)
- Sin secretos, credenciales, ni payloads completos de solicitud/
  respuesta en los logs
- Simulación de fallo/latencia acotada y limitada del lado del servidor
  (quienes llaman no pueden forzar una invocación de duración arbitraria)
- Retención de logs explícita y finita (no "para siempre" por accidente)
- Las suscripciones por email de SNS requieren confirmación (ver README)
  -- no se entrega ninguna notificación a una dirección sin confirmar
- Sin credenciales, IDs de cuenta, ni direcciones de correo personales
  codificadas de forma fija (hardcoded) en ningún lugar del código

## Controles de seguridad recomendados para producción

- **Autenticación** -- un IAM authorizer, un Lambda authorizer, o un
  Cognito authorizer delante de la API. Esta muestra no tiene ninguno, a
  propósito, para que sea fácil de invocar con `curl` durante un
  laboratorio.
- **Límite de tasa / usage plans** -- usage plans y throttling de API
  Gateway para proteger el backend de tráfico excesivo.
- **AWS WAF** -- para APIs de producción expuestas públicamente, una web
  ACL de WAF delante de API Gateway para filtrar patrones de ataque
  comunes.
- **Política IAM de escritura de logs más acotada** -- restringir los
  permisos de CloudWatch Logs del rol de ejecución al ARN específico del
  grupo de logs de esta función, en lugar de la política administrada
  amplia.
- **Cifrado en reposo para los logs** -- CloudWatch Logs admite cifrado
  con KMS para los grupos de logs; esta muestra usa la clave
  administrada por defecto de CloudWatch, que no está cifrada con una
  clave del cliente (los datos igual están cifrados en reposo por AWS,
  solo que no con una clave que tú controles).
- **Redacción / eliminación de PII** -- si algún día se necesita
  registrar payloads de solicitud, redacta o aplica hash a los campos
  sensibles antes de que lleguen a `console.log`.
- **Retención más larga o regulada** -- guiada por requisitos de
  cumplimiento normativo (p. ej. mandatos de retención de logs de
  auditoría) en lugar del valor por defecto de 7 días de este
  laboratorio.
- **Auditabilidad** -- CloudTrail para la actividad de la cuenta de AWS a
  nivel de API, separado de los CloudWatch Logs a nivel de aplicación en
  los que se enfoca este proyecto.
