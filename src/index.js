import pino from 'pino';
import { procesarMensaje } from './bot/conversacion.js';
import { SERVICIOS_BASE } from './catalogo/servicios.js';
import { config } from './config.js';
import { crearClientePagina } from './pagina/cliente.js';
import { textoMetodosPago } from './pagina/datos.js';
import { iniciarRecordatorios } from './recordatorios/programador.js';
import { obtenerEstado, guardarEstado } from './sesiones.js';
import { crearConexion, leerMensaje } from './whatsapp/conexion.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

if (!config.jidAdmin) {
  logger.warn('NUMERO_ADMIN no está configurado: no te llegarán avisos de pedidos ni comprobantes.');
}

const pagina = config.pagina ? crearClientePagina({ ...config.pagina, logger }) : null;
if (!pagina) {
  logger.warn('PAGINA_URL no está configurada: uso el catálogo de respaldo y no se guardan pedidos ni reportes.');
}

// Número del cliente para buscarlo en la página y para los avisos. Con los ids
// "@lid" de WhatsApp, el número real puede venir en remoteJidAlt.
function numeroCliente(key) {
  const jid = [key.remoteJidAlt, key.remoteJid].find((j) => j?.endsWith('@s.whatsapp.net')) ?? key.remoteJid;
  return jid.split('@')[0];
}

async function cargarContexto(telefono) {
  const contexto = {
    moneda: config.moneda,
    servicios: SERVICIOS_BASE,
    datosPago: config.datosTransferencia,
    cliente: null,
    rentas: [],
  };
  if (!pagina) return contexto;
  try {
    const [servicios, metodos, cliente] = await Promise.all([
      pagina.servicios(),
      pagina.metodosPago(),
      pagina.clientePorTelefono(telefono),
    ]);
    if (servicios.length > 0) contexto.servicios = servicios;
    const datosPago = textoMetodosPago(metodos);
    if (datosPago) contexto.datosPago = datosPago;
    if (cliente) {
      contexto.cliente = { id: cliente.id, nombre: cliente.name };
      // Orden fijo para que el número que elige el cliente no cambie entre mensajes.
      contexto.rentas = (await pagina.rentasActivas(cliente.id)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }
  } catch (error) {
    logger.error({ err: error }, 'No se pudo leer la página; uso el catálogo de respaldo');
  }
  return contexto;
}

// Ejecuta en la página lo que pidió la conversación y devuelve el estado
// con los datos que hay que recordar (por ejemplo, el id del pedido).
async function ejecutarAcciones(acciones, { estado, contexto, telefono, nombreWhatsApp }) {
  if (!pagina) return estado;
  for (const accion of acciones) {
    try {
      if (accion.tipo === 'crearPedido') {
        const notas = `Pedido por WhatsApp: ${accion.resumen}. Esperando comprobante.`;
        const pedido = await pagina.crearPedido({
          clientName: contexto.cliente?.nombre || nombreWhatsApp || telefono,
          platform: accion.servicio.platform,
          type: accion.servicio.type,
          phone: telefono,
          notes: notas,
        });
        estado = { ...estado, pedidoId: pedido.id, notas };
      }
      if (accion.tipo === 'comprobanteRecibido' && estado.pedidoId) {
        await pagina.actualizarPedido(estado.pedidoId, {
          notes: estado.notas.replace('Esperando comprobante.', 'Comprobante recibido por WhatsApp, revisar pago.'),
        });
      }
      if (accion.tipo === 'reportarCaida') {
        await pagina.reportarCaida({
          accountId: accion.renta.accountId || null,
          accountEmail: accion.renta.email || '',
          platform: accion.renta.platform,
          reason: accion.motivo,
          notes: `Reportada por WhatsApp: ${contexto.cliente?.nombre ?? ''} (${telefono})`,
        });
      }
    } catch (error) {
      logger.error({ err: error, accion: accion.tipo }, 'No se pudo guardar en la página');
    }
  }
  return estado;
}

const conexion = crearConexion({
  carpetaSesion: config.carpetaSesion,
  logger,
  async alRecibir(mensaje) {
    const jid = mensaje.key.remoteJid;
    const telefono = numeroCliente(mensaje.key);
    const contexto = await cargarContexto(telefono);
    const resultado = procesarMensaje(leerMensaje(mensaje), obtenerEstado(jid), contexto);
    const estado = await ejecutarAcciones(resultado.acciones ?? [], {
      estado: resultado.estado,
      contexto,
      telefono,
      nombreWhatsApp: mensaje.pushName,
    });
    guardarEstado(jid, estado);

    await conexion.marcarLeido(mensaje);
    for (const respuesta of resultado.respuestas) {
      await conexion.enviarTexto(jid, respuesta);
    }

    if (resultado.aviso && config.jidAdmin) {
      const quien = contexto.cliente ? `${contexto.cliente.nombre} (${telefono})` : telefono;
      await conexion.enviarTexto(config.jidAdmin, `🔔 Cliente ${quien}: ${resultado.aviso.texto}`);
      if (resultado.aviso.reenviar) await conexion.reenviar(config.jidAdmin, mensaje);
    }
  },
});

if (pagina) {
  iniciarRecordatorios({ pagina, conexion, archivo: config.archivoRecordatorios, jidAdmin: config.jidAdmin, logger });
}

conexion.iniciar().catch((error) => {
  logger.error({ err: error }, 'No se pudo iniciar la conexión con WhatsApp');
  process.exit(1);
});
