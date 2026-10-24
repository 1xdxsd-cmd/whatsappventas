import { formatearPrecio, nombrePlataforma } from '../catalogo/servicios.js';
import { leerMensaje } from '../whatsapp/conexion.js';
import { AYUDA, interpretarComando, textoCasos } from './comandos.js';

// Atiende los mensajes que Anthony le escribe al bot: comandos y chat con
// clientes que pidieron un asesor.
export function crearAtencionAdmin({ conexion, pagina, cobros, casos, estados, logger, moneda = '$' }) {
  let chatActivo = null; // número de caso cuyo cliente recibe lo que escribe Anthony
  let chatAdmin = null; // se responde en el mismo chat desde el que escribió Anthony

  const responder = (texto) => conexion.enviarTexto(chatAdmin, texto);

  async function enviarAlCliente(caso, mensaje, texto) {
    if (texto) await conexion.enviarTexto(caso.jid, texto);
    // Fotos, audios o documentos se reenvían tal cual.
    if (mensaje && leerMensaje(mensaje).tieneArchivo) await conexion.reenviar(caso.jid, mensaje);
  }

  function devolverAlBot(caso) {
    estados.guardar(caso.jid, { paso: 'menu' });
  }

  async function aprobarRecarga(caso) {
    if (!pagina) return responder(`El bot no está conectado a la página. Súmale el crédito a mano y avísale con #${caso.id} texto.`);
    let saldo;
    try {
      ({ balance: saldo } = await pagina.ajustarSaldo(caso.cliente.id, caso.monto, `Recarga por WhatsApp (transferencia, caso #${caso.id})`));
    } catch (error) {
      logger.error({ err: error, caso: caso.id }, 'No se pudo sumar la recarga');
      return responder(`⚠️ No pude sumar el crédito en la página para #${caso.id} (${error.message}). No le dije nada al cliente; revisa su saldo antes de intentarlo de nuevo.`);
    }
    pagina.olvidarCache();
    await conexion.enviarTexto(caso.jid, `✅ Pago confirmado. Recargamos ${formatearPrecio(caso.monto, moneda)} a tu crédito; ahora tienes *${formatearPrecio(saldo, moneda)}*.`);
    casos.cerrar(caso.id);
    devolverAlBot(caso);
    return responder(`✓ #${caso.id} recargado: +${formatearPrecio(caso.monto, moneda)}, saldo ${formatearPrecio(saldo, moneda)}.`);
  }

  async function aprobar(caso) {
    if (caso.tipo === 'recarga') return aprobarRecarga(caso);
    if (caso.tipo !== 'pedido') return responder(`#${caso.id} no es un pedido.`);
    if (!pagina) return responder(`El bot no está conectado a la página. Envíale los datos con #${caso.id} texto.`);
    let entrega;
    try {
      entrega = await cobros.entregarPagado({ cliente: caso.cliente, servicio: caso.servicio, renta: caso.renta });
    } catch (error) {
      logger.error({ err: error, caso: caso.id }, 'No se pudo entregar el pedido aprobado');
      return responder(`⚠️ No pude crear la renta en la página para #${caso.id} (${error.message}). No le dije nada al cliente; revisa la página e inténtalo de nuevo.`);
    }

    let ventas = 'pasó a Ventas';
    if (caso.pedidoId) {
      await pagina
        .completarPedido(caso.pedidoId, { price: caso.servicio.price, paymentMethod: 'transferencia' })
        .catch((error) => {
          ventas = `no se pudo pasar a Ventas (${error.message}), complétalo en el panel`;
        });
    } else {
      ventas = 'no tenía pedido en la página, regístralo en Ventas si hace falta';
    }

    if (entrega.renovacion) {
      await conexion.enviarTexto(caso.jid, `✅ Pago confirmado. Renovamos tu cuenta, nueva fecha de vencimiento: *${entrega.fechaFin}*.`);
      casos.cerrar(caso.id);
      devolverAlBot(caso);
      return responder(`✓ #${caso.id} renovado hasta ${entrega.fechaFin}; el pedido ${ventas}.`);
    }
    if (entrega.cuenta) {
      await conexion.enviarTexto(
        caso.jid,
        [`✅ Pago confirmado. *Tus datos de acceso*`, `Correo: ${entrega.cuenta.email}`, `Contraseña: ${entrega.cuenta.password}`, `Vence: ${entrega.fechaFin}`].join('\n'),
      );
      casos.cerrar(caso.id);
      devolverAlBot(caso);
      return responder(`✓ #${caso.id} entregado con ${entrega.cuenta.email}, vence ${entrega.fechaFin}; el pedido ${ventas}. Si es perfil, dile cuál usar con #${caso.id} texto.`);
    }
    await conexion.enviarTexto(caso.jid, '✅ Pago confirmado. En breve te enviamos los datos de acceso por aquí.');
    caso.tipo = 'entrega';
    devolverAlBot(caso);
    return responder(`✓ #${caso.id} pagado, pero no hay cuenta libre: quedó en entregas pendientes y el pedido ${ventas}. Envíale los datos con #${caso.id} texto.`);
  }

  async function rechazar(caso, motivo) {
    if (caso.tipo !== 'pedido' && caso.tipo !== 'recarga') return responder(`#${caso.id} no es un pedido.`);
    const razon = motivo || 'no pudimos confirmar el pago';
    await conexion.enviarTexto(
      caso.jid,
      `No pudimos confirmar tu pago: ${razon}. Si crees que es un error, envía de nuevo el comprobante o escribe *asesor*.`,
    );
    // El cliente puede volver a mandar el comprobante.
    estados.guardar(caso.jid, { paso: 'pago', resumen: caso.resumen, casoId: caso.id, pedidoId: caso.pedidoId, notas: caso.notas, recarga: caso.tipo === 'recarga' });
    if (pagina && caso.pedidoId) {
      await pagina.actualizarPedido(caso.pedidoId, { notes: `${caso.notas ?? ''} Rechazado: ${razon}.`.trim() }).catch(() => {});
    }
    return responder(`✓ Le avisé al cliente de #${caso.id} que el pago fue rechazado.`);
  }

  async function resolver(caso, texto) {
    if (caso.tipo !== 'reporte') return responder(`#${caso.id} no es un reporte.`);
    let nota = '';
    if (pagina && caso.caidaId) {
      await pagina
        .actualizarCaida(caso.caidaId, { status: 'resuelto', resolution: texto || 'Resuelto por WhatsApp' })
        .catch((error) => {
          nota = ` No se pudo marcar en la página (${error.message}).`;
        });
    }
    const plataforma = nombrePlataforma(caso.plataforma);
    await conexion.enviarTexto(caso.jid, `✅ Tu reporte de ${plataforma} quedó resuelto.${texto ? `\n\n${texto}` : ''}`);
    casos.cerrar(caso.id);
    return responder(`✓ #${caso.id} resuelto.${nota}`);
  }

  async function terminarChat(caso) {
    await conexion.enviarTexto(caso.jid, 'El asesor terminó la conversación. Escribe *menu* cuando quieras volver a usar el bot.');
    devolverAlBot(caso);
    if (caso.tipo === 'asesor') casos.cerrar(caso.id);
    if (chatActivo === caso.id) chatActivo = null;
    return responder(`✓ Chat #${caso.id} terminado.`);
  }

  async function manejar(mensaje) {
    chatAdmin = mensaje.key.remoteJid;
    const { texto } = leerMensaje(mensaje);
    const { comando, caso: numero, resto } = interpretarComando(texto);

    if (comando === 'ayuda') return responder(AYUDA);
    if (comando === 'casos') return responder(textoCasos(casos.abiertos()));

    if (comando === null) {
      const caso = chatActivo ? casos.obtener(chatActivo) : null;
      if (!caso) return responder(`No hay un chat activo. Escribe */ayuda* para ver los comandos.`);
      return enviarAlCliente(caso, mensaje, resto);
    }

    if (comando === 'fin' && numero === null) {
      const caso = chatActivo ? casos.obtener(chatActivo) : null;
      if (!caso) return responder('No hay un chat activo.');
      return terminarChat(caso);
    }

    const conocidos = ['enviar', 'aprobar', 'rechazar', 'resuelto', 'chat', 'fin'];
    if (!conocidos.includes(comando)) return responder(`No conozco /${comando}. Escribe */ayuda*.`);
    if (numero === null) return responder(`Falta el número de caso, por ejemplo: /${comando} 12`);
    const caso = casos.obtener(numero);
    if (!caso) return responder(`No encuentro el caso #${numero}. Escribe */casos* para ver los abiertos.`);

    switch (comando) {
      case 'enviar':
        if (!resto && !leerMensaje(mensaje).tieneArchivo) return responder(`Escribe el texto después del número: #${numero} hola`);
        await enviarAlCliente(caso, mensaje, resto);
        return responder(`✓ Enviado a #${numero}.`);
      case 'aprobar':
        return aprobar(caso);
      case 'rechazar':
        return rechazar(caso, resto);
      case 'resuelto':
        return resolver(caso, resto);
      case 'chat':
        chatActivo = caso.id;
        // Mientras habla con Anthony, el bot no le contesta al cliente.
        estados.guardar(caso.jid, { paso: 'asesor' });
        return responder(`💬 Chat activo con #${caso.id} ${caso.nombre}. Lo que escribas le llega. */fin* para terminar.`);
      case 'fin':
        return terminarChat(caso);
      default:
        return undefined;
    }
  }

  return {
    manejar,
    // Cuando un cliente pide asesor: si no hay otro chat activo, este queda activo.
    abrirChat(caso) {
      if (chatActivo === null || !casos.obtener(chatActivo)?.abierto) {
        chatActivo = caso.id;
        return true;
      }
      return false;
    },
    // El cliente salió del chat escribiendo "menu".
    clienteSalio(caso) {
      casos.cerrar(caso.id);
      if (chatActivo === caso.id) chatActivo = null;
    },
    get chatActivo() {
      return chatActivo;
    },
  };
}
