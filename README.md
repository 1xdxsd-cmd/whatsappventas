# whatsappventas

Agente de WhatsApp para vender cuentas y perfiles de streaming (Netflix, Disney+, HBO Max). Usa [Baileys](https://github.com/WhiskeySockets/Baileys) para conectarse a un número de WhatsApp y un servidor Node.js para atender a los clientes.

## Qué hace hoy (fase 1)

- Se conecta a WhatsApp escaneando un QR y guarda la sesión para no volver a escanear.
- Se reconecta solo si se cae la conexión.
- Responde con un menú: ver planes y precios, cómo comprar, hablar con un asesor.
- Toma el pedido (servicio + perfil o cuenta completa), envía los datos de transferencia y pide el comprobante.
- Te avisa a tu número personal de cada pedido nuevo, te reenvía el comprobante y te avisa cuando alguien pide un asesor.
- Con un asesor, el bot se queda callado hasta que el cliente escribe `menu`.

Los precios son mensuales, en pesos mexicanos, y están en `src/catalogo/servicios.js`. El estado de cada conversación vive en memoria y se pierde al reiniciar; la base de datos llega en la fase 3.

## Cómo correrlo

Requisitos: Node.js 20 o superior y un número de WhatsApp dedicado al bot.

```bash
npm install
cp .env.example .env   # y completa NUMERO_ADMIN, MONEDA y DATOS_TRANSFERENCIA
npm start
```

En la terminal aparece un QR. En el teléfono del número del bot abre WhatsApp > Dispositivos vinculados > Vincular un dispositivo y escanéalo. La sesión queda en la carpeta `auth/`, que nunca debe subirse a GitHub.

Para ver los logs más legibles: `npm start | npx pino-pretty`.

## Pruebas

```bash
npm test
```

## Para cuidar el número

Baileys no es oficial y WhatsApp puede bloquear números que se comportan como bots. Por eso el bot solo responde a quien le escribe, pone "escribiendo..." y espera 1 a 3 segundos antes de cada mensaje, y nunca envía mensajes masivos. Usa un número dedicado, no el personal.

## Estructura

| Carpeta | Qué hace |
| --- | --- |
| `src/whatsapp/` | Conexión con Baileys, QR, reconexión y cola de envío. Único lugar que conoce Baileys |
| `src/bot/` | Conversación: menú, catálogo, pedido y comprobante, como función pura y probada |
| `src/catalogo/` | Servicios y precios |
| `src/sesiones.js` | Estado de cada conversación (en memoria por ahora) |
