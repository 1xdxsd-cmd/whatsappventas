import { SERVICIOS, TIPOS, formatearPrecio } from '../catalogo/servicios.js';

// Lógica de la conversación como función pura: recibe el mensaje y el estado
// del cliente, y devuelve las respuestas, el nuevo estado y, si hace falta,
// un aviso para Anthony. No sabe nada de WhatsApp, así se puede probar sola.

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
    '*2.* Cómo comprar',
    '*3.* Hablar con un asesor',
  ].join('\n');
}

function textoBienvenida() {
  return `¡Hola! 👋 Bienvenido. Vendemos cuentas y perfiles de streaming.\n\n${textoMenu()}`;
}

function textoCatalogo(moneda) {
  const lineas = SERVICIOS.map((servicio, i) => {
    const perfil = formatearPrecio(servicio.precios.perfil, moneda);
    const completa = formatearPrecio(servicio.precios.completa, moneda);
    return `*${i + 1}.* ${servicio.nombre}: perfil ${perfil}, cuenta completa ${completa}`;
  });
  return [
    '*Planes mensuales*',
    '',
    ...lineas,
    '',
    'Responde con el número del servicio que quieres, o *0* para volver al menú.',
  ].join('\n');
}

function textoTipos(servicio, moneda) {
  const lineas = TIPOS.map(
    (tipo, i) => `*${i + 1}.* ${tipo.nombre}: ${formatearPrecio(servicio.precios[tipo.id], moneda)} al mes`,
  );
  return [
    `*${servicio.nombre}*`,
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

function resumenPedido(servicio, tipo, moneda) {
  return `${servicio.nombre}, ${tipo.nombre.toLowerCase()}, ${formatearPrecio(servicio.precios[tipo.id], moneda)} al mes`;
}

function elegir(lista, texto) {
  const numero = Number.parseInt(texto, 10);
  if (String(numero) !== texto || numero < 1 || numero > lista.length) return null;
  return lista[numero - 1];
}

/**
 * @param {{ texto?: string, tieneComprobante?: boolean }} mensaje
 * @param {{ paso: string, servicio?: string, tipo?: string }} estado
 * @param {{ moneda: string, datosTransferencia: string }} opciones
 * @returns {{ respuestas: string[], estado: object, aviso?: { texto: string, reenviar?: boolean } }}
 */
export function procesarMensaje(mensaje, estado, opciones) {
  const texto = normalizar(mensaje.texto);
  const { moneda, datosTransferencia } = opciones;
  const menu = (respuestas = [textoMenu()]) => ({ respuestas, estado: { paso: 'menu' } });

  if (PALABRAS_MENU.includes(texto)) {
    return estado.paso === 'inicio' ? menu([textoBienvenida()]) : menu();
  }
  if (texto === 'asesor') {
    return pasarAAsesor();
  }

  switch (estado.paso) {
    case 'inicio':
      return menu([textoBienvenida()]);

    case 'menu':
      if (texto === '1') return { respuestas: [textoCatalogo(moneda)], estado: { paso: 'catalogo' } };
      if (texto === '2') return menu([textoComoComprar(), textoMenu()]);
      if (texto === '3') return pasarAAsesor();
      return menu([`No entendí tu respuesta. ${textoMenu()}`]);

    case 'catalogo': {
      if (texto === '0') return menu();
      const servicio = elegir(SERVICIOS, texto);
      if (!servicio) {
        return { respuestas: [`No entendí tu respuesta.\n\n${textoCatalogo(moneda)}`], estado };
      }
      return { respuestas: [textoTipos(servicio, moneda)], estado: { paso: 'tipo', servicio: servicio.id } };
    }

    case 'tipo': {
      const servicio = SERVICIOS.find((s) => s.id === estado.servicio);
      if (texto === '0' || !servicio) return { respuestas: [textoCatalogo(moneda)], estado: { paso: 'catalogo' } };
      const tipo = elegir(TIPOS, texto);
      if (!tipo) {
        return { respuestas: [`No entendí tu respuesta.\n\n${textoTipos(servicio, moneda)}`], estado };
      }
      const resumen = resumenPedido(servicio, tipo, moneda);
      return {
        respuestas: [
          `Perfecto, tu pedido: *${resumen}*.`,
          `Haz la transferencia a:\n\n${datosTransferencia}\n\nLuego envía aquí la *foto del comprobante*.`,
        ],
        estado: { paso: 'pago', servicio: servicio.id, tipo: tipo.id },
        aviso: { texto: `Nuevo pedido: ${resumen}. Esperando comprobante.` },
      };
    }

    case 'pago':
    case 'revision': {
      const servicio = SERVICIOS.find((s) => s.id === estado.servicio);
      const tipo = TIPOS.find((t) => t.id === estado.tipo);
      const resumen = servicio && tipo ? resumenPedido(servicio, tipo, moneda) : 'pedido';
      if (mensaje.tieneComprobante) {
        return {
          respuestas: ['¡Recibimos tu comprobante! Lo revisamos y te enviamos los datos de acceso por aquí.'],
          estado: { ...estado, paso: 'revision' },
          aviso: { texto: `Comprobante recibido para: ${resumen}. Revísalo y entrega la cuenta.`, reenviar: true },
        };
      }
      if (estado.paso === 'revision') {
        return {
          respuestas: ['Tu pago está en revisión, en breve te escribimos. Escribe *menu* para volver al inicio.'],
          estado,
        };
      }
      return {
        respuestas: ['Para continuar, envía la *foto del comprobante* de la transferencia. Escribe *menu* para cancelar.'],
        estado,
      };
    }

    case 'asesor':
      // Anthony atiende en persona; el bot calla hasta que el cliente escriba "menu".
      return { respuestas: [], estado };

    default:
      return menu([textoBienvenida()]);
  }
}

function pasarAAsesor() {
  return {
    respuestas: ['Listo, un asesor te escribirá en breve por aquí. Escribe *menu* cuando quieras volver al bot.'],
    estado: { paso: 'asesor' },
    aviso: { texto: 'Un cliente pidió hablar con un asesor.' },
  };
}
