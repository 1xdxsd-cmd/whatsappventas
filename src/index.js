import pino from 'pino';
import { crearAtencionAdmin } from './admin/atencion.js';
import { crearRegistroDeCasos } from './admin/comandos.js';
import { procesarMensaje, textoCobroConCredito } from './bot/conversacion.js';
import { SERVICIOS_BASE } from './catalogo/servicios.js';
import { config } from './config.js';
import { crearClientePagina } from './pagina/cliente.js';
import { crearCobrosConCredito } from './pagina/credito.js';
import { mismoTelefono, textoMetodosPago } from './pagina/datos.js';
import { iniciarRecordatorios } from './recordatorios/programador.js';
import { obtenerEstado, guardarEstado } from './sesiones.js';
import { crearConexion, leerMensaje, numeroDeChat } from './whatsapp/conexion.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

if (!config.jidAdmin) {
  logger.warn('NUMERO_ADMIN no está configurado: no te llegarán avisos ni podrás usar los comandos de admin.');
}

if (process.env.NUMERO_BOT && !config.numeroBot) {
  logger.warn('NUMERO_BOT no parece un número válido; se usará el QR para vincular.');
}

const pagina = config.pagina ? crearClientePagina({ ...config.pagina, logger }) : null;
const cobros = pagina ? crearCobrosConCredito({ pagina, logger }) : null;
if (!pagina) {
  logger.warn('PAGINA_URL no está configurada: uso el catálogo de respaldo y no se guardan pedidos ni reportes.');
}

const casos = crearRegistroDeCasos();

async function cargarContexto(telefono) {
  const contexto = {
    moneda: config.moneda,
    negocio: config.negocio,
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
// los datos que hay que recordar, los mensajes que dependen del resultado
// (por ejemplo, el cobro con crédito), los avisos extra y el caso de admin.
async function ejecutarAcciones(acciones, { jid, estado, contexto, telefono, nombre }) {
  const respuestas = [];
  const avisos = [];
  let caso = estado.casoId ? casos.obtener(estado.casoId) : null;
  const datosCliente = { jid, telefono, nombre, cliente: contexto.cliente ?? { id: null, nombre } };

  for (const accion of acciones) {
    try {
      if (accion.tipo === 'crearPedido') {
        const notas = `Pedido por WhatsApp: ${accion.resumen}. Esperando comprobante.`;
        const pedido = pagina
          ? await pagina.crearPedido({
              clientName: nombre,
              platform: accion.servicio.platform,
              type: accion.servicio.type,
              phone: telefono,
              notes: notas,
            })
          : null;
        caso = casos.abrir({ ...datosCliente, tipo: 'pedido', servicio: accion.servicio, resumen: accion.resumen, renta: accion.renta ?? undefined, pedidoId: pedido?.id ?? null, notas });
        estado = { ...estado, casoId: caso.id, pedidoId: caso.pedidoId, notas };
      }
      if (accion.tipo === 'comprobanteRecibido') {
        if (pagina && estado.pedidoId) {
          await pagina.actualizarPedido(estado.pedidoId, {
            notes: estado.notas.replace('Esperando comprobante.', 'Comprobante recibido por WhatsApp, revisar pago.'),
          });
        }
      }
      if (accion.tipo === 'reportarCaida') {
        const reporte = pagina
          ? await pagina.reportarCaida({
              accountId: accion.renta.accountId || null,
              accountEmail: accion.renta.email || '',
              platform: accion.renta.platform,
              reason: accion.motivo,
              notes: `Reportada por WhatsApp: ${nombre} (${telefono})`,
            })
          : null;
        caso = casos.abrir({ ...datosCliente, tipo: 'reporte', plataforma: accion.renta.platform, resumen: accion.motivo, caidaId: reporte?.id ?? null });
      }
      if (accion.tipo === 'pagarConCredito' && cobros && contexto.cliente) {
        const resultado = await cobros.pagar({
          cliente: contexto.cliente,
          servicio: accion.servicio,
          resumen: accion.resumen,
          renta: accion.renta ?? undefined,
        });
        const textos = textoCobroConCredito(resultado, { resumen: accion.resumen, moneda: config.moneda });
        respuestas.push(...textos.respuestas);
        if (textos.estado) estado = textos.estado;
        // Pagado pero sin cuenta libre: Anthony le manda los datos con #N.
        if (resultado.ok && !resultado.renovacion && !resultado.cuenta) {
          caso = casos.abrir({ ...datosCliente, tipo: 'entrega', resumen: accion.resumen });
          avisos.push({ texto: `${textos.aviso.texto} Envíale los datos con #${caso.id} texto.`, caso });
        } else {
          avisos.push({ texto: textos.aviso.texto });
        }
      }
    } catch (error) {
      logger.error({ err: error, accion: accion.tipo }, 'No se pudo guardar en la página');
    }
  }
  return { estado, respuestas, avisos, caso };
}

const PISTAS = {
  pedido: (id) => `Cuando confirmes el pago: /aprobar ${id} (o /rechazar ${id} motivo).`,
  reporte: (id) => `Respóndele con #${id} texto y al terminar /resuelto ${id} texto.`,
};

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
    const esAdmin = config.numeroAdmin && mismoTelefono(numeroDeChat(mensaje.key), config.numeroAdmin);
    const tarea = esAdmin ? () => admin.manejar(mensaje) : () => atender(mensaje);
    return enOrdenPorChat(mensaje.key.remoteJid, tarea);
  },
});

const admin = crearAtencionAdmin({
  conexion,
  pagina,
  cobros,
  casos,
  estados: { obtener: obtenerEstado, guardar: guardarEstado },
  jidAdmin: config.jidAdmin,
  logger,
});

async function avisarAdmin(texto, mensajeParaReenviar) {
  if (!config.jidAdmin) return;
  await conexion.enviarTexto(config.jidAdmin, texto);
  if (mensajeParaReenviar) await conexion.reenviar(config.jidAdmin, mensajeParaReenviar);
}

async function atender(mensaje) {
  const jid = mensaje.key.remoteJid;
  const telefono = numeroDeChat(mensaje.key);
  const leido = leerMensaje(mensaje);
  const anterior = obtenerEstado(jid);
  const contexto = await cargarContexto(telefono);
  const nombre = contexto.cliente?.nombre || mensaje.pushName || telefono;
  const quien = `${nombre} (${telefono})`;

  await conexion.marcarLeido(mensaje);

  // Cliente en chat con Anthony: su mensaje le llega a él, salvo que escriba "menu".
  if (anterior.paso === 'asesor') {
    const caso = casos.abiertoDe(jid, 'asesor') ?? (admin.chatActivo && casos.obtener(admin.chatActivo)?.jid === jid ? casos.obtener(admin.chatActivo) : null);
    const resultado = procesarMensaje(leido, anterior, contexto);
    if (resultado.estado.paso === 'asesor') {
      if (!caso) {
        // Por ejemplo, tras reiniciar el bot: se abre un caso nuevo para no perder el mensaje.
        const nuevo = casos.abrir({ jid, telefono, nombre, tipo: 'asesor' });
        admin.abrirChat(nuevo);
        await avisarAdmin(`💬 #${nuevo.id} ${quien}: ${leido.texto || '(archivo)'}`, leido.tieneArchivo ? mensaje : null);
        return;
      }
      await avisarAdmin(`💬 #${caso.id} ${nombre}: ${leido.texto || '(archivo)'}`, leido.tieneArchivo ? mensaje : null);
      return;
    }
    if (caso) {
      admin.clienteSalio(caso);
      await avisarAdmin(`#${caso.id} ${nombre} volvió al bot (escribió "menu").`);
    }
  }

  const resultado = procesarMensaje(leido, anterior, contexto);
  const ejecutado = await ejecutarAcciones(resultado.acciones ?? [], { jid, estado: resultado.estado, contexto, telefono, nombre });
  guardarEstado(jid, ejecutado.estado);

  for (const respuesta of [...resultado.respuestas, ...ejecutado.respuestas]) {
    await conexion.enviarTexto(jid, respuesta);
  }

  if (resultado.aviso) {
    const caso = ejecutado.caso;
    const pista = caso && PISTAS[caso.tipo] ? ` ${PISTAS[caso.tipo](caso.id)}` : '';
    const numero = caso ? `#${caso.id} ` : '';
    await avisarAdmin(`🔔 ${numero}${quien}: ${resultado.aviso.texto}${pista}`, resultado.aviso.reenviar ? mensaje : null);
  }
  for (const aviso of ejecutado.avisos) {
    await avisarAdmin(`🔔 ${aviso.caso ? `#${aviso.caso.id} ` : ''}${quien}: ${aviso.texto}`);
  }

  // Entró al chat con asesor: se abre un caso y, si Anthony no atiende otro, queda activo.
  if (ejecutado.estado.paso === 'asesor' && anterior.paso !== 'asesor') {
    const caso = casos.abrir({ jid, telefono, nombre, tipo: 'asesor' });
    const activo = admin.abrirChat(caso);
    await avisarAdmin(
      activo
        ? `💬 Chat #${caso.id} con ${nombre} activo: lo que me escribas le llega. */fin* para terminar.`
        : `💬 ${nombre} espera un asesor (#${caso.id}). Escribe */chat ${caso.id}* para atenderlo o #${caso.id} texto para responderle.`,
    );
  }
}

if (pagina) {
  // Prueba al arrancar para saber de inmediato si PAGINA_URL es correcta.
  pagina
    .servicios()
    .then((servicios) => logger.info({ url: config.pagina.url, servicios: servicios.length }, 'Conectado a la página'))
    .catch((error) =>
      logger.error(
        { url: config.pagina.url, causa: error.cause?.code ?? error.cause?.errors?.[0]?.code ?? error.message },
        'No me pude conectar a la página. Revisa PAGINA_URL, el puerto y que la página esté encendida.',
      ),
    );
  iniciarRecordatorios({ pagina, conexion, archivo: config.archivoRecordatorios, jidAdmin: config.jidAdmin, negocio: config.negocio, logger });
}

conexion.iniciar().catch((error) => {
  logger.error({ err: error }, 'No se pudo iniciar la conexión con WhatsApp');
  process.exit(1);
});
