import { lineaDeVencimiento, rentasPorVencer } from '../recordatorios/calculo.js';
import { agruparPorPlataforma, formatearDuracion, formatearPrecio, nombrePlataforma, nombreTipo } from '../catalogo/servicios.js';

// Lógica de la conversación como función pura: recibe el mensaje, el estado
// del cliente y el contexto (catálogo, datos de pago, rentas del cliente), y
// devuelve las respuestas, el nuevo estado, las acciones que el servidor debe
// ejecutar en la página y, si hace falta, un aviso para Anthony.
// No sabe nada de WhatsApp ni de la página, así se puede probar sola.

export const ESTADO_INICIAL = { paso: 'inicio' };

// Funcionan en cualquier paso, incluso cuando atiende un asesor.
const PALABRAS_MENU = ['menu', 'inicio'];
const PALABRAS_CUENTA = ['usuario', 'contrasena', 'clave', 'olvide mi contrasena', 'olvide mi clave', 'olvide mi usuario'];
export const LARGO_MINIMO_CLAVE = 6;
const PALABRAS_RECARGA = ['recargar', 'recarga', 'saldo', 'credito', 'mi credito', 'mi saldo', 'agregar saldo', 'recargar saldo', 'recargar credito'];
export const RECARGA_MINIMA = 50;
const RECARGA_MAXIMA = 20000;

function normalizar(texto) {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function textoMenu() {
  return [
    '¿En qué te ayudo? Responde con el número:',
    '',
    '*1.* Ver planes y precios',
    '*2.* Renovar una cuenta',
    '*3.* Reportar una cuenta que no funciona',
    '*4.* Cómo comprar',
    '*5.* Hablar con un asesor',
    '*6.* Mi usuario o contraseña de la página',
    '*7.* Recargar crédito',
  ].join('\n');
}

function textoBienvenida(cliente, negocio) {
  const nombre = negocio ? ` a *${negocio}*` : '';
  const saludo = cliente ? `¡Hola, ${cliente.nombre}! 👋 Bienvenido${nombre}.` : `¡Hola! 👋 Bienvenido${nombre}.`;
  return `${saludo} Vendemos cuentas y perfiles de streaming.\n\n${textoMenu()}`;
}

// Al saludar o volver al menú, si tiene cuentas por vencer, se lo recuerda.
function recordatorioAlEscribir(rentas, ahora) {
  const porVencer = rentasPorVencer(rentas, ahora);
  if (porVencer.length === 0) return [];
  return [['⏰ *Recordatorio*', '', ...porVencer.map((r) => lineaDeVencimiento(r, ahora)), '', 'Para renovar, responde *renovar*.'].join('\n')];
}

function textoCatalogo(grupos, moneda) {
  const lineas = grupos.map((grupo, i) => {
    const precios = grupo.opciones
      .map((s) => `${nombreTipo(s.type).toLowerCase()} ${formatearPrecio(s.price, moneda)}`)
      .join(', ');
    return `*${i + 1}.* ${grupo.nombre}: ${precios}`;
  });
  return [
    '*Planes (pesos mexicanos)*',
    '',
    ...lineas,
    '',
    'Responde con el número del servicio que quieres, o *0* para volver al menú.',
  ].join('\n');
}

function textoOpciones(grupo, moneda) {
  const lineas = grupo.opciones.map(
    (s, i) => `*${i + 1}.* ${nombreTipo(s.type)}: ${formatearPrecio(s.price, moneda)} ${formatearDuracion(s.duration)}`,
  );
  return [
    `*${grupo.nombre}*`,
    '',
    ...lineas,
    '',
    'Responde con el número de la opción, o *0* para volver a los planes.',
  ].join('\n');
}

function textoComoComprar() {
  return [
    '*Cómo comprar*',
    '',
    '1. Eliges el servicio y si quieres perfil o cuenta completa.',
    '2. Haces la transferencia por el monto indicado.',
    '3. Nos envías la foto del comprobante por aquí.',
    '4. Cuando confirmamos el pago, te enviamos los datos de acceso.',
  ].join('\n');
}

function textoRentas(pregunta, rentas, precio) {
  const lineas = rentas.map((r, i) => {
    const correo = r.email ? `, ${r.email}` : '';
    const extra = precio ? `, renovar por ${precio(r)}` : '';
    return `*${i + 1}.* ${nombrePlataforma(r.platform)} (${nombreTipo(r.type).toLowerCase()}${correo}), vence ${String(r.endDate).slice(0, 10)}${extra}`;
  });
  return [pregunta, '', ...lineas, '', 'Responde con el número, o *0* para volver al menú.'].join('\n');
}

const PREGUNTA_REPORTE = '¿Cuál cuenta no funciona?';
const PREGUNTA_RENOVAR = '¿Cuál cuenta quieres renovar?';

// La renovación cuesta lo que paga ese cliente en su renta; si la renta no
// tiene precio, el del catálogo. Igual que en la página.
function servicioParaRenovar(renta, servicios) {
  const delCatalogo =
    servicios.find((s) => s.platform === renta.platform && s.type === renta.type) ??
    servicios.find((s) => s.platform === renta.platform);
  return {
    platform: renta.platform,
    type: renta.type,
    name: delCatalogo?.name,
    price: Number(renta.price) || delCatalogo?.price || 0,
    duration: delCatalogo?.duration || 30,
  };
}

function resumenPedido(servicio, moneda) {
  return `${nombrePlataforma(servicio.platform, servicio.name)}, ${nombreTipo(servicio.type).toLowerCase()}, ${formatearPrecio(servicio.price, moneda)} ${formatearDuracion(servicio.duration)}`;
}

function elegir(lista, texto) {
  const numero = Number.parseInt(texto, 10);
  if (String(numero) !== texto || numero < 1 || numero > lista.length) return null;
  return lista[numero - 1];
}

function noEntendi(texto, estado) {
  return { respuestas: [`No entendí tu respuesta.\n\n${texto}`], estado };
}

/**
 * @param {{ texto?: string, tieneComprobante?: boolean }} mensaje
 * @param {{ paso: string }} estado
 * @param {{ moneda: string, servicios: object[], datosPago: string, cliente?: { nombre: string } | null, rentas?: object[] }} contexto
 * @returns {{ respuestas: string[], estado: object, acciones?: object[], aviso?: { texto: string, reenviar?: boolean } }}
 */
export function procesarMensaje(mensaje, estado, contexto) {
  const texto = normalizar(mensaje.texto);
  const { moneda, servicios, datosPago, cobradores = [], cliente = null, rentas = [], paginaCaida = false, negocio = '', enlacePagina = '', ahora = new Date() } = contexto;
  const bienvenida = () => [textoBienvenida(cliente, negocio), ...recordatorioAlEscribir(rentas, ahora)];
  const grupos = agruparPorPlataforma(servicios);
  const pagos = { datosPago, cobradores };
  const menu = (respuestas = [textoMenu()]) => ({ respuestas, estado: { paso: 'menu' } });
  const catalogo = () => ({ respuestas: [textoCatalogo(grupos, moneda)], estado: { paso: 'catalogo' } });

  if (PALABRAS_MENU.includes(texto)) {
    return estado.paso === 'inicio' ? menu(bienvenida()) : menu([textoMenu(), ...recordatorioAlEscribir(rentas, ahora)]);
  }
  if (texto === 'asesor') {
    return pasarAAsesor('Un cliente pidió hablar con un asesor.');
  }
  // Los recordatorios de vencimiento piden responder "renovar".
  if (texto === 'renovar' && estado.paso !== 'asesor') {
    return iniciarRenovacion(rentas, servicios, cliente, moneda, paginaCaida);
  }
  if (PALABRAS_RECARGA.includes(texto) && !['asesor', 'nueva-clave'].includes(estado.paso)) {
    return iniciarRecarga(cliente, paginaCaida, moneda);
  }
  if (PALABRAS_CUENTA.includes(texto) && !['asesor', 'nueva-clave'].includes(estado.paso)) {
    return iniciarCuenta(cliente, paginaCaida, enlacePagina);
  }

  switch (estado.paso) {
    case 'inicio':
      return menu(bienvenida());

    case 'menu':
      if (texto === '1') return catalogo();
      if (texto === '2') return iniciarRenovacion(rentas, servicios, cliente, moneda, paginaCaida);
      if (texto === '3') return iniciarReporte(rentas, cliente, paginaCaida);
      if (texto === '4') return menu([textoComoComprar(), textoMenu()]);
      if (texto === '5') return pasarAAsesor('Un cliente pidió hablar con un asesor.');
      if (texto === '6') return iniciarCuenta(cliente, paginaCaida, enlacePagina);
      if (texto === '7') return iniciarRecarga(cliente, paginaCaida, moneda);
      return menu([`No entendí tu respuesta. ${textoMenu()}`]);

    case 'catalogo': {
      if (texto === '0') return menu();
      const grupo = elegir(grupos, texto);
      if (!grupo) return noEntendi(textoCatalogo(grupos, moneda), estado);
      return { respuestas: [textoOpciones(grupo, moneda)], estado: { paso: 'tipo', platform: grupo.platform } };
    }

    case 'tipo': {
      const grupo = grupos.find((g) => g.platform === estado.platform);
      if (texto === '0' || !grupo) return catalogo();
      const servicio = elegir(grupo.opciones, texto);
      if (!servicio) return noEntendi(textoOpciones(grupo, moneda), estado);
      return elegirFormaDePago(servicio, resumenPedido(servicio, moneda), null, { cliente, moneda, pagos });
    }

    case 'renovar': {
      if (texto === '0') return menu();
      const renta = elegir(rentas, texto);
      if (!renta) return noEntendi(textoRentas(PREGUNTA_RENOVAR, rentas, (r) => formatearPrecio(servicioParaRenovar(r, servicios).price, moneda)), estado);
      const servicio = servicioParaRenovar(renta, servicios);
      const correo = renta.email ? ` (${renta.email})` : '';
      const resumen = `Renovación de ${resumenPedido(servicio, moneda)}${correo}`;
      return elegirFormaDePago(servicio, resumen, renta, { cliente, moneda, pagos });
    }

    case 'forma-pago': {
      const { servicio, resumen, renta } = estado;
      if (texto === '0') return menu();
      if (texto === '1') {
        // El cobro lo hace el servidor; las respuestas salen de textoCobroConCredito.
        return {
          respuestas: [],
          estado: { paso: 'menu' },
          acciones: [{ tipo: 'pagarConCredito', servicio, resumen, renta }],
        };
      }
      if (texto === '2') return pedirPago(servicio, resumen, pagos, renta);
      return noEntendi(textoFormaDePago(servicio, cliente, moneda), estado);
    }

    case 'pago':
    case 'revision': {
      if (mensaje.tieneComprobante) {
        return {
          respuestas: ['¡Recibimos tu comprobante! Lo revisamos y te enviamos los datos de acceso por aquí.'],
          estado: { ...estado, paso: 'revision' },
          acciones: [{ tipo: 'comprobanteRecibido' }],
          aviso: {
            texto: `Comprobante recibido para: ${estado.resumen}. ${estado.recarga ? 'Revísalo; al aprobarlo se le suma el crédito.' : 'Revísalo y entrega la cuenta.'}`,
            reenviar: true,
          },
        };
      }
      if (estado.paso === 'revision') {
        return {
          respuestas: ['Tu pago está en revisión, en breve te escribimos. Escribe *menu* para volver al inicio.'],
          estado,
        };
      }
      return {
        respuestas: ['Para continuar, envía la *foto del comprobante* del pago. Escribe *menu* para cancelar.'],
        estado,
      };
    }

    case 'reporte': {
      if (texto === '0') return menu();
      const renta = elegir(rentas, texto);
      if (!renta) return noEntendi(textoRentas(PREGUNTA_REPORTE, rentas), estado);
      return {
        respuestas: ['Cuéntanos qué pasa con la cuenta (por ejemplo: pide un código, contraseña incorrecta, perfil ocupado).'],
        estado: { paso: 'reporte-motivo', rentaId: renta.id },
      };
    }

    case 'reporte-motivo': {
      const renta = rentas.find((r) => r.id === estado.rentaId);
      if (texto === '0' || !renta) return menu();
      if (!texto) {
        return { respuestas: ['Escríbenos en un mensaje qué pasa con la cuenta, o *0* para cancelar.'], estado };
      }
      const nombre = nombrePlataforma(renta.platform);
      return {
        respuestas: [
          `Listo, reportamos tu cuenta de ${nombre}. Te avisamos por aquí en cuanto quede resuelta.`,
          textoMenu(),
        ],
        estado: { paso: 'menu' },
        acciones: [{ tipo: 'reportarCaida', renta, motivo: mensaje.texto.trim() }],
        aviso: { texto: `Cuenta caída reportada: ${nombre} ${renta.email || ''}. Motivo: ${mensaje.texto.trim()}` },
      };
    }

    case 'recarga': {
      if (texto === '0') return menu();
      const monto = leerMonto(texto);
      if (!cliente?.id) return menu();
      if (monto === null || monto < RECARGA_MINIMA || monto > RECARGA_MAXIMA) {
        return {
          respuestas: [`Escribe solo el monto en pesos, de ${formatearPrecio(RECARGA_MINIMA, moneda)} a ${formatearPrecio(RECARGA_MAXIMA, moneda)} (por ejemplo: 200), o *0* para volver al menú.`],
          estado,
        };
      }
      const resumen = `Recarga de crédito de ${formatearPrecio(monto, moneda)}`;
      return cobrar({ tipo: 'recarga', monto, resumen }, pagos);
    }

    case 'elegir-cobrador': {
      if (texto === '0') return menu();
      const indice = Number.parseInt(texto, 10) - 1;
      const cobrador = elegir(cobradores, texto);
      if (!cobrador || !estado.pendiente) return noEntendi(textoCobradores(cobradores), estado);
      return cobrarA(estado.pendiente, cobrador, indice);
    }

    case 'cuenta':
      if (texto === '0') return menu();
      if (texto === '1' && cliente?.id) {
        return {
          respuestas: [`Escribe tu nueva contraseña (mínimo ${LARGO_MINIMO_CLAVE} caracteres, sin espacios), o *0* para cancelar.`],
          estado: { paso: 'nueva-clave' },
        };
      }
      return noEntendi(textoCuenta(cliente, enlacePagina), estado);

    case 'nueva-clave': {
      // La contraseña se toma tal cual (con mayúsculas), no la versión normalizada.
      const clave = (mensaje.texto ?? '').trim();
      if (clave === '0' || !cliente?.id) return menu();
      if (clave.length < LARGO_MINIMO_CLAVE || /\s/.test(clave)) {
        return {
          respuestas: [`La contraseña debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres y no llevar espacios. Escríbela de nuevo, o *0* para cancelar.`],
          estado,
        };
      }
      // El cambio lo hace el servidor; las respuestas salen de textoCambioDeClave.
      return { respuestas: [], estado: { paso: 'menu' }, acciones: [{ tipo: 'cambiarClave', clave }] };
    }

    case 'asesor':
      // Anthony atiende en persona; el bot calla hasta que el cliente escriba "menu".
      return { respuestas: [], estado };

    default:
      return menu(bienvenida());
  }
}

function sinAccesoALaPagina(queQuiere) {
  return {
    respuestas: ['En este momento no puedo consultar tus cuentas. Un asesor te escribirá en breve por aquí.'],
    estado: { paso: 'asesor' },
    aviso: { texto: `Un cliente quiere ${queQuiere}, pero el bot no pudo conectarse a la página. Revisa PAGINA_URL y que la página esté encendida.` },
  };
}

// Acepta "200", "$200", "200 pesos" o "1,500".
function leerMonto(texto) {
  const limpio = texto.replace(/[$,\s]|pesos|mxn/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  return Number(limpio);
}

// El crédito vive en la cuenta de la página, así que solo se recarga a clientes
// registrados (el teléfono identifica la cuenta, igual que en la recuperación).
function iniciarRecarga(cliente, paginaCaida, moneda) {
  if (paginaCaida) return sinAccesoALaPagina('recargar crédito');
  if (!cliente?.id) {
    return {
      respuestas: ['Para recargar crédito necesitas una cuenta en la página con este número de WhatsApp. Un asesor te escribirá en breve para ayudarte.'],
      estado: { paso: 'asesor' },
      aviso: { texto: 'Un cliente quiere recargar crédito, pero su número no está registrado en la página.' },
    };
  }
  return {
    respuestas: [
      `Tienes *${formatearPrecio(Number(cliente.saldo) || 0, moneda)}* de crédito. ¿Cuánto quieres recargar? Escribe el monto (mínimo ${formatearPrecio(RECARGA_MINIMA, moneda)}), o *0* para volver al menú.`,
    ],
    estado: { paso: 'recarga' },
  };
}

function textoCuenta(cliente, enlacePagina) {
  const enlace = enlacePagina ? `\nEntra en: ${enlacePagina}` : '';
  return [
    `Tu usuario de la página es *${cliente.usuario}*.${enlace}`,
    '',
    '*1.* Cambiar mi contraseña',
    '*0.* Volver al menú',
  ].join('\n');
}

// El teléfono desde el que escribe es la prueba de identidad: solo se atiende si
// coincide con el registrado en la página. Nunca se envía la contraseña actual
// (la página ni siquiera la guarda legible); solo se puede poner una nueva.
function iniciarCuenta(cliente, paginaCaida, enlacePagina) {
  if (paginaCaida) return sinAccesoALaPagina('recuperar su usuario o contraseña de la página');
  if (!cliente?.id || !cliente.usuario) {
    return {
      respuestas: ['No encontré una cuenta de la página con este número de WhatsApp. Un asesor te escribirá en breve para ayudarte.'],
      estado: { paso: 'asesor' },
      aviso: { texto: 'Un cliente quiere recuperar su usuario o contraseña, pero su número no está registrado en la página.' },
    };
  }
  return { respuestas: [textoCuenta(cliente, enlacePagina)], estado: { paso: 'cuenta' } };
}

/** Mensajes para el cliente y aviso para Anthony según cómo terminó el cambio de contraseña. */
export function textoCambioDeClave(ok, cliente) {
  if (ok) {
    return {
      respuestas: [`✅ Listo, cambiaste tu contraseña. Ya puedes entrar a la página con tu usuario *${cliente.usuario}* y la contraseña nueva. Por seguridad, borra el mensaje donde la escribiste.`],
      aviso: { texto: `${cliente.nombre} (@${cliente.usuario}) cambió su contraseña de la página por WhatsApp.` },
    };
  }
  return {
    respuestas: ['No pude cambiar tu contraseña en este momento. Un asesor te escribirá en breve por aquí.'],
    aviso: { texto: `⚠️ ${cliente.nombre} (@${cliente.usuario}) quiso cambiar su contraseña por WhatsApp, pero la página dio error.` },
    estado: { paso: 'asesor' },
  };
}

function iniciarReporte(rentas, cliente, paginaCaida) {
  if (paginaCaida) return sinAccesoALaPagina('reportar una cuenta caída');
  if (rentas.length === 0) {
    const motivo = cliente
      ? `${cliente.nombre} quiere reportar una cuenta caída, pero no tiene rentas activas en la página.`
      : 'Un cliente quiere reportar una cuenta caída, pero su número no está registrado en la página.';
    return {
      respuestas: ['No encontré cuentas activas con este número. Un asesor te escribirá en breve por aquí.'],
      estado: { paso: 'asesor' },
      aviso: { texto: motivo },
    };
  }
  return { respuestas: [textoRentas(PREGUNTA_REPORTE, rentas)], estado: { paso: 'reporte' } };
}

function iniciarRenovacion(rentas, servicios, cliente, moneda, paginaCaida) {
  if (paginaCaida) return sinAccesoALaPagina('renovar');
  if (rentas.length === 0) {
    const motivo = cliente
      ? `${cliente.nombre} quiere renovar, pero no tiene rentas activas en la página.`
      : 'Un cliente quiere renovar, pero su número no está registrado en la página.';
    return {
      respuestas: ['No encontré cuentas activas con este número. Un asesor te escribirá en breve para ayudarte a renovar.'],
      estado: { paso: 'asesor' },
      aviso: { texto: motivo },
    };
  }
  const precio = (r) => formatearPrecio(servicioParaRenovar(r, servicios).price, moneda);
  return { respuestas: [textoRentas(PREGUNTA_RENOVAR, rentas, precio)], estado: { paso: 'renovar' } };
}

function textoFormaDePago(servicio, cliente, moneda) {
  const queda = formatearPrecio(Math.round((cliente.saldo - servicio.price) * 100) / 100, moneda);
  return [
    `Tienes *${formatearPrecio(cliente.saldo, moneda)}* de crédito. ¿Cómo quieres pagar?`,
    '',
    `*1.* Con mi crédito (te quedan ${queda})`,
    '*2.* Por transferencia',
    '',
    'Responde con el número, o *0* para volver al menú.',
  ].join('\n');
}

// Si el crédito alcanza, deja elegir entre crédito y transferencia.
function elegirFormaDePago(servicio, resumen, renta, { cliente, moneda, pagos }) {
  const saldo = Number(cliente?.saldo) || 0;
  if (cliente && saldo >= servicio.price && servicio.price > 0) {
    return {
      respuestas: [`Tu pedido: *${resumen}*.`, textoFormaDePago(servicio, { ...cliente, saldo }, moneda)],
      estado: { paso: 'forma-pago', servicio, resumen, renta: renta ?? null },
    };
  }
  const resultado = pedirPago(servicio, resumen, pagos, renta);
  if (saldo > 0) {
    resultado.respuestas.splice(1, 0, `Tu crédito (${formatearPrecio(saldo, moneda)}) no alcanza para este pedido, así que puedes pagar por transferencia.`);
  }
  return resultado;
}

/**
 * Mensajes para el cliente y aviso para Anthony según cómo terminó el cobro con crédito.
 * @returns {{ respuestas: string[], aviso: { texto: string }, estado?: object }}
 */
export function textoCobroConCredito(resultado, { resumen, moneda }) {
  if (resultado.ok) {
    const saldo = formatearPrecio(resultado.saldo, moneda);
    const venta = resultado.ventaRegistrada ? '' : ' (no se pudo registrar en Ventas, agrégala a mano)';
    if (resultado.renovacion) {
      return {
        respuestas: [`✅ Listo, renovaste con tu crédito. Nueva fecha de vencimiento: *${resultado.fechaFin}*. Te quedan ${saldo} de crédito.`],
        aviso: { texto: `Pagó con crédito: ${resumen}. Vence ${resultado.fechaFin}. Saldo: ${saldo}${venta}.` },
      };
    }
    if (resultado.cuenta) {
      return {
        respuestas: [
          `✅ Listo, pagaste con tu crédito. Te quedan ${saldo}.`,
          [`*Tus datos de acceso*`, `Correo: ${resultado.cuenta.email}`, `Contraseña: ${resultado.cuenta.password}`, `Vence: ${resultado.fechaFin}`].join('\n'),
        ],
        aviso: { texto: `Pagó con crédito y se le entregó ${resultado.cuenta.email}: ${resumen}. Saldo: ${saldo}${venta}. Si es perfil, dile cuál usar.` },
      };
    }
    return {
      respuestas: [`✅ Listo, pagaste con tu crédito (te quedan ${saldo}). En breve te enviamos los datos de acceso por aquí.`],
      aviso: { texto: `Pagó con crédito pero no hay cuenta disponible: ${resumen}. Quedó en entregas pendientes${venta}.` },
    };
  }
  if (resultado.motivo === 'saldoInsuficiente') {
    return {
      respuestas: ['Tu crédito ya no alcanza para este pedido. Escribe *menu* para elegir de nuevo y pagar por transferencia.'],
      aviso: { texto: `Intentó pagar con crédito sin saldo suficiente: ${resumen}.` },
    };
  }
  const detalle = {
    descuentoIncierto: 'la página no respondió al descontar el crédito. Revisa su saldo: puede que sí se haya descontado.',
    reembolsado: 'se descontó el crédito pero falló la entrega, así que se le devolvió. Revisa que no haya quedado una renta creada.',
    sinReembolso: 'se descontó el crédito, falló la entrega y NO se pudo devolver. Devuélvele el crédito a mano.',
  }[resultado.motivo] ?? 'ocurrió un error inesperado.';
  return {
    respuestas: ['No pude completar el pago con tu crédito. Un asesor te escribirá en breve por aquí.'],
    aviso: { texto: `⚠️ Pago con crédito fallido (${resumen}): ${detalle}` },
    estado: { paso: 'asesor' },
  };
}

function pedirPago(servicio, resumen, pagos, renta = null) {
  return cobrar({ tipo: 'pedido', servicio, resumen, renta }, pagos);
}

function textoCobradores(cobradores) {
  return ['¿A quién le quieres hacer la transferencia?', '', ...cobradores.map((c, i) => `*${i + 1}.* ${c.nombre}`), '', 'Responde con el número, o *0* para volver al menú.'].join('\n');
}

// Con varias personas que cobran, el cliente elige a quién pagar; el comprobante
// solo le llega a esa persona (`cobrador` es su posición en la lista).
function cobrar(pendiente, { datosPago, cobradores }) {
  if (cobradores.length >= 2) {
    return {
      respuestas: [`Perfecto, tu pedido: *${pendiente.resumen}*.`, textoCobradores(cobradores)],
      estado: { paso: 'elegir-cobrador', pendiente },
    };
  }
  if (cobradores.length === 1) return cobrarA(pendiente, cobradores[0], 0, true);
  return cobrarA(pendiente, { datos: datosPago }, null, true);
}

function cobrarA(pendiente, cobrador, indice, conResumen = false) {
  const { resumen } = pendiente;
  const destino = cobrador.nombre ? ` a *${cobrador.nombre}*` : '';
  const respuestas = conResumen ? [`Perfecto, tu pedido: *${resumen}*.`] : [];
  const despues = pendiente.tipo === 'recarga' ? ' Cuando lo confirmemos, el crédito aparece en tu cuenta de la página.' : '';
  respuestas.push(`Haz la transferencia${destino}:\n\n${cobrador.datos}\n\nLuego envía aquí la *foto del comprobante*.${despues}`);
  const paraQuien = cobrador.nombre ? ` Paga a ${cobrador.nombre}.` : '';
  if (pendiente.tipo === 'recarga') {
    return {
      respuestas,
      estado: { paso: 'pago', resumen, recarga: true },
      acciones: [{ tipo: 'crearRecarga', monto: pendiente.monto, resumen, cobrador: indice }],
      aviso: { texto: `Quiere ${resumen.charAt(0).toLowerCase()}${resumen.slice(1)}.${paraQuien} Esperando comprobante.` },
    };
  }
  return {
    respuestas,
    estado: { paso: 'pago', resumen },
    acciones: [{ tipo: 'crearPedido', servicio: pendiente.servicio, resumen, renta: pendiente.renta ?? null, cobrador: indice }],
    aviso: { texto: `Nuevo pedido: ${resumen}.${paraQuien} Esperando comprobante.` },
  };
}

function pasarAAsesor(textoAviso) {
  return {
    respuestas: ['⏳ Espera un momento, te estamos enlazando con un asesor. Escribe *menu* si quieres volver al bot.'],
    estado: { paso: 'asesor' },
    aviso: { texto: textoAviso },
  };
}
