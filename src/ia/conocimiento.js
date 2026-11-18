import { agruparPorPlataforma, formatearDuracion, formatearPrecio, nombrePlataforma, nombreTipo } from '../catalogo/servicios.js';

// Arma lo que la IA sabe en cada mensaje: solo datos reales (catálogo de la
// página, datos del cliente y el archivo de conocimiento que escribe el
// negocio), para que no invente. Funciones puras, sin red.

export const OPCIONES_DEL_MENU = {
  1: 'ver planes y precios o comprar',
  2: 'renovar una cuenta',
  3: 'reportar una cuenta que no funciona',
  4: 'saber cómo comprar',
  5: 'hablar con un asesor (una persona)',
  6: 'recuperar su usuario o contraseña de la página',
  7: 'recargar crédito',
};

function textoPlanes(servicios, moneda) {
  return agruparPorPlataforma(servicios)
    .map((grupo) => {
      const precios = grupo.opciones
        .map((s) => `${nombreTipo(s.type).toLowerCase()} ${formatearPrecio(s.price, moneda)} ${formatearDuracion(s.duration)}`)
        .join(', ');
      return `- ${grupo.nombre}: ${precios}`;
    })
    .join('\n');
}

// Nunca se le pasan correos ni contraseñas de las cuentas: la IA no entrega accesos.
function textoCliente(cliente, rentas, moneda) {
  if (!cliente) return 'No está registrado en la página (o no se pudo consultar).';
  const lineas = [`Nombre: ${cliente.nombre}. Crédito disponible: ${formatearPrecio(cliente.saldo ?? 0, moneda)}.`];
  if (rentas.length === 0) lineas.push('No tiene cuentas activas.');
  for (const r of rentas) lineas.push(`- ${nombrePlataforma(r.platform)} (${nombreTipo(r.type).toLowerCase()}), vence el ${String(r.endDate).slice(0, 10)} a las 8 pm`);
  return lineas.join('\n');
}

/**
 * @param {{ negocio: string, moneda: string, servicios: object[], cliente?: object | null, rentas?: object[] }} contexto
 * @param {string} [conocimiento] texto libre del negocio: horarios, políticas, preguntas frecuentes
 */
export function instrucciones(contexto, conocimiento = '') {
  const { negocio, moneda, servicios, cliente = null, rentas = [] } = contexto;
  const menu = Object.entries(OPCIONES_DEL_MENU).map(([n, texto]) => `${n} = ${texto}`).join('; ');
  return [
    `Eres el asistente de WhatsApp de "${negocio}", que vende cuentas y perfiles de streaming en México (precios en pesos mexicanos).`,
    'Responde en español, amable y breve (máximo 4 oraciones), como en un chat de WhatsApp. Puedes usar *negritas* y emojis con moderación.',
    'Usa solo los datos de abajo. Si no sabes algo, no lo inventes: ofrece hablar con un asesor.',
    'No tienes correos ni contraseñas de cuentas: nunca los des ni los inventes. No puedes confirmar pagos, hacer descuentos, cambiar precios ni prometer fechas.',
    'Para comprar: el cliente elige el servicio, paga por transferencia (o con su crédito si le alcanza), manda la foto del comprobante y un asesor confirma y le envía los datos.',
    `Acciones del bot: ${menu}.`,
    'Si el cliente quiere hacer una de esas acciones, termina tu respuesta con la etiqueta [[opcion:N]] (solo una, con su número) y el bot la inicia. Si solo pregunta algo, responde sin etiqueta.',
    '',
    'PLANES:',
    textoPlanes(servicios, moneda),
    '',
    'CLIENTE:',
    textoCliente(cliente, rentas, moneda),
    ...(conocimiento.trim() ? ['', 'INFORMACIÓN DEL NEGOCIO:', conocimiento.trim()] : []),
  ].join('\n');
}

/**
 * Separa la respuesta para el cliente de la etiqueta de acción.
 * @returns {{ texto: string, opcion: number | null }}
 */
export function interpretarRespuesta(respuesta) {
  const crudo = String(respuesta ?? '');
  const etiqueta = crudo.match(/\[\[\s*opci[oó]n\s*:\s*(\d+)\s*\]\]/i);
  const numero = etiqueta ? Number(etiqueta[1]) : null;
  const texto = crudo
    .replace(/\[\[[^\]]*\]\]/g, '')
    // Algunos modelos piensan en voz alta entre <think>...</think>.
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  return { texto, opcion: numero && OPCIONES_DEL_MENU[numero] ? numero : null };
}
