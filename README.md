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
- Deja los reportes en **Cuentas caídas**: el cliente elige una de sus rentas activas y escribe qué pasa.
- Cobra con el **crédito** del cliente: si su saldo alcanza, al comprar o renovar puede elegir pagar con crédito o por transferencia. El bot descuenta el saldo, crea o extiende la renta (asignando una cuenta libre como el portal) y registra la venta. Si algo falla después de descontar, devuelve el crédito y te avisa.
- Avisa a todos los admins de las **cuentas compradas a proveedores** (pestaña **Compras**) que vencen en 3 días o menos: un mensaje al día a partir de las 9 am (hora de la Ciudad de México), con la cuenta, el proveedor, el costo y cuándo vence. A los clientes no se les dice nada.
- Ayuda a **recuperar el acceso a la página** (opción 6, o escribiendo *usuario*, *contraseña* o *clave*): si el cliente escribe desde el teléfono guardado en su ficha, el bot le dice su usuario y le deja poner una contraseña nueva (mínimo 6 caracteres). El teléfono es la prueba de identidad: desde otro número no le dice nada y te avisa. La contraseña actual nunca se envía (la página solo guarda su huella), y te llega un aviso de cada cambio. Con `PAGINA_ENLACE` el bot también le da la dirección de la página.
- **Recarga crédito** sin comprar (opción 7, o escribiendo *recargar* o *saldo*): el cliente ve su saldo, escribe el monto (mínimo $50), paga por transferencia y manda el comprobante. Con `/aprobar N` el bot suma el crédito en la página y le avisa al cliente su saldo nuevo. Solo para clientes registrados con ese teléfono.
- Manda **recordatorios de vencimiento** todos los días a las 12 pm (hora de la Ciudad de México) desde 3 días antes de que venza la cuenta, en un mensaje por cliente. Si a esa hora el bot estaba apagado, el aviso del día sale en cuanto vuelve (hasta las 8 pm). Además, cuando el cliente escribe, el saludo le recuerda las cuentas que vencen en 3 días o menos. El cliente responde *renovar*, elige la cuenta y paga el precio de su renta. A todos los admins les llega, una vez al día a partir de las 12 pm, la lista de cuentas por vencer (cliente, teléfono, plataforma y cuándo vence), y después un resumen de a qué clientes se les avisó. Los avisos enviados se guardan en `datos/recordatorios.json` para no repetirlos.

Si la página no responde o no está configurada, el bot sigue funcionando con el catálogo de `src/catalogo/servicios.js` (precios mensuales en pesos mexicanos) y `DATOS_TRANSFERENCIA`, pero no guarda pedidos ni reportes.

El estado de cada conversación vive en memoria y se pierde al reiniciar el bot.

## Atender desde tu WhatsApp (admin)

Desde un número de `NUMERO_ADMIN` le escribes al bot y él actúa. Puedes poner varios administradores separados por comas: a todos les llegan los avisos y cualquiera puede usar los comandos. Cuando uno aprueba, rechaza o resuelve un caso, a los demás les llega un aviso, y un caso ya cerrado no se puede aprobar dos veces. Cada pedido, reporte o chat tiene un número de caso (#12) que aparece en los avisos.

| Comando | Qué hace |
| --- | --- |
| `#12 texto` | Envía ese texto al cliente del caso 12 (cuentas, respuestas a reportes, lo que sea). Si mandas foto o archivo con `#12` en el pie, también se le reenvía |
| `/aprobar 12` | Confirma el pago por transferencia: crea la renta con una cuenta libre (o renueva), le manda los datos al cliente y pasa el pedido a Ventas |
| `/rechazar 12 motivo` | Le avisa al cliente que no se confirmó el pago; puede mandar otro comprobante |
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
