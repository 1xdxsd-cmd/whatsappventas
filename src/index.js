import pino from 'pino';
import { crearAtencionAdmin } from './admin/atencion.js';
import { crearRegistroDeCasos } from './admin/comandos.js';
import { lugaresNecesarios, opcionesDeReemplazo, textoOpcionesDeReemplazo } from './admin/reemplazo.js';
import { procesarMensaje, recordatorioAlEscribir, textoCambioDeClave, textoCobroConCredito } from './bot/conversacion.js';
import { ejecutarAccion } from './ia/acciones.js';
import { crearAsistente } from './ia/asistente.js';
import { esPregunta, preguntaFinal, textoDatosDeAcceso, textoMisCuentas } from './ia/conocimiento.js';
import { SERVICIOS_BASE } from './catalogo/servicios.js';
import { config } from './config.js';
import { crearClientePagina } from './pagina/cliente.js';
import { crearCobrosConCredito } from './pagina/credito.js';
import { mismoTelefono, textoMetodosPago } from './pagina/datos.js';
import { iniciarRecordatorios } from './recordatorios/programador.js';
import { obtenerEstado, guardarEstado } from './sesiones.js';
import { crearConexion, leerMensaje, numeroDeChat } from './whatsapp/conexion.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

if (config.numerosAdmin.length === 0) {
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
const asistente = config.ia ? crearAsistente({ ...config.ia, logger }) : null;
asistente?.precalentar();

async function cargarContexto(telefono, jid) {
  const contexto = {
    moneda: config.moneda,
    negocio: config.negocio,
    enlacePagina: config.enlacePagina,
    servicios: SERVICIOS_BASE,
    datosPago: config.datosTransferencia,
    cliente: null,
    rentas: [],
    paginaCaida: false,
    reporteEnCurso: null,
  };
  // El cliente elige a quién pagar; solo esa persona recibe sus pagos.
  contexto.cobradores = config.cobradores.map(({ nombre, datos }) => ({ nombre, datos }));
  // Un reporte a la vez por cliente.
  const reporte = jid ? casos.abiertoDe(jid, 'reporte') : null;
  if (reporte) contexto.reporteEnCurso = { plataforma: reporte.plataforma, email: reporte.renta?.email };
  if (!pagina) return contexto;
  try {
    const [servicios, metodos, cliente] = await Promise.all([
      pagina.servicios(),
      pagina.metodosPago(),
      pagina.clientePorTelefono(telefono),
    ]);
    if (servicios.length > 0) contexto.servicios = servicios;
    const datosPago = textoMetodosPago(metodos);
    if (datosPago && !config.datosTransferenciaEnEnv && config.cobradores.length === 0) contexto.datosPago = datosPago;
    if (cliente) {
      contexto.cliente = { id: cliente.id, nombre: cliente.name, usuario: cliente.username, saldo: Number(cliente.balance) || 0 };
      // Orden fijo para que el número que elige el cliente no cambie entre mensajes.
      contexto.rentas = (await pagina.rentasActivas(cliente.id)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      // También cuenta un reporte que se hizo en la página o antes de reiniciar el bot.
      if (!contexto.reporteEnCurso) {
        const caidas = await pagina.caidas().catch(() => []);
        const abierta = caidas.find((f) => f.status !== 'resuelto' && f.affectedClients?.some((a) => a.clientId === cliente.id));
        if (abierta) contexto.reporteEnCurso = { plataforma: abierta.platform, email: abierta.accountEmail };
      }
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
// Correo y contraseña de una cuenta del cliente, como los da su página
// (solo al número registrado; nunca de cuentas suspendidas).
async function datosDeAcceso(contexto, numero) {
  if (!contexto.cliente) return 'Para darte los datos de acceso necesito que tu número esté registrado. Escribe *asesor* y te ayudamos. 🙂';
  const renta = contexto.rentas[Number(numero) - 1];
  if (!renta) return textoMisCuentas(contexto.rentas, contexto.servicios, config.moneda);
  let cuenta = null;
  try {
    cuenta = (await pagina.cuentas()).find((c) => c.id === renta.accountId && !c.suspended) ?? null;
  } catch (error) {
    logger.warn({ err: error }, 'No se pudieron leer las cuentas para dar los datos de acceso');
  }
  if (!cuenta) return 'No pude consultar los datos de esa cuenta en este momento. 😕 Escribe *asesor* y te los pasamos.';
  return textoDatosDeAcceso(renta, cuenta);
}

async function ejecutarAcciones(acciones, { jid, estado, contexto, telefono, nombre }) {
  const respuestas = [];
  const avisos = [];
  let caso = estado.casoId ? casos.obtener(estado.casoId) : null;
  const datosCliente = { jid, telefono, nombre, cliente: contexto.cliente ?? { id: null, nombre } };
  const delPago = (accion) => ({
    numerosDelPago: config.cobradores[accion.cobrador]?.numeros ?? null,
    nombreDelPago: config.cobradores[accion.cobrador]?.nombre ?? null,
  });

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
        caso = casos.abrir({ ...datosCliente, tipo: 'pedido', ...delPago(accion), servicio: accion.servicio, resumen: accion.resumen, renta: accion.renta ?? undefined, pedidoId: pedido?.id ?? null, notas });
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
        caso = casos.abrir({ ...datosCliente, tipo: 'reporte', plataforma: accion.renta.platform, renta: accion.renta, resumen: accion.motivo, caidaId: reporte?.id ?? null });
        // Para que el admin elija con qué cuenta reemplazarla.
        const cuentas = pagina ? await pagina.cuentas().catch(() => []) : [];
        caso.necesarios = lugaresNecesarios(cuentas, accion.renta);
        caso.opciones = opcionesDeReemplazo(cuentas, accion.renta);
      }
      if (accion.tipo === 'crearRecarga' && contexto.cliente) {
        caso = casos.abrir({ ...datosCliente, tipo: 'recarga', ...delPago(accion), monto: accion.monto, resumen: accion.resumen });
        estado = { ...estado, casoId: caso.id };
      }
      if (accion.tipo === 'cambiarClave' && contexto.cliente) {
        let ok = false;
        try {
          await pagina.cambiarClave(contexto.cliente.id, accion.clave);
          ok = true;
        } catch (error) {
          // Sin el detalle del pedido, para que la contraseña no quede en el log.
          logger.error({ estado: error.estado }, 'No se pudo cambiar la contraseña en la página');
        }
        const textos = textoCambioDeClave(ok, contexto.cliente);
        respuestas.push(...textos.respuestas);
        avisos.push({ texto: textos.aviso.texto });
        if (textos.estado) estado = textos.estado;
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

// Con IA el cliente contesta con sus palabras: las listas no le piden números.
// (El pago con crédito sí se confirma con el número.)
function sinPedirNumeros(texto) {
  return texto
    .replace(/¿En qué te ayudo\? Responde con el número:/, '¿En qué te ayudo? Dime qué necesitas:')
    .replace(/Responde con el número[^\n]*/g, 'Dime cuál quieres, o escribe *menu* para volver.');
}

// Lo que el cliente tiene en curso, para que la IA pueda contestarle "¿y mi pago?".
function pendientesDe(jid, contexto) {
  const nombres = {
    pedido: (c) => `Pedido esperando que ${c.nombreDelPago ?? 'un admin'} apruebe el pago (aún NO está confirmado): ${c.resumen}`,
    recarga: (c) => `Recarga esperando que ${c.nombreDelPago ?? 'un admin'} apruebe el pago (aún NO está confirmada ni sumada): ${c.resumen}`,
    entrega: (c) => `Pagado, esperando que le envíen los datos: ${c.resumen}`,
    reporte: (c) => `Reporte de cuenta caída en revisión (${c.plataforma}): ${c.resumen}`,
  };
  const pendientes = casos
    .abiertos()
    .filter((c) => c.jid === jid && nombres[c.tipo])
    .map((c) => nombres[c.tipo](c));
  if (contexto.reporteEnCurso && !pendientes.some((p) => p.startsWith('Reporte'))) {
    pendientes.push(`Reporte de cuenta caída en revisión (${contexto.reporteEnCurso.plataforma})`);
  }
  return pendientes;
}

// Pasos donde, con IA, el cliente platica con ella: el menú y sus listas. En los
// demás (comprobante, motivo del reporte, contraseña nueva, monto de recarga,
// asesor) el bot espera esa respuesta concreta.
function cobradorNombrado(texto, cobradores = []) {
  const limpio = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const dicho = limpio(texto);
  const nombrados = cobradores.filter((c) => new RegExp(`\\b${limpio(c.nombre).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(dicho));
  return nombrados.length === 1 ? nombrados[0].nombre : null;
}

const archivosSueltos = new Map(); // jid -> { mensaje, hora }: última foto mandada fuera de un pago
const FOTO_VALE_POR = 30 * 60 * 1000;

const PASOS_DE_PLATICA = ['inicio', 'menu', 'catalogo', 'tipo', 'renovar', 'reporte', 'forma-pago', 'elegir-cobrador', 'cuenta'];

const PISTAS = {
  pedido: ({ id }) => `Cuando confirmes el pago: /aprobar ${id} (o /rechazar ${id} motivo).`,
  recarga: ({ id }) => `Cuando confirmes el pago: /aprobar ${id} suma el crédito (o /rechazar ${id} motivo).`,
  reporte: (caso) => `\n\n${textoOpcionesDeReemplazo(caso)}`,
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
  codigoVinculacion: config.codigoVinculacion,
  logger,
  alRecibir(mensaje) {
    const numeroAdmin = config.numerosAdmin.find((n) => mismoTelefono(numeroDeChat(mensaje.key), n));
    // Los comandos de todos los admins van en una sola fila, para que dos no
    // tomen o aprueben el mismo caso al mismo tiempo.
    if (numeroAdmin) return enOrdenPorChat('admins', () => admin.manejar(mensaje, numeroAdmin));
    return enOrdenPorChat(mensaje.key.remoteJid, () => atender(mensaje));
  },
});

const admin = crearAtencionAdmin({
  conexion,
  pagina,
  cobros,
  casos,
  estados: { obtener: obtenerEstado, guardar: guardarEstado },
  logger,
  moneda: config.moneda,
  avisarAdmins: (texto, { excepto } = {}) => avisarAdmin(texto, null, { excepto }),
});

// WhatsApp dice cuál es el chat real de cada admin (con o sin el "1" de celular).
const jidsAdmin = new Map();
async function obtenerJidAdmin(numero) {
  if (!jidsAdmin.has(numero)) {
    const jid = await conexion.buscarJid(numero).catch(() => null);
    if (!jid) {
      logger.warn({ numero }, 'WhatsApp no reconoce este número de NUMERO_ADMIN; revisa que esté bien escrito');
      return `${numero}@s.whatsapp.net`;
    }
    jidsAdmin.set(numero, jid);
  }
  return jidsAdmin.get(numero);
}

// Avisa a todos los admins (menos al número `excepto`), o solo al chat `soloA`.
// `soloNumeros` es para los pagos que van a la cuenta de una persona.
async function avisarAdmin(texto, mensajeParaReenviar, { excepto = null, soloA = null, soloNumeros = null } = {}) {
  const numeros = soloNumeros?.length ? soloNumeros : config.numerosAdmin.filter((n) => n !== excepto);
  const destinos = soloA ? [soloA] : await Promise.all(numeros.map(obtenerJidAdmin));
  for (const jid of destinos) {
    await conexion.enviarTexto(jid, texto);
    if (mensajeParaReenviar) await conexion.reenviar(jid, mensajeParaReenviar);
  }
}

async function atender(mensaje) {
  const jid = mensaje.key.remoteJid;
  const telefono = numeroDeChat(mensaje.key);
  const leido = leerMensaje(mensaje);
  const anterior = obtenerEstado(jid);
  const contexto = await cargarContexto(telefono, jid);
  const nombre = contexto.cliente?.nombre || mensaje.pushName || telefono;
  const quien = `${nombre} (${telefono})`;

  await conexion.marcarLeido(mensaje);

  // Cliente en chat con Anthony: su mensaje le llega a él, salvo que escriba "menu".
  if (anterior.paso === 'asesor') {
    const guardado = anterior.casoId ? casos.obtener(anterior.casoId) : null;
    const caso = guardado?.abierto && guardado.jid === jid ? guardado : casos.abiertoDe(jid, 'asesor');
    const resultado = procesarMensaje(leido, anterior, contexto);
    const archivo = leido.tieneArchivo ? mensaje : null;
    if (resultado.estado.paso === 'asesor') {
      if (!caso) {
        // Por ejemplo, tras reiniciar el bot: se abre un caso nuevo para no perder el mensaje.
        const nuevo = casos.abrir({ jid, telefono, nombre, tipo: 'asesor' });
        await avisarAdmin(`💬 #${nuevo.id} ${quien}: ${leido.texto || '(archivo)'}\nPara atenderlo: */tomar ${nuevo.id}*`, archivo);
        return;
      }
      // Si ya lo tomó un admin, solo le llega a ese; si no, a todos.
      const pista = caso.admin ? '' : `\nPara atenderlo: */tomar ${caso.id}*`;
      await avisarAdmin(`💬 #${caso.id} ${nombre}: ${leido.texto || '(archivo)'}${pista}`, archivo, { soloA: caso.admin ?? null });
      return;
    }
    if (caso) {
      const quienAtendia = admin.clienteSalio(caso);
      await avisarAdmin(`#${caso.id} ${nombre} volvió al bot (escribió "menu").`, null, { soloA: quienAtendia });
    }
  }

  // Con IA, el cliente platica con ella y el menú de números no se muestra:
  // la IA da la información y, con una etiqueta ([[renovar:1:transferencia]]),
  // el bot hace la acción por detrás con las mismas reglas del menú. Si la IA
  // no responde, queda el menú de números de siempre.
  let resultado = null;
  let accionDeIA = null;
  if (leido.tieneArchivo && anterior.paso === 'pago') archivosSueltos.delete(jid);
  if (asistente && PASOS_DE_PLATICA.includes(anterior.paso) && (leido.texto.trim() || leido.tieneArchivo)) {
    conexion.escribiendo(jid);
    contexto.pendientes = pendientesDe(jid, contexto);
    // Una foto fuera de un pago (casi siempre un comprobante antes de pedir los
    // datos) se le cuenta a la IA y se guarda: si la IA genera el pedido, se
    // toma como su comprobante.
    if (leido.tieneArchivo) archivosSueltos.set(jid, { mensaje, hora: Date.now() });
    const dicho = leido.tieneArchivo
      ? `(El cliente mandó una foto o archivo${leido.texto.trim() ? ` con el texto: "${leido.texto.trim()}"` : ''}. No la puedes ver.)`
      : leido.texto.trim();
    // La IA ya tenía la compra lista y solo faltaba a quién pagar: si el cliente
    // lo dice ("Anthony por favor"), se hace sin volver a preguntarle a la IA.
    const elegido = anterior.accionPendiente && !leido.tieneArchivo ? cobradorNombrado(leido.texto, contexto.cobradores) : null;
    const directo = elegido ? ejecutarAccion({ ...anterior.accionPendiente, datos: [...anterior.accionPendiente.datos, elegido] }, contexto, procesarMensaje) : null;
    if (directo && !directo.error) {
      asistente.anotar(jid, 'user', dicho);
      resultado = directo;
      accionDeIA = anterior.accionPendiente.nombre;
    }
    const ia = resultado ? null : await asistente.conversar(jid, dicho, contexto);
    if (ia) {
      // Mostrar cuentas o pasar datos de acceso no son flujos del menú: se
      // contestan aquí, con los datos reales de la página.
      if (ia.accion?.nombre === 'mis-cuentas') {
        const lista = textoMisCuentas(contexto.rentas, contexto.servicios, config.moneda);
        await conexion.enviarTexto(jid, lista);
        // De lo que dijo la IA solo va la pregunta: el resto suele ser "aquí tienes:".
        const pregunta = preguntaFinal(ia.texto);
        if (pregunta) await conexion.enviarTexto(jid, pregunta);
        asistente.anotar(jid, 'assistant', lista);
        guardarEstado(jid, { paso: 'menu' });
        return;
      }
      if (ia.accion?.nombre === 'datos') {
        if (ia.texto) await conexion.enviarTexto(jid, ia.texto);
        await conexion.enviarTexto(jid, await datosDeAcceso(contexto, ia.accion.datos[0]));
        asistente.anotar(jid, 'assistant', 'Le envié los datos de acceso de esa cuenta.');
        guardarEstado(jid, { paso: 'menu' });
        return;
      }
      // La acción se prueba antes de mandar lo que dijo la IA, para no decir
      // "¡Listo!" y luego "no pude".
      const hecho = ia.accion ? ejecutarAccion(ia.accion, contexto, procesarMensaje) : null;
      let siguiente = { paso: 'menu' };
      if (!hecho?.error) {
        if (ia.texto) await conexion.enviarTexto(jid, ia.texto);
      } else if (hecho.faltaCobrador) {
        const pregunta = `¿A quién le haces la transferencia: ${contexto.cobradores.map((c) => `*${c.nombre}*`).join(' o ')}? 🙌`;
        await conexion.enviarTexto(jid, ia.texto && esPregunta(ia.texto) ? ia.texto : pregunta);
        asistente.anotar(jid, 'system', 'Falta a quién le paga; el cliente lo va a decir.');
        siguiente = { paso: 'menu', accionPendiente: ia.accion };
      } else {
        logger.warn({ accion: ia.accion, error: hecho.error }, 'La IA pidió una acción que no se pudo hacer');
        asistente.anotar(jid, 'system', `No se pudo hacer la acción: ${hecho.error}. Pregúntale al cliente lo que falta.`);
        await conexion.enviarTexto(jid, ia.texto && esPregunta(ia.texto) ? ia.texto : 'Perdón, no pude completarlo. 😕 ¿Me confirmas qué quieres y cómo pagas?');
      }
      if (!hecho || hecho.error) {
        guardarEstado(jid, siguiente);
        if (anterior.paso === 'inicio') {
          for (const recordatorio of recordatorioAlEscribir(contexto.rentas)) await conexion.enviarTexto(jid, recordatorio);
        }
        return;
      }
      resultado = hecho;
      accionDeIA = ia.accion.nombre;
    }
  } else if (asistente) {
    asistente.anotar(jid, 'user', leido.texto.trim() || '(envió un archivo)');
  }

  resultado ??= procesarMensaje(leido, anterior, contexto);
  const ejecutado = await ejecutarAcciones(resultado.acciones ?? [], { jid, estado: resultado.estado, contexto, telefono, nombre });
  guardarEstado(jid, ejecutado.estado);

  for (const original of [...resultado.respuestas, ...ejecutado.respuestas]) {
    const respuesta = asistente && ejecutado.estado.paso !== 'forma-pago' ? sinPedirNumeros(original) : original;
    await conexion.enviarTexto(jid, respuesta);
    asistente?.anotar(jid, 'assistant', respuesta);
  }

  // Si la IA lo pasó con un asesor, que el asesor sepa qué contó.
  if (accionDeIA === 'asesor' && resultado.aviso) {
    const dijo = asistente.loQueDijo(jid);
    if (dijo.length) resultado.aviso.texto += `\nLo que contó: ${dijo.map((t) => `"${t}"`).join(' / ')}`;
  }

  if (resultado.aviso) {
    const caso = ejecutado.caso;
    const pista = caso && PISTAS[caso.tipo] ? ` ${PISTAS[caso.tipo](caso)}` : '';
    const numero = caso ? `#${caso.id} ` : '';
    await avisarAdmin(`🔔 ${numero}${quien}: ${resultado.aviso.texto}${pista}`, resultado.aviso.reenviar ? mensaje : null, {
      soloNumeros: caso?.numerosDelPago ?? null,
    });
  }
  for (const aviso of ejecutado.avisos) {
    await avisarAdmin(`🔔 ${aviso.caso ? `#${aviso.caso.id} ` : ''}${quien}: ${aviso.texto}`);
  }

  // Entró al chat con asesor: se abre un caso, el cliente espera y el primer
  // admin que escriba /tomar lo atiende.
  if (ejecutado.estado.paso === 'asesor' && anterior.paso !== 'asesor') {
    const caso = casos.abrir({ jid, telefono, nombre, tipo: 'asesor' });
    guardarEstado(jid, { ...ejecutado.estado, casoId: caso.id });
    await avisarAdmin(`💬 ${quien} espera un asesor (#${caso.id}). Escribe */tomar ${caso.id}* para atenderlo.`);
  }

  // Mandó la foto antes de que la IA generara el pedido: ahora que el pedido
  // espera comprobante, esa foto es el comprobante.
  const suelto = archivosSueltos.get(jid);
  if (suelto && ejecutado.estado.paso === 'pago' && suelto.mensaje !== mensaje) {
    archivosSueltos.delete(jid);
    if (Date.now() - suelto.hora < FOTO_VALE_POR) await atender(suelto.mensaje);
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
  iniciarRecordatorios({ pagina, conexion, archivo: config.archivoRecordatorios, avisarAdmin, negocio: config.negocio, logger });
}

conexion.iniciar().catch((error) => {
  logger.error({ err: error }, 'No se pudo iniciar la conexión con WhatsApp');
  process.exit(1);
});
