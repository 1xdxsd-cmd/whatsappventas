import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

// Único módulo que conoce Baileys. Si algún día se pasa a la API oficial de
// WhatsApp, se reemplaza este archivo y el resto del código queda igual.

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Pausa "escribiendo..." proporcional al largo del mensaje, entre 1 y 3 segundos,
// para que el número no se comporte como un bot que dispara mensajes al instante.
export function pausaParaTexto(texto) {
  return 1000 + Math.min(texto.length * 15, 2000);
}

function esChatPrivado(jid) {
  return jid?.endsWith('@s.whatsapp.net') || jid?.endsWith('@lid');
}

export function leerMensaje(mensaje) {
  const contenido = mensaje.message ?? {};
  return {
    texto:
      contenido.conversation ??
      contenido.extendedTextMessage?.text ??
      contenido.imageMessage?.caption ??
      contenido.documentMessage?.caption ??
      '',
    tieneComprobante: Boolean(contenido.imageMessage || contenido.documentMessage),
  };
}

export function crearConexion({ carpetaSesion, logger, alRecibir }) {
  let socket = null;
  let cola = Promise.resolve();
  let intentos = 0;

  function encolar(tarea) {
    cola = cola.then(tarea).catch((error) => logger.error({ err: error }, 'No se pudo enviar un mensaje'));
    return cola;
  }

  async function iniciar() {
    const { state, saveCreds } = await useMultiFileAuthState(carpetaSesion);
    const { version } = await fetchLatestBaileysVersion();

    socket = makeWASocket({
      version,
      auth: state,
      logger: logger.child({ modulo: 'baileys' }, { level: 'warn' }),
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        logger.info('Escanea este QR desde WhatsApp > Dispositivos vinculados');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        intentos = 0;
        logger.info('Conectado a WhatsApp');
      }
      if (connection === 'close') {
        const codigo = lastDisconnect?.error?.output?.statusCode;
        if (codigo === DisconnectReason.loggedOut) {
          logger.error(`La sesión se cerró desde el teléfono. Borra la carpeta "${carpetaSesion}" y vuelve a escanear el QR.`);
          return;
        }
        intentos += 1;
        const espera = Math.min(2 ** intentos * 1000, 60_000);
        logger.warn({ codigo, espera }, 'Conexión cerrada, reintentando');
        setTimeout(() => iniciar().catch((error) => logger.error({ err: error }, 'Fallo al reconectar')), espera);
      }
    });

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const mensaje of messages) {
        if (mensaje.key.fromMe || !esChatPrivado(mensaje.key.remoteJid) || !mensaje.message) continue;
        Promise.resolve(alRecibir(mensaje)).catch((error) => logger.error({ err: error }, 'Error al procesar un mensaje'));
      }
    });
  }

  function enviarTexto(jid, texto) {
    return encolar(async () => {
      await socket.sendPresenceUpdate('composing', jid);
      await esperar(pausaParaTexto(texto));
      await socket.sendPresenceUpdate('paused', jid);
      await socket.sendMessage(jid, { text: texto });
    });
  }

  function reenviar(jid, mensaje) {
    return encolar(() => socket.sendMessage(jid, { forward: mensaje }));
  }

  function marcarLeido(mensaje) {
    return socket.readMessages([mensaje.key]).catch(() => {});
  }

  return { iniciar, enviarTexto, reenviar, marcarLeido };
}
