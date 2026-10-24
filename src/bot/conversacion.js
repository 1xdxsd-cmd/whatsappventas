import { agruparPorPlataforma, formatearDuracion, formatearPrecio, nombrePlataforma, nombreTipo } from '../catalogo/servicios.js';

// Lógica de la conversación como función pura: recibe el mensaje, el estado
// del cliente y el contexto (catálogo, datos de pago, rentas del cliente), y
// devuelve las respuestas, el nuevo estado, las acciones que el servidor debe
// ejecutar en la página y, si hace falta, un aviso para Anthony.
// No sabe nada de WhatsApp ni de la página, así se puede probar sola.

export const ESTADO_INICIAL = { paso: 'inicio' };

// Funcionan en cualquier paso, incluso cuando atiende un asesor.
const PALABRAS_MENU = ['menu', 'inicio'];

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
  ].join('\n');
}

function textoBienvenida(cliente) {
  const saludo = cliente ? `¡Hola, ${cliente.nombre}! 👋` : '¡Hola! 👋 Bienvenido.';
  return `${saludo} Vendemos cuentas y perfiles de streaming.\n\n${textoMenu()}`;
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
  const { moneda, servicios, datosPago, cliente = null, rentas = [] } = contexto;
  const grupos = agruparPorPlataforma(servicios);
  const menu = (respuestas = [textoMenu()]) => ({ respuestas, estado: { paso: 'menu' } });
  const catalogo = () => ({ respuestas: [textoCatalogo(grupos, moneda)], estado: { paso: 'catalogo' } });

  if (PALABRAS_MENU.includes(texto)) {
    return estado.paso === 'inicio' ? menu([textoBienvenida(cliente)]) : menu();
  }
  if (texto === 'asesor') {
    return pasarAAsesor('Un cliente pidió hablar con un asesor.');
  }
  // Los recordatorios de vencimiento piden responder "renovar".
  if (texto === 'renovar' && estado.paso !== 'asesor') {
    return iniciarRenovacion(rentas, servicios, cliente, moneda);
  }

  switch (estado.paso) {
    case 'inicio':
      return menu([textoBienvenida(cliente)]);

    case 'menu':
      if (texto === '1') return catalogo();
      if (texto === '2') return iniciarRenovacion(rentas, servicios, cliente, moneda);
      if (texto === '3') return iniciarReporte(rentas, cliente);
      if (texto === '4') return menu([textoComoComprar(), textoMenu()]);
      if (texto === '5') return pasarAAsesor('Un cliente pidió hablar con un asesor.');
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
      return pedirPago(servicio, resumenPedido(servicio, moneda), datosPago);
    }

    case 'renovar': {
      if (texto === '0') return menu();
      const renta = elegir(rentas, texto);
      if (!renta) return noEntendi(textoRentas(PREGUNTA_RENOVAR, rentas, (r) => formatearPrecio(servicioParaRenovar(r, servicios).price, moneda)), estado);
      const servicio = servicioParaRenovar(renta, servicios);
      const correo = renta.email ? ` (${renta.email})` : '';
      return pedirPago(servicio, `Renovación de ${resumenPedido(servicio, moneda)}${correo}`, datosPago);
    }

    case 'pago':
    case 'revision': {
      if (mensaje.tieneComprobante) {
        return {
          respuestas: ['¡Recibimos tu comprobante! Lo revisamos y te enviamos los datos de acceso por aquí.'],
          estado: { ...estado, paso: 'revision' },
          acciones: [{ tipo: 'comprobanteRecibido' }],
          aviso: { texto: `Comprobante recibido para: ${estado.resumen}. Revísalo y entrega la cuenta.`, reenviar: true },
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

    case 'asesor':
      // Anthony atiende en persona; el bot calla hasta que el cliente escriba "menu".
      return { respuestas: [], estado };

    default:
      return menu([textoBienvenida(cliente)]);
  }
}

function iniciarReporte(rentas, cliente) {
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

function iniciarRenovacion(rentas, servicios, cliente, moneda) {
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

function pedirPago(servicio, resumen, datosPago) {
  return {
    respuestas: [
      `Perfecto, tu pedido: *${resumen}*.`,
      `Haz el pago a:\n\n${datosPago}\n\nLuego envía aquí la *foto del comprobante*.`,
    ],
    estado: { paso: 'pago', resumen },
    acciones: [{ tipo: 'crearPedido', servicio, resumen }],
    aviso: { texto: `Nuevo pedido: ${resumen}. Esperando comprobante.` },
  };
}

function pasarAAsesor(textoAviso) {
  return {
    respuestas: ['Listo, un asesor te escribirá en breve por aquí. Escribe *menu* cuando quieras volver al bot.'],
    estado: { paso: 'asesor' },
    aviso: { texto: textoAviso },
  };
}
