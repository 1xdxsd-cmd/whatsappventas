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

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// 2026-12-23 -> 23 de diciembre de 2026
export function fechaLegible(fecha) {
  const [anio, mes, dia] = String(fecha).slice(0, 10).split('-').map(Number);
  if (!anio || !mes || !dia) return String(fecha);
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}

const tipoLargo = (tipo) => (tipo === 'cuenta' ? 'cuenta completa' : 'perfil');

/**
 * La lista de cuentas del cliente tal como se le manda por WhatsApp
 * ([[mis-cuentas]]): exacta, sin depender de que la IA cuente bien.
 */
export function textoMisCuentas(rentas, servicios, moneda) {
  if (rentas.length === 0) return 'No tienes cuentas activas por ahora. 🙂';
  const lineas = rentas.map((r) =>
    [
      `📺 *${nombrePlataforma(r.platform)}* (${tipoLargo(r.type)})`,
      ...(r.email ? [`📧 ${r.email}`] : []),
      `📅 Vence el ${fechaLegible(r.endDate)} a las 8 pm`,
      `🔄 Renovar: ${formatearPrecio(precioDeRenovacion(r, servicios), moneda)}`,
    ].join('\n'),
  );
  return [`Estas son tus cuentas activas (${rentas.length}):`, ...lineas].join('\n\n');
}

export function textoDatosDeAcceso(renta, cuenta) {
  return [
    `📺 *${nombrePlataforma(renta.platform)}* (${tipoLargo(renta.type)})`,
    `📧 Correo: ${cuenta.email || renta.email || '(sin correo)'}`,
    `🔑 Contraseña: ${cuenta.password || '(pídela a un asesor)'}`,
    `📅 Vence el ${fechaLegible(renta.endDate)} a las 8 pm`,
    '',
    'Por seguridad, no compartas estos datos. 🔒',
  ].join('\n');
}

function textoCliente(cliente, rentas, servicios, moneda) {
  if (!cliente) return 'No está registrado en la página (o no se pudo consultar): no puede renovar, reportar, recargar ni usar crédito; para eso, asesor.';
  const usuario = cliente.usuario ? ` Usuario de la página: ${cliente.usuario}.` : '';
  const lineas = [`Nombre: ${cliente.nombre}.${usuario} Crédito disponible: ${formatearPrecio(cliente.saldo ?? 0, moneda)}.`];
  if (rentas.length === 0) lineas.push('No tiene cuentas activas.');
  rentas.forEach((r, i) => {
    const correo = r.email ? `, correo ${r.email}` : '';
    lineas.push(
      `- Cuenta ${i + 1}: ${nombrePlataforma(r.platform)} (${tipoLargo(r.type)}${correo}), vence el ${fechaLegible(r.endDate)} a las 8 pm, renovarla cuesta ${formatearPrecio(precioDeRenovacion(r, servicios), moneda)}`,
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
  // Los huecos sin llenar ([COMPLETA: ...]) enseñan al modelo a escribir corchetes.
  const informacion = conocimiento.replace(/\[COMPLETA[^\]]*\]/gi, '').replace(/\n{3,}/g, '\n\n');
  const variosCobradores = cobradores.length >= 2;
  const cobrador = variosCobradores ? ':NOMBRE' : '';
  return [
    `Eres el asistente de WhatsApp de "${negocio}", que vende cuentas y perfiles de streaming en México (precios en pesos mexicanos).`,
    'Responde en español, amable, cálido y breve (máximo 3 oraciones), como en un chat de WhatsApp, con 1 a 3 emojis que vengan al caso (📺 🍿 ✅ 📅 💳 🙌). Para negritas usa un solo asterisco: *así*.',
    conversacionEnCurso
      ? 'Ya están platicando: NO saludes ni repitas el nombre del cliente; sigue la conversación.'
      : 'Es el primer mensaje: saluda una sola vez.',
    'Usa solo los datos de abajo. Si no sabes algo, no lo inventes.',
    'Son las cuentas del propio cliente: puedes decirle el correo y la fecha de cada una. Las contraseñas no las tienes: si las pide, usa [[datos:N]] y el bot se las manda. Nunca inventes datos. No puedes confirmar pagos, hacer descuentos, cambiar precios ni prometer fechas.',
    'Nunca muestres menús ni listas numeradas para elegir, ni le pidas números: platica, da tú la información y pregunta lo que falte. No digas "aquí tienes..." si no lo estás mostrando en ese mismo mensaje.',
    'Si pregunta qué cuentas tiene, sus fechas o sus correos, usa [[mis-cuentas]] y el bot le manda la lista exacta (no la cuentes tú).',
    'Tú NO tienes los datos bancarios: el bot los manda solo cuando pones la etiqueta. Nunca escribas datos de pago, ni textos entre corchetes como [datos], ni digas que los vas a mandar sin la etiqueta.',
    'Tú no ves fotos ni comprobantes y no puedes confirmar pagos ni cargar crédito: nunca digas que ya confirmaste, procesaste o aplicaste un pago o una recarga. Lo aprueba la persona a la que le transfirió (por ejemplo Anthony o Thalia) al revisar el comprobante: dile que quedó en revisión con esa persona.',
    'Si manda una foto o dice que ya pagó y no hay nada EN CURSO: si ya sabes qué paga, cómo y a quién, pon la etiqueta de esa compra, renovación o recarga (el bot toma la foto como comprobante); si no, pregúntale qué está pagando. Si dice que pagó y no se le aplicó, usa [[asesor]].',
    '',
    'ACCIONES: en cuanto tengas los datos (qué, cómo paga y, si aplica, a quién), termina tu mensaje con UNA etiqueta y el bot la hace (manda los datos de pago, guarda el reporte, etc.). No preguntes "¿te los mando?": ponla de una vez. No termines con pregunta si usas etiqueta.',
    `- Comprar: [[comprar:CLAVE:TIPO:PAGO${cobrador}]] (CLAVE de PLANES, TIPO perfil o cuenta, PAGO transferencia o credito).`,
    `- Renovar: [[renovar:N:PAGO${cobrador}]] (N = número de la cuenta del cliente).`,
    '- Reportar una cuenta que no funciona: [[reportar:N:qué le pasa]].',
    `- Recargar crédito: [[recargar:MONTO${cobrador}]] (de ${formatearPrecio(RECARGA_MINIMA, moneda)} en adelante, por transferencia).`,
    '- Cambiar la contraseña de la página: [[clave]] (el bot le pide la nueva).',
    '- Mostrarle sus cuentas con correo, tipo y vencimiento: [[mis-cuentas]].',
    '- Mandarle el correo y la contraseña de una de sus cuentas: [[datos:N]].',
    '- Pasarlo con una persona: [[asesor]] (pagó y no se le aplicó, un problema que no puedes resolver, o lo pide). Antes intenta entender qué pasa con una pregunta corta.',
    'Pagar con credito solo si su crédito alcanza y el cliente dijo claramente que quiere usar su crédito; si no, transferencia.',
    ...(variosCobradores ? [`Por transferencia se le puede pagar a: ${cobradores.map((c) => c.nombre).join(', ')}. Pregúntale a quién nombrando a todos (${cobradores.map((c) => c.nombre).join(' o ')}) antes de usar la etiqueta y pon ese NOMBRE.`] : []),
    'EJEMPLO: cliente: "renuevo la 2 por transferencia" → tú: "¡Va! 🙌 Te mando los datos para renovar tu Netflix. [[renovar:2:transferencia' + (variosCobradores ? `:${cobradores[0].nombre}` : '') + ']]"',
    '',
    'PLANES:',
    textoPlanes(servicios, moneda),
    '',
    'CLIENTE:',
    textoCliente(cliente, rentas, servicios, moneda),
    ...(pendientes.length ? ['', 'EN CURSO (díselo si pregunta por eso):', ...pendientes.map((p) => `- ${p}`)] : []),
    ...(informacion.trim() ? ['', 'INFORMACIÓN DEL NEGOCIO:', informacion.trim()] : []),
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

const ACCIONES = ['comprar', 'renovar', 'reportar', 'recargar', 'clave', 'asesor', 'mis-cuentas', 'datos'];

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

// Lo que un modelo chico suele hacer mal pese a las instrucciones: inventar
// datos de pago, decir que confirmó un pago o anunciar algo que no muestra.
// Devuelve la corrección para pedirle otra respuesta, o null si está bien.
export function revisarRespuesta({ texto, accion }) {
  if (/\[[^\]]*\]/.test(texto)) {
    return 'Escribiste un texto entre corchetes. No pongas datos inventados ni espacios para rellenar: si toca mandar datos de pago, pon la etiqueta y el bot los manda.';
  }
  if (accion) return null;
  if (/(confirmé|procesé|apliqué|acredité|registré|recibí|ya (confirm|proces|apliqu|acredit|recib)\S*)\s[^.!?]*(pago|recarga|cr[eé]dito|comprobante|transferencia)|cr[eé]dito (ya )?(est[aá] )?actualizado|ya (qued[oó]|est[aá]) (tu|el|la) (pago|recarga|cr[eé]dito)/i.test(texto)) {
    return 'No puedes confirmar ni procesar pagos ni recargas, ni ver comprobantes. Corrige: dile que un admin revisa su comprobante, y si falta generar el pedido usa la etiqueta que corresponde.';
  }
  const hablaDeDatos = /(datos (bancarios|de pago|de (la )?transferencia|para (transferir|pagar))|cuenta para transferir|clabe)/i.test(texto);
  const losDa = /(datos[^.!?¿]{0,40}\b(son|aqu[ií])\b|aqu[ií] (tienes|est[aá]n|van) (los|tus)? ?datos|te (env[ií]o|mando|paso) (los|tus) datos)/i.test(texto);
  if (losDa || (hablaDeDatos && !/\?\s*\S{0,6}\s*$/.test(texto))) {
    return 'No tienes datos bancarios. Si el cliente ya dijo qué paga, cómo y a quién, responde con una frase corta y la etiqueta al final; si falta algo, pregúntalo.';
  }
  if (/aqu[ií] (tienes|est[aá]n?)\b[^.!?]*:\s*[.!¿]/i.test(texto)) {
    return 'Dijiste "aquí tienes" sin mostrar nada. Si es la lista de sus cuentas usa [[mis-cuentas]]; si no, da la información en el mensaje.';
  }
  return null;
}

// La pregunta con la que cierra un mensaje ("¿Cuál quieres renovar? 📅"), o ''.
export function preguntaFinal(texto) {
  const inicio = texto.lastIndexOf('¿');
  return inicio >= 0 && texto.indexOf('?', inicio) >= 0 ? texto.slice(inicio).trim() : '';
}
