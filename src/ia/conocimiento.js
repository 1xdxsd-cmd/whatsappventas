import { agruparPorPlataforma, formatearDuracion, formatearPrecio, nombrePlataforma, nombreTipo } from '../catalogo/servicios.js';

// Arma lo que la IA sabe en cada mensaje: solo datos reales (catálogo de la
// página, datos del cliente y el archivo de conocimiento que escribe el
// negocio), para que no invente. Funciones puras, sin red.

// Acciones que la IA puede iniciar, por nombre (no por número, para que no le
// pida números al cliente), y la opción del menú que corresponde.
export const ACCIONES = {
  planes: { opcion: 1, cuando: 'quiere ver la lista de planes para comprar' },
  renovar: { opcion: 2, cuando: 'quiere renovar una de sus cuentas' },
  reportar: { opcion: 3, cuando: 'una de sus cuentas no funciona (pide código, contraseña incorrecta, se cayó)' },
  asesor: { opcion: 5, cuando: 'hay que pasarlo con una persona: pagó y no se le aplicó, un problema que no puedes resolver, o lo pide' },
  cuenta: { opcion: 6, cuando: 'olvidó su usuario o contraseña de la página' },
  recargar: { opcion: 7, cuando: 'quiere recargar crédito' },
};

// Qué está viendo el cliente en cada paso del bot.
const PASOS = {
  catalogo: 'la lista de plataformas para comprar',
  tipo: 'las opciones (perfil o cuenta completa) de una plataforma',
  renovar: 'la lista de sus cuentas para elegir cuál renovar',
  reporte: 'la lista de sus cuentas para elegir cuál no funciona',
  'elegir-cobrador': 'la lista de personas a quienes puede transferir',
  cuenta: 'su usuario de la página y la opción de cambiar la contraseña (1)',
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
 * @param {{ negocio: string, moneda: string, servicios: object[], cliente?: object | null, rentas?: object[], pendientes?: string[] }} contexto
 * @param {string} [conocimiento] texto libre del negocio: horarios, políticas, preguntas frecuentes
 * @param {{ paso?: string, conversacionEnCurso?: boolean }} [estado]
 */
export function instrucciones(contexto, conocimiento = '', { paso = 'menu', conversacionEnCurso = false } = {}) {
  const { negocio, moneda, servicios, cliente = null, rentas = [], pendientes = [] } = contexto;
  const acciones = Object.entries(ACCIONES).map(([nombre, a]) => `[[accion:${nombre}]] si ${a.cuando}`).join('; ');
  return [
    `Eres el asistente de WhatsApp de "${negocio}", que vende cuentas y perfiles de streaming en México (precios en pesos mexicanos).`,
    'Responde en español, amable y breve (máximo 3 oraciones), como en un chat de WhatsApp. Para negritas usa un solo asterisco: *así*.',
    conversacionEnCurso
      ? 'Ya están platicando: NO saludes ni repitas el nombre del cliente; sigue la conversación.'
      : 'Es el primer mensaje: saluda una sola vez.',
    'Usa solo los datos de abajo. Si no sabes algo, no lo inventes.',
    'No tienes correos ni contraseñas de cuentas: nunca los des ni los inventes. No puedes confirmar pagos, hacer descuentos, cambiar precios ni prometer fechas.',
    'Para comprar: el cliente elige el servicio, paga por transferencia (o con su crédito si le alcanza), manda la foto del comprobante y un asesor confirma y le envía los datos.',
    'Nunca le pidas al cliente que escriba números ni le muestres menús numerados: entiende lo que quiere y tú inicias la acción.',
    `Para iniciar una acción, termina tu respuesta con una sola etiqueta: ${acciones}. Si solo pregunta algo (por ejemplo un precio), contéstale sin etiqueta.`,
    'Antes de pasarlo con un asesor, intenta entender qué pasa (qué cuenta, qué hizo) con una pregunta corta; si es un problema de pago o algo que no puedes resolver, usa [[accion:asesor]].',
    ...(PASOS[paso]
      ? [`Ahora el cliente está viendo ${PASOS[paso]} (tu último mensaje). Si en su respuesta elige una opción de esa lista, termina con [[elegir:N]] con el número de la opción.`]
      : []),
    '',
    'PLANES:',
    textoPlanes(servicios, moneda),
    '',
    'CLIENTE:',
    textoCliente(cliente, rentas, moneda),
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

/**
 * Separa la respuesta para el cliente de la etiqueta de acción.
 * @returns {{ texto: string, opcion: number | null, elegir: number | null, accion: string | null }}
 */
export function interpretarRespuesta(respuesta) {
  const crudo = String(respuesta ?? '');
  const accion = crudo.match(/\[\[\s*acci[oó]n\s*:\s*([a-z-]+)\s*\]\]/i)?.[1]?.toLowerCase() ?? null;
  const elegir = crudo.match(/\[\[\s*elegir\s*:\s*(\d+)\s*\]\]/i)?.[1];
  // Compatibilidad: [[opcion:N]] con el número del menú.
  const numero = crudo.match(/\[\[\s*opci[oó]n\s*:\s*(\d+)\s*\]\]/i)?.[1];
  const porNombre = accion && ACCIONES[accion] ? ACCIONES[accion].opcion : null;
  const porNumero = numero && Object.values(ACCIONES).some((a) => a.opcion === Number(numero)) ? Number(numero) : null;
  const texto = aFormatoWhatsApp(
    crudo
      .replace(/\[\[[^\]]*\]\]/g, '')
      // Algunos modelos piensan en voz alta entre <think>...</think>.
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim(),
  );
  const opcion = porNombre ?? porNumero;
  return { texto, opcion, elegir: opcion === null && elegir ? Number(elegir) : null, accion: porNombre ? accion : null };
}
