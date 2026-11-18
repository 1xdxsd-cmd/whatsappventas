import { RECARGA_MINIMA } from '../bot/conversacion.js';
import { agruparPorPlataforma, formatearDuracion, formatearPrecio, nombrePlataforma, nombreTipo } from '../catalogo/servicios.js';

// Arma lo que la IA sabe en cada mensaje: solo datos reales (catálogo de la
// página, datos del cliente y el archivo de conocimiento que escribe el
// negocio), para que no invente. Funciones puras, sin red.

function textoPlanes(servicios, moneda) {
  return agruparPorPlataforma(servicios)
    .map((grupo) => {
      const precios = grupo.opciones
        .map((s) => `${s.type === 'cuenta' ? 'cuenta' : 'perfil'} ${formatearPrecio(s.price, moneda)} ${formatearDuracion(s.duration)}`)
        .join(', ');
      return `- ${grupo.nombre} [clave: ${grupo.platform}]: ${precios}`;
    })
    .join('\n');
}

// Lo que paga el cliente por renovar: el precio de su renta o el del catálogo.
function precioDeRenovacion(renta, servicios) {
  const delCatalogo =
    servicios.find((s) => s.platform === renta.platform && s.type === renta.type) ?? servicios.find((s) => s.platform === renta.platform);
  return Number(renta.price) || delCatalogo?.price || 0;
}

// Nunca se le pasan correos ni contraseñas de las cuentas: la IA no entrega accesos.
function textoCliente(cliente, rentas, servicios, moneda) {
  if (!cliente) return 'No está registrado en la página (o no se pudo consultar): no puede renovar, reportar, recargar ni usar crédito; para eso, asesor.';
  const usuario = cliente.usuario ? ` Usuario de la página: ${cliente.usuario}.` : '';
  const lineas = [`Nombre: ${cliente.nombre}.${usuario} Crédito disponible: ${formatearPrecio(cliente.saldo ?? 0, moneda)}.`];
  if (rentas.length === 0) lineas.push('No tiene cuentas activas.');
  rentas.forEach((r, i) => {
    lineas.push(
      `- Cuenta ${i + 1}: ${nombrePlataforma(r.platform)} (${nombreTipo(r.type).toLowerCase()}), vence el ${String(r.endDate).slice(0, 10)} a las 8 pm, renovarla cuesta ${formatearPrecio(precioDeRenovacion(r, servicios), moneda)}`,
    );
  });
  return lineas.join('\n');
}

/**
 * @param {{ negocio: string, moneda: string, servicios: object[], cliente?: object | null, rentas?: object[], pendientes?: string[], cobradores?: object[] }} contexto
 * @param {string} [conocimiento] texto libre del negocio: horarios, políticas, preguntas frecuentes
 * @param {{ conversacionEnCurso?: boolean }} [estado]
 */
export function instrucciones(contexto, conocimiento = '', { conversacionEnCurso = false } = {}) {
  const { negocio, moneda, servicios, cliente = null, rentas = [], pendientes = [], cobradores = [] } = contexto;
  const variosCobradores = cobradores.length >= 2;
  const cobrador = variosCobradores ? ':NOMBRE' : '';
  return [
    `Eres el asistente de WhatsApp de "${negocio}", que vende cuentas y perfiles de streaming en México (precios en pesos mexicanos).`,
    'Responde en español, amable y breve (máximo 3 oraciones), como en un chat de WhatsApp. Para negritas usa un solo asterisco: *así*.',
    conversacionEnCurso
      ? 'Ya están platicando: NO saludes ni repitas el nombre del cliente; sigue la conversación.'
      : 'Es el primer mensaje: saluda una sola vez.',
    'Usa solo los datos de abajo. Si no sabes algo, no lo inventes.',
    'No tienes correos ni contraseñas de cuentas: nunca los des ni los inventes. No puedes confirmar pagos, hacer descuentos, cambiar precios ni prometer fechas.',
    'Nunca muestres menús ni listas numeradas para elegir, ni le pidas números: platica, da tú la información (precios, sus cuentas, vencimientos) y pregunta lo que falte.',
    '',
    'ACCIONES: cuando ya tengas todos los datos y el cliente lo confirmó, termina tu mensaje con UNA etiqueta y el bot la hace (manda los datos de pago, guarda el reporte, etc.). No termines con pregunta si usas etiqueta.',
    `- Comprar: [[comprar:CLAVE:TIPO:PAGO${cobrador}]] (CLAVE de PLANES, TIPO perfil o cuenta, PAGO transferencia o credito).`,
    `- Renovar: [[renovar:N:PAGO${cobrador}]] (N = número de la cuenta del cliente).`,
    '- Reportar una cuenta que no funciona: [[reportar:N:qué le pasa]].',
    `- Recargar crédito: [[recargar:MONTO${cobrador}]] (de ${formatearPrecio(RECARGA_MINIMA, moneda)} en adelante, por transferencia).`,
    '- Cambiar la contraseña de la página: [[clave]] (el bot le pide la nueva).',
    '- Pasarlo con una persona: [[asesor]] (pagó y no se le aplicó, un problema que no puedes resolver, o lo pide). Antes intenta entender qué pasa con una pregunta corta.',
    'Pagar con credito solo si su crédito alcanza y el cliente dijo claramente que quiere usar su crédito; si no, transferencia.',
    ...(variosCobradores ? [`Por transferencia se le puede pagar a: ${cobradores.map((c) => c.nombre).join(', ')}. Pregúntale a quién antes de usar la etiqueta y pon ese NOMBRE.`] : []),
    '',
    'PLANES:',
    textoPlanes(servicios, moneda),
    '',
    'CLIENTE:',
    textoCliente(cliente, rentas, servicios, moneda),
    ...(pendientes.length ? ['', 'EN CURSO (díselo si pregunta por eso):', ...pendientes.map((p) => `- ${p}`)] : []),
    ...(conocimiento.trim() ? ['', 'INFORMACIÓN DEL NEGOCIO:', conocimiento.trim()] : []),
  ].join('\n');
}

// WhatsApp usa *negrita* y _cursiva_ con un solo símbolo, y no entiende títulos
// ni enlaces de Markdown.
export function aFormatoWhatsApp(texto) {
  return texto
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)')
    .replace(/\n{3,}/g, '\n\n');
}

const ACCIONES = ['comprar', 'renovar', 'reportar', 'recargar', 'clave', 'asesor'];

/**
 * Separa la respuesta para el cliente de la etiqueta de acción.
 * @returns {{ texto: string, accion: { nombre: string, datos: string[] } | null }}
 */
export function interpretarRespuesta(respuesta) {
  const crudo = String(respuesta ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const etiqueta = crudo.match(/\[\[\s*([a-záéíóú-]+)\s*((?::[^\]]*)?)\]\]/i);
  const texto = aFormatoWhatsApp(crudo.replace(/\[\[[^\]]*\]\]/g, '').trim());
  if (!etiqueta) return { texto, accion: null };
  const nombre = etiqueta[1].toLowerCase();
  // Si termina preguntando, solo está ofreciendo: espera a que el cliente diga que sí.
  if (!ACCIONES.includes(nombre) || /\?\s*$/.test(texto)) return { texto, accion: null };
  const datos = etiqueta[2] ? etiqueta[2].slice(1).split(':').map((d) => d.trim()) : [];
  return { texto, accion: { nombre, datos } };
}
