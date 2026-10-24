# whatsappventas

Agente de WhatsApp para vender cuentas y perfiles de streaming (Netflix, Disney+, HBO Max). Usa [Baileys](https://github.com/WhiskeySockets/Baileys) para conectarse a un número de WhatsApp y un servidor Node.js para atender a los clientes.

## Qué hace hoy (fase 1)

- Se conecta a WhatsApp escaneando un QR y guarda la sesión para no volver a escanear.
- Se reconecta solo si se cae la conexión.
- Responde con un menú: ver planes y precios, renovar una cuenta, reportar una cuenta que no funciona, cómo comprar, hablar con un asesor.
- Toma el pedido (servicio + perfil o cuenta completa), envía los datos de transferencia y pide el comprobante.
- Te avisa a tu número personal de cada pedido nuevo, te reenvía el comprobante y te avisa cuando alguien pide un asesor.
- Con un asesor, el bot se queda callado hasta que el cliente escribe `menu`.

## Conexión con tu página (StreamRent)

Con `PAGINA_URL`, `PAGINA_USUARIO` y `PAGINA_CLAVE` en el `.env`, el bot entra a tu página como administrador y:

- Toma de **Servicios** el catálogo y los precios (solo los activos), y de **Métodos de pago** los datos de transferencia.
- Reconoce al cliente por el teléfono guardado en su ficha (compara los últimos 10 dígitos) y lo saluda por su nombre.
- Guarda cada pedido en **Pedidos**, con el teléfono y una nota, y la actualiza cuando llega el comprobante.
- Deja los reportes en **Cuentas caídas**: el cliente elige una de sus rentas activas y escribe qué pasa.
- Manda **recordatorios de vencimiento** 3 días antes, 1 día antes y el mismo día, solo entre 10 am y 8 pm de México, en un mensaje por cliente. El cliente responde *renovar*, elige la cuenta y paga el precio de su renta. Te llega un resumen de a quién se avisó. Los avisos enviados se guardan en `datos/recordatorios.json` para no repetirlos.

Si la página no responde o no está configurada, el bot sigue funcionando con el catálogo de `src/catalogo/servicios.js` (precios mensuales en pesos mexicanos) y `DATOS_TRANSFERENCIA`, pero no guarda pedidos ni reportes.

El estado de cada conversación vive en memoria y se pierde al reiniciar el bot.

## Cómo correrlo

Requisitos: Node.js 20 o superior y un número de WhatsApp dedicado al bot.

```bash
npm install
cp .env.example .env   # y completa NUMERO_ADMIN, MONEDA y DATOS_TRANSFERENCIA
npm start
```

Hay dos formas de vincular el número del bot:

- **Con QR** (si `NUMERO_BOT` está vacío): en la terminal aparece un QR. En el teléfono del bot abre WhatsApp > Dispositivos vinculados > Vincular un dispositivo y escanéalo.
- **Con código de 8 caracteres** (si pones `NUMERO_BOT` en el `.env`): en la terminal aparece un código como `ABCD-1234`. En el teléfono del bot abre WhatsApp > Dispositivos vinculados > Vincular un dispositivo > Vincular con el número de teléfono, y escríbelo. Sirve cuando no puedes escanear, por ejemplo si el servidor no tiene pantalla.

Solo se vincula una vez. La sesión queda en la carpeta `auth/`, que nunca debe subirse a GitHub.

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
