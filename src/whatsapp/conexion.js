import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { rm } from 'node:fs/promises';
import QRCode from 'qrcode';
import qrcode from 'qrcode-terminal';

// Único módulo que conoce Baileys. Si algún día se pasa a la API oficial de
// WhatsApp, se reemplaza este archivo y el resto del código queda igual.

const ARCHIVO_QR = 'qr.png';

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Pausa "escribiendo..." proporcional al largo del mensaje, entre 1 y 3 segundos,
// para que el número no se comporte como un bot que dispara mensajes al instante.
export function pausaParaTexto(texto) {
  return 1000 + Math.min(texto.length * 15, 2000);
}

function esChatPrivado(jid) {
  return jid?.endsWith('@s.whatsapp.net') || jid?.endsWith('@lid');
}

// Número de teléfono de quien escribe. Con los ids "@lid" de WhatsApp, el
// número real puede venir en remoteJidAlt.
export function numeroDeChat(key) {
  const jid = [key.remoteJidAlt, key.remoteJid].find((j) => j?.endsWith('@s.whatsapp.net')) ?? key.remoteJid;
  return jid.split('@')[0];
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
    tieneArchivo: Boolean(
      contenido.imageMessage || contenido.documentMessage || contenido.videoMessage || contenido.audioMessage || contenido.stickerMessage,
    ),
  };
}

// El código se muestra como XXXX-XXXX, igual que lo pide WhatsApp en el teléfono.
export function formatearCodigo(codigo) {
  return codigo.match(/.{1,4}/g).join('-');
}

// Número en formato internacional sin "+": a los de 10 dígitos se les agrega
// el 52 de México, y se quita el "1" de celular viejo (521 + 10 dígitos),
// que WhatsApp ya no usa y con el que el código de vinculación sale mal.
export function normalizarNumero(numero) {
  let digitos = String(numero ?? '').replace(/\D/g, '');
  if (digitos.length === 10) digitos = `52${digitos}`;
  if (digitos.length === 13 && digitos.startsWith('521')) digitos = `52${digitos.slice(3)}`;
  return digitos.length >= 11 ? digitos : null;
}

// Para el código de vinculación se respeta el número tal como lo escribiste
// (con o sin el "1"): debe coincidir con el que WhatsApp tiene para esa cuenta.
export function normalizarNumeroBot(numero) {
  let digitos = String(numero ?? '').replace(/\D/g, '');
  if (digitos.length === 10) digitos = `52${digitos}`;
  return digitos.length >= 11 ? digitos : null;
}

/**
 * @param {{ carpetaSesion: string, numeroBot?: string | null, logger: object, alRecibir: Function }} opciones
 * Con `numeroBot`, la primera vinculación se hace con un código de 8 caracteres en vez del QR.
 */
export function crearConexion({ carpetaSesion, numeroBot = null, logger, alRecibir }) {
  let socket = null;
  let cola = Promise.resolve();
  let intentos = 0;
  let abierta = false;

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

    let codigoPedido = false;
    const actual = socket;

    socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      // Baileys avisa con "qr" cuando el socket está listo para vincularse.
      if (qr && numeroBot) {
        if (!codigoPedido) {
          codigoPedido = true;
          actual
            .requestPairingCode(numeroBot)
            .then((codigo) => {
              logger.info(
                `Código de vinculación para +${numeroBot}: ${formatearCodigo(codigo)}. Escríbelo en menos de un minuto en el teléfono de ese número: WhatsApp > Dispositivos vinculados > Vincular un dispositivo > Vincular con el número de teléfono. Si sale otro código después, usa siempre el último.`,
              );
            })
            .catch((error) => logger.error({ err: error }, 'No se pudo pedir el código de vinculación'));
        }
      } else if (qr) {
        logger.info(`Escanea este QR desde WhatsApp > Dispositivos vinculados. Si en la consola se ve mal, descarga ${ARCHIVO_QR} y ábrelo.`);
        qrcode.generate(qr, { small: true });
        // Copia como imagen, para bajarla desde el administrador de archivos del servidor.
        QRCode.toFile(ARCHIVO_QR, qr, { width: 400 }).catch((error) => logger.warn({ err: error }, 'No se pudo guardar el QR como imagen'));
      }
      if (connection === 'open') {
        rm(ARCHIVO_QR, { force: true }).catch(() => {});
        abierta = true;
        intentos = 0;
        logger.info('Conectado a WhatsApp');
      }
      if (connection === 'close') {
        abierta = false;
        const codigo = lastDisconnect?.error?.output?.statusCode;
        if (codigo === DisconnectReason.connectionReplaced) {
          // Si se reconecta, las dos copias se tumban una a la otra sin fin.
          logger.error('Otra copia del bot abrió la misma sesión de WhatsApp. Deja una sola corriendo y reinicia el bot.');
          return;
        }
        if (codigo === DisconnectReason.loggedOut || codigo === DisconnectReason.badSession) {
          // La sesión guardada ya no sirve: se borra y se pide vincular de nuevo
          // (QR o código), sin tener que entrar a borrar la carpeta a mano.
          logger.error(
            { codigo },
            codigo === DisconnectReason.loggedOut
              ? 'WhatsApp cerró la sesión (se desvinculó desde el teléfono o WhatsApp la expulsó). Hay que vincular de nuevo.'
              : 'La sesión guardada está dañada. Hay que vincular de nuevo.',
          );
          rm(carpetaSesion, { recursive: true, force: true })
            .then(() => iniciar())
            .catch((error) => logger.error({ err: error }, 'No se pudo reiniciar la vinculación'));
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

  // Busca el chat de WhatsApp de un teléfono guardado en la página. A los números
  // de 10 dígitos se les agrega el 52 de México; WhatsApp dice cuál es el correcto.
  async function buscarJid(telefono) {
    const numero = normalizarNumero(telefono);
    if (!numero) return null;
    const [resultado] = (await socket.onWhatsApp(numero)) ?? [];
    return resultado?.exists ? resultado.jid : null;
  }

  return { iniciar, enviarTexto, reenviar, marcarLeido, buscarJid, conectado: () => abierta };
}
