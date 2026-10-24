import pino from 'pino';
import { procesarMensaje, textoCobroConCredito } from './bot/conversacion.js';
import { SERVICIOS_BASE } from './catalogo/servicios.js';
import { config } from './config.js';
import { crearClientePagina } from './pagina/cliente.js';
import { crearCobrosConCredito } from './pagina/credito.js';
import { textoMetodosPago } from './pagina/datos.js';
import { iniciarRecordatorios } from './recordatorios/programador.js';
import { obtenerEstado, guardarEstado } from './sesiones.js';
import { crearConexion, leerMensaje } from './whatsapp/conexion.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

if (!config.jidAdmin) {
  logger.warn('NUMERO_ADMIN no está configurado: no te llegarán avisos de pedidos ni comprobantes.');
}

if (process.env.NUMERO_BOT && !config.numeroBot) {
  logger.warn('NUMERO_BOT no parece un número válido; se usará el QR para vincular.');
}

const pagina = config.pagina ? crearClientePagina({ ...config.pagina, logger }) : null;
const cobros = pagina ? crearCobrosConCredito({ pagina, logger }) : null;
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
    paginaCaida: false,
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
      contexto.cliente = { id: cliente.id, nombre: cliente.name, saldo: Number(cliente.balance) || 0 };
      // Orden fijo para que el número que elige el cliente no cambie entre mensajes.
      contexto.rentas = (await pagina.rentasActivas(cliente.id)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }
  } catch (error) {
    // Sin la página no se sabe si el cliente está registrado: la conversación
    // lo trata distinto a "no registrado".
    contexto.paginaCaida = true;
    logger.error({ err: error, url: config.pagina.url }, 'No se pudo leer la página; uso el catálogo de respaldo');
  }
  return contexto;
}

// Ejecuta en la página lo que pidió la conversación. Devuelve el estado con
// los datos que hay que recordar (por ejemplo, el id del pedido) y los
// mensajes y avisos que dependen del resultado (por ejemplo, el cobro con crédito).
async function ejecutarAcciones(acciones, { estado, contexto, telefono, nombreWhatsApp }) {
  const respuestas = [];
  const avisos = [];
  if (!pagina) return { estado, respuestas, avisos };
  for (const accion of acciones) {
    if (accion.tipo === 'pagarConCredito') {
      if (!contexto.cliente) continue;
      const resultado = await cobros.pagar({
        cliente: contexto.cliente,
        servicio: accion.servicio,
        resumen: accion.resumen,
        renta: accion.renta ?? undefined,
      });
      const textos = textoCobroConCredito(resultado, { resumen: accion.resumen, moneda: config.moneda });
      respuestas.push(...textos.respuestas);
      avisos.push(textos.aviso);
      if (textos.estado) estado = textos.estado;
      continue;
    }
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
  return { estado, respuestas, avisos };
}

// Los mensajes de un mismo chat se procesan de uno en uno, para que dos
// mensajes seguidos no avancen la conversación (o cobren) dos veces a la vez.
const colasPorChat = new Map();
function enOrdenPorChat(jid, tarea) {
  const anterior = colasPorChat.get(jid) ?? Promise.resolve();
  const actual = anterior.then(tarea, tarea);
  colasPorChat.set(jid, actual);
  actual.finally(() => {
    if (colasPorChat.get(jid) === actual) colasPorChat.delete(jid);
  });
  return actual;
}

const conexion = crearConexion({
  carpetaSesion: config.carpetaSesion,
  numeroBot: config.numeroBot,
  logger,
  alRecibir(mensaje) {
    return enOrdenPorChat(mensaje.key.remoteJid, () => atender(mensaje));
  },
});

async function atender(mensaje) {
  const jid = mensaje.key.remoteJid;
  const telefono = numeroCliente(mensaje.key);
  const contexto = await cargarContexto(telefono);
  const resultado = procesarMensaje(leerMensaje(mensaje), obtenerEstado(jid), contexto);
  const ejecutado = await ejecutarAcciones(resultado.acciones ?? [], {
    estado: resultado.estado,
    contexto,
    telefono,
    nombreWhatsApp: mensaje.pushName,
  });
  guardarEstado(jid, ejecutado.estado);

  await conexion.marcarLeido(mensaje);
  for (const respuesta of [...resultado.respuestas, ...ejecutado.respuestas]) {
    await conexion.enviarTexto(jid, respuesta);
  }

  const avisos = [resultado.aviso, ...ejecutado.avisos].filter(Boolean);
  if (avisos.length > 0 && config.jidAdmin) {
    const quien = contexto.cliente ? `${contexto.cliente.nombre} (${telefono})` : telefono;
    for (const aviso of avisos) {
      await conexion.enviarTexto(config.jidAdmin, `🔔 Cliente ${quien}: ${aviso.texto}`);
      if (aviso.reenviar) await conexion.reenviar(config.jidAdmin, mensaje);
    }
  }
}

if (pagina) {
  // Prueba al arrancar para saber de inmediato si PAGINA_URL es correcta.
  pagina
    .servicios()
    .then((servicios) => logger.info({ url: config.pagina.url, servicios: servicios.length }, 'Conectado a la página'))
    .catch((error) =>
      logger.error(
        { url: config.pagina.url, causa: error.cause?.code ?? error.message },
        'No me pude conectar a la página. Revisa PAGINA_URL, el puerto y que la página esté encendida.',
      ),
    );
  iniciarRecordatorios({ pagina, conexion, archivo: config.archivoRecordatorios, jidAdmin: config.jidAdmin, logger });
}

conexion.iniciar().catch((error) => {
  logger.error({ err: error }, 'No se pudo iniciar la conexión con WhatsApp');
  process.exit(1);
});
