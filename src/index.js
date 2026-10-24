import pino from 'pino';
import { procesarMensaje } from './bot/conversacion.js';
import { config } from './config.js';
import { obtenerEstado, guardarEstado } from './sesiones.js';
import { crearConexion, leerMensaje } from './whatsapp/conexion.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

if (!config.jidAdmin) {
  logger.warn('NUMERO_ADMIN no está configurado: no te llegarán avisos de pedidos ni comprobantes.');
}

// Número legible del cliente para los avisos. Con los ids "@lid" de WhatsApp,
// el número real puede venir en remoteJidAlt.
function numeroCliente(key) {
  const jid = [key.remoteJidAlt, key.remoteJid].find((j) => j?.endsWith('@s.whatsapp.net')) ?? key.remoteJid;
  return jid.split('@')[0];
}

const conexion = crearConexion({
  carpetaSesion: config.carpetaSesion,
  logger,
  async alRecibir(mensaje) {
    const jid = mensaje.key.remoteJid;
    const resultado = procesarMensaje(leerMensaje(mensaje), obtenerEstado(jid), config);
    guardarEstado(jid, resultado.estado);

    await conexion.marcarLeido(mensaje);
    for (const respuesta of resultado.respuestas) {
      await conexion.enviarTexto(jid, respuesta);
    }

    if (resultado.aviso && config.jidAdmin) {
      await conexion.enviarTexto(config.jidAdmin, `🔔 Cliente ${numeroCliente(mensaje.key)}: ${resultado.aviso.texto}`);
      if (resultado.aviso.reenviar) await conexion.reenviar(config.jidAdmin, mensaje);
    }
  },
});

conexion.iniciar().catch((error) => {
  logger.error({ err: error }, 'No se pudo iniciar la conexión con WhatsApp');
  process.exit(1);
});
