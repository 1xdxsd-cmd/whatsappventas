# whatsappventas

Agente de WhatsApp para vender cuentas y perfiles de streaming (Netflix, Disney+, HBO Max). Usa [Baileys](https://github.com/WhiskeySockets/Baileys) para conectarse a un número de WhatsApp y un servidor Node.js para atender a los clientes.

## Qué hace hoy (fase 1)

- Se conecta a WhatsApp escaneando un QR y guarda la sesión para no volver a escanear.
- Se reconecta solo si se cae la conexión.
- Responde con un menú: ver planes y precios, renovar una cuenta, reportar una cuenta que no funciona, cómo comprar, hablar con un asesor, recuperar el usuario o la contraseña de la página, recargar crédito.
- Toma el pedido (servicio + perfil o cuenta completa), envía los datos de transferencia y pide el comprobante.
- Te avisa a tu número personal de cada pedido nuevo, te reenvía el comprobante y te avisa cuando alguien pide un asesor.
- Con un asesor, el bot se queda callado hasta que el cliente escribe `menu`.

## Conexión con tu página (StreamRent)

Con `PAGINA_URL`, `PAGINA_USUARIO` y `PAGINA_CLAVE` en el `.env`, el bot entra a tu página como administrador y:

- Toma de **Servicios** el catálogo y los precios (solo los activos), y de **Métodos de pago** los datos de transferencia (solo si `DATOS_TRANSFERENCIA` está vacío; si lo llenas, manda el `.env`).
- Reconoce al cliente por el teléfono guardado en su ficha (compara los últimos 10 dígitos) y lo saluda por su nombre.
- Guarda cada pedido en **Pedidos**, con el teléfono y una nota, y la actualiza cuando llega el comprobante.
- Deja los reportes en **Cuentas caídas**: el cliente elige una de sus rentas activas y escribe qué pasa. Solo puede tener un reporte en curso: si intenta otro, el bot le dice que ya hay uno abierto. En el aviso a los admins salen las cuentas libres de la misma plataforma y tipo para reemplazarla (`/reemplazar 12 1`) o se puede dar de alta una nueva (`/reemplazar 12 correo contraseña`); la página pasa a esa cuenta todas las rentas activas de la caída, así que solo se ofrecen (y se aceptan) cuentas con lugar para todas, y el bot les manda los datos nuevos al cliente que reportó y a los demás clientes de esa cuenta.
- Cobra con el **crédito** del cliente: si su saldo alcanza, al comprar o renovar puede elegir pagar con crédito o por transferencia. El bot descuenta el saldo, crea o extiende la renta (asignando una cuenta libre como el portal) y registra la venta. Si algo falla después de descontar, devuelve el crédito y te avisa.
- Avisa a todos los admins de las **cuentas compradas a proveedores** (pestaña **Compras**) que vencen en 3 días o menos: un mensaje al día a partir de las 9 am (hora de la Ciudad de México), con la cuenta, el proveedor, el costo y cuándo vence. A los clientes no se les dice nada.
- Ayuda a **recuperar el acceso a la página** (opción 6, o escribiendo *usuario*, *contraseña* o *clave*): si el cliente escribe desde el teléfono guardado en su ficha, el bot le dice su usuario y le deja poner una contraseña nueva (mínimo 6 caracteres). El teléfono es la prueba de identidad: desde otro número no le dice nada y te avisa. La contraseña actual nunca se envía (la página solo guarda su huella), y te llega un aviso de cada cambio. Con `PAGINA_ENLACE` el bot también le da la dirección de la página.
- **Recarga crédito** sin comprar (opción 7, o escribiendo *recargar* o *saldo*): el cliente ve su saldo, escribe el monto (mínimo $50), paga por transferencia y manda el comprobante. Con `/aprobar N` el bot suma el crédito en la página y le avisa al cliente su saldo nuevo. Solo para clientes registrados con ese teléfono.
- Manda **recordatorios de vencimiento** todos los días a las 12 pm (hora de la Ciudad de México) desde 3 días antes de que venza la cuenta, en un mensaje por cliente. Si a esa hora el bot estaba apagado, el aviso del día sale en cuanto vuelve (hasta las 8 pm). Además, cuando el cliente escribe, el saludo le recuerda las cuentas que vencen en 3 días o menos. El cliente responde *renovar*, elige la cuenta y paga el precio de su renta. A todos los admins les llega, una vez al día a partir de las 12 pm, la lista de cuentas por vencer (cliente, teléfono, plataforma y cuándo vence), y después un resumen de a qué clientes se les avisó. Los avisos enviados se guardan en `datos/recordatorios.json` para no repetirlos.

Si la página no responde o no está configurada, el bot sigue funcionando con el catálogo de `src/catalogo/servicios.js` (precios mensuales en pesos mexicanos) y `DATOS_TRANSFERENCIA`, pero no guarda pedidos ni reportes.

El estado de cada conversación vive en memoria y se pierde al reiniciar el bot.

## IA con Ollama (opcional)

Con `IA_URL` (la dirección de tu Ollama, por ejemplo `https://ia.ventasthalia.com`) e `IA_MODELO` en el `.env`, el cliente platica con la IA y **no ve el menú de números**: la IA da la información (precios, sus cuentas y vencimientos, su crédito) y, cuando el cliente confirma, hace la acción por detrás con una etiqueta que el cliente no ve:

| Etiqueta | Qué hace el bot |
| --- | --- |
| `[[comprar:netflix:perfil:transferencia]]` | Crea el pedido y manda los datos de transferencia (o cobra con `credito`) |
| `[[renovar:1:transferencia]]` | Renueva la cuenta 1 del cliente |
| `[[reportar:1:pide código]]` | Guarda el reporte de la cuenta 1 |
| `[[recargar:300]]` | Recarga de crédito por transferencia |
| `[[clave]]` | Le pide la contraseña nueva de la página |
| `[[mis-cuentas]]` | Le manda sus cuentas activas: servicio, tipo, correo y fecha ("1 de diciembre de 2026") |
| `[[datos:1]]` | Le manda el correo y la contraseña de su cuenta 1 (de la página, solo al número registrado y nunca de cuentas suspendidas) |
| `[[asesor]]` | Lo pasa con un asesor; el aviso lleva lo que contó |

Con varias personas que cobran (`PAGO_N_...`), la IA pregunta a quién pagar y lo agrega al final (`...:transferencia:Thalia`). Las etiquetas pasan por la misma conversación del menú, así que los cobros, pedidos y reportes siguen las mismas reglas. Si la IA solo ofrece algo ("¿te paso los datos?") no se hace nada hasta que el cliente confirme. El comprobante, el motivo del reporte, la contraseña nueva y el chat con asesor funcionan igual que siempre.

- La IA sabe solo datos reales: los planes de la página, el nombre, usuario, crédito y cuentas activas del cliente con su correo y fecha (las contraseñas no: esas las manda el bot con `[[datos:N]]`), lo que tiene en curso (pago en revisión, reporte abierto) y lo que escribas en `conocimiento.md` (copia `conocimiento.ejemplo.md`). Se lee en cada mensaje.
- Recuerda los últimos 12 mensajes de cada chat y no vuelve a saludar mientras la conversación sigue (se olvida tras 6 horas sin escribir o al reiniciar el bot).
- Las negritas salen en formato de WhatsApp (`*así*`).
- **Revisión de cada respuesta**: si la IA escribe datos de pago inventados o textos entre corchetes, dice que ya confirmó un pago o una recarga, o anuncia algo que no muestra, el bot no lo manda: le pide otra respuesta y, si vuelve a fallar, manda un texto seguro (sin pasarlo a un asesor). Si anuncia la lista de cuentas sin mostrarla, el bot manda la lista real.
- **Preguntas por sus cuentas** ("¿cuáles son mis cuentas?", "quiero renovar pero no sé cuál", "¿cuándo vence?"): el bot manda la lista real directamente, sin pasar por la IA.
- **Etiquetas flexibles**: la forma de pago y a quién se paga se reconocen aunque la IA cambie el orden (`[[comprar:vix:perfil:Anthony]]`). Si solo falta a quién pagar, el bot lo pregunta y, cuando el cliente lo dice ("Anthony por favor"), genera el pedido y manda los datos de pago en ese momento. La acción se prueba antes de mandar el texto de la IA, para no decir "¡Listo!" y luego "no pude".
- **Quién aprueba**: una transferencia a la cuenta de una persona (`PAGO_N_...`) solo la puede aprobar o rechazar esa persona con `/aprobar N` o `/rechazar N`; si otro admin lo intenta, el bot le dice a quién le toca. Al cliente se le dice que su pago quedó en revisión con esa persona, y la IA nunca lo da por confirmado.
- **Fotos con la IA activa**: si el cliente manda una foto sin pedido en curso (por ejemplo, el comprobante antes de pedir los datos), la IA pregunta qué está pagando; cuando genera el pedido, esa foto (de los últimos 30 minutos) se toma como su comprobante. No aparece el menú de números.
- **El menú de números es solo el respaldo**: si Ollama no responde en `IA_ESPERA_SEGUNDOS` (30 por defecto), el bot contesta con el menú y no vuelve a intentar con la IA durante un minuto.

## Atender desde tu WhatsApp (admin)

Desde un número de `NUMERO_ADMIN` le escribes al bot y él actúa. Puedes poner varios administradores separados por comas: a todos les llegan los avisos y cualquiera puede usar los comandos. Cuando uno aprueba, rechaza o resuelve un caso, a los demás les llega un aviso, y un caso ya cerrado no se puede aprobar dos veces. Cada pedido, reporte o chat tiene un número de caso (#12) que aparece en los avisos.

| Comando | Qué hace |
| --- | --- |
| `#12 texto` | Envía ese texto al cliente del caso 12 (cuentas, respuestas a reportes, lo que sea). Si mandas foto o archivo con `#12` en el pie, también se le reenvía |
| `/aprobar 12` | Confirma el pago por transferencia: crea la renta con una cuenta libre (o renueva), le manda los datos al cliente y pasa el pedido a Ventas |
| `/rechazar 12 motivo` | Le avisa al cliente que no se confirmó el pago; puede mandar otro comprobante |
| `/reemplazar 12 1` | Reemplaza la cuenta caída del reporte con la opción 1 de la lista del aviso, la marca resuelta en la página y le manda los datos nuevos al cliente |
| `/reemplazar 12 correo contraseña [perfiles]` | Igual, con una cuenta nueva que se da de alta en **Cuentas** (por defecto con los perfiles de la caída) |
| `/resuelto 12 texto` | Marca el reporte como resuelto en la página y le manda el texto al cliente |
| `/tomar 12` | Atiendes tú a ese cliente: lo que escribas le llega y lo que él escriba te llega solo a ti. A los demás admins se les avisa que ya está atendido (`/chat 12` hace lo mismo) |
| `/fin` | Termina el chat activo; el cliente vuelve al bot |
| `/casos` | Lista los casos abiertos |
| `/ayuda` | Muestra los comandos |

Para que el cliente elija a quién pagar, define a cada persona con `PAGO_1_NOMBRE`, `PAGO_1_NUMEROS` (uno o varios, separados por comas) y `PAGO_1_DATOS`, luego `PAGO_2_...`, etc. Con dos o más, antes de los datos de transferencia el bot pregunta "¿A quién le quieres hacer la transferencia?" con los nombres. El aviso del pedido o la recarga y el comprobante solo les llegan a los números de esa persona, que son quienes lo aprueban; a los demás no se les avisa. Esos números también cuentan como admins.

Cuando un cliente pide un asesor, el bot le dice que espere mientras lo enlaza con un asesor, y a todos los admins les llega el aviso con `/tomar 12`. El primero que lo toma lo atiende; si otro intenta tomarlo, el bot le dice quién lo atiende. Cada admin tiene su propio chat activo. Mientras el cliente está con el asesor, el bot no le contesta y todo lo que escribe te llega con su número de caso. Los casos viven en memoria: si reinicias el bot, los anteriores ya no se pueden usar.

## Cómo correrlo

Requisitos: Node.js 20 o superior y un número de WhatsApp dedicado al bot.

```bash
npm install
cp .env.example .env   # y completa NUMERO_ADMIN, MONEDA y DATOS_TRANSFERENCIA
npm start
```

Hay dos formas de vincular el número del bot:

- **Con QR** (si `NUMERO_BOT` está vacío): en la terminal aparece un QR. En el teléfono del bot abre WhatsApp > Dispositivos vinculados > Vincular un dispositivo y escanéalo.
- **Con código de 8 caracteres** (si pones `NUMERO_BOT` en el `.env`): en la terminal aparece un código como `ABCD-1234`. En el teléfono del bot abre WhatsApp > Dispositivos vinculados > Vincular un dispositivo > Vincular con el número de teléfono, y escríbelo. Sirve cuando no puedes escanear, por ejemplo si el servidor no tiene pantalla. El código no cambia aunque el bot se reconecte, y con `CODIGO_VINCULACION=STREAM26` puedes elegirlo tú. Si el teléfono dice "verifica si el número es correcto": detén el bot, borra la carpeta `auth/`, revisa que lo estés escribiendo en el teléfono que tiene el número de `NUMERO_BOT` y prueba con y sin el "1" (`526771319656` o `5216771319656`).

Solo se vincula una vez. Si WhatsApp cierra la sesión (por ejemplo, la desvinculas desde el teléfono), el bot borra la sesión vieja y vuelve a mostrar el QR o el código. Si aparece "Otra copia del bot abrió la misma sesión", hay dos copias corriendo con la misma carpeta `auth/`: deja solo una. La sesión queda en la carpeta `auth/`, que nunca debe subirse a GitHub.

Para ver los logs más legibles: `npm start | npx pino-pretty`.

## Pruebas

```bash
npm test
```

## Para cuidar el número

Baileys no es oficial y WhatsApp puede bloquear números que se comportan como bots. Por eso el bot pone "escribiendo..." y espera 1 a 3 segundos antes de cada mensaje, y nunca envía mensajes masivos. Los recordatorios son lo único que el bot envía sin que le escriban: van solo a clientes con renta activa, uno por cliente y con 20 segundos entre uno y otro. Usa un número dedicado, no el personal.

## Estructura

| Carpeta | Qué hace |
| --- | --- |
| `src/whatsapp/` | Conexión con Baileys, QR, reconexión y cola de envío. Único lugar que conoce Baileys |
| `src/bot/` | Conversación: menú, catálogo, pedido, comprobante y reportes, como función pura y probada |
| `src/catalogo/` | Catálogo de respaldo y cómo se muestra |
| `src/pagina/` | Conexión con la API de tu página |
| `src/recordatorios/` | Recordatorios de vencimiento |
| `src/sesiones.js` | Estado de cada conversación (en memoria por ahora) |
