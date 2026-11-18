import { RECARGA_MINIMA } from '../bot/conversacion.js';
import { agruparPorPlataforma, fechaLegible, formatearDuracion, formatearPrecio, nombrePlataforma, nombreTipo } from '../catalogo/servicios.js';

export { fechaLegible };

// Arma lo que la IA sabe en cada mensaje: solo datos reales (catálogo de la
// página, datos del cliente y el archivo de conocimiento que escribe el
// negocio), para que no invente. Funciones puras, sin red.

function textoPlanes(servicios, moneda) {
  return agruparPorPlataforma(servicios)
    .map((grupo) => {
      const precios = grupo.opciones
        .map((s) => `${s.type === 'cuenta' ? 'cuenta' : 'perfil'} ${formatearPrecio(s.price, moneda)} ${formatearDuracion(s.duration)}`)
        .join(', ');
      const tipos = new Set(grupo.opciones.map((s) => (s.type === 'cuenta' ? 'cuenta' : 'perfil')));
      const falta = !tipos.has('perfil') ? ' (NO hay perfiles, solo cuenta completa)' : !tipos.has('cuenta') ? ' (NO hay cuenta completa, solo perfiles)' : '';
      return `- ${grupo.nombre} [clave: ${grupo.platform}]: ${precios}${falta}`;
    })
    .join('\n');
}

// Lo que paga el cliente por renovar: el precio de su renta o el del catálogo.
function precioDeRenovacion(renta, servicios) {
  const delCatalogo =
    servicios.find((s) => s.platform === renta.platform && s.type === renta.type) ?? servicios.find((s) => s.platform === renta.platform);
  return Number(renta.price) || delCatalogo?.price || 0;
}

const tipoLargo = (tipo) => (tipo === 'cuenta' ? 'cuenta completa' : 'perfil');

/**
 * La lista de cuentas del cliente tal como se le manda por WhatsApp
 * ([[mis-cuentas]]): exacta, sin depender de que la IA cuente bien.
 */
export function textoMisCuentas(rentas, servicios, moneda) {
  if (rentas.length === 0) return 'No tienes cuentas activas por ahora. 🙂';
  return [`Estas son tus cuentas activas (${rentas.length}): 📺`, ...rentas.map((r, i) => lineaDeCuenta(r, i, servicios, moneda))].join('\n\n');
}

// "Netflix", "ViX", "Fox": el nombre del catálogo de la página si no está en la lista fija.
export function nombreDe(platform, servicios = []) {
  const delCatalogo = servicios.find((s) => s.platform === platform)?.name;
  const nombre = nombrePlataforma(platform, delCatalogo);
  return nombre === platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : nombre;
}

function lineaDeCuenta(r, i, servicios, moneda) {
  const correo = r.email ? `\n   📧 ${r.email}` : '';
  return `*${i + 1}. ${nombreDe(r.platform, servicios)}* (${tipoLargo(r.type)})${correo}\n   📅 Vence el ${fechaLegible(r.endDate)} · 🔄 ${formatearPrecio(precioDeRenovacion(r, servicios), moneda)}`;
}

// Solo las cuentas que puede querer renovar, para que elija por nombre o correo.
// `indices`: posiciones en la lista completa, para que "la 3" sea siempre la misma cuenta.
export function textoElegirCuenta(rentas, indices, servicios, moneda) {
  return ['¿Cuál quieres renovar? 🔄 Dime el servicio o el correo:', ...indices.map((i) => lineaDeCuenta(rentas[i], i, servicios, moneda))].join('\n\n');
}

/**
 * La renta a la que se refiere el cliente ("mi perfil de nebulosa de Netflix"):
 * por la parte del correo antes de la @, por la plataforma o por "la 2".
 * Devuelve sus posiciones (desde 0) que coinciden.
 */
export function rentasNombradas(texto, rentas, servicios = []) {
  const t = String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const indices = rentas.map((_, i) => i);
  const porCorreo = indices.filter((i) => {
    const usuario = String(rentas[i].email ?? '').split('@')[0].toLowerCase();
    return usuario.length >= 4 && t.includes(usuario);
  });
  const porPlataforma = (lista) =>
    lista.filter((i) => {
      const r = rentas[i];
      return [r.platform, nombreDe(r.platform, servicios)].some((n) => n && n.length >= 3 && t.includes(n.toLowerCase().replace(/\+/g, '')));
    });
  const porTipo = (lista) => {
    const tipo = /\bperfil/.test(t) ? 'perfil' : /complet|cuenta entera/.test(t) ? 'cuenta' : null;
    return tipo ? lista.filter((i) => rentas[i].type === tipo) : lista;
  };
  if (porCorreo.length) {
    const finas = porTipo(porPlataforma(porCorreo).length ? porPlataforma(porCorreo) : porCorreo);
    return finas.length ? finas : porCorreo;
  }
  const numero = t.match(/\b(?:la|cuenta|numero|#)\s*(\d{1,2})\b/);
  if (numero && rentas[Number(numero[1]) - 1]) return [Number(numero[1]) - 1];
  const plataforma = porPlataforma(indices);
  return plataforma.length ? porTipo(plataforma) : [];
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
    'Escribe con buena ortografía, en español de México y de tú ("lo renuevo", "te lo cobro"). Nunca le digas al cliente las claves internas ([clave: ...]) ni le menciones etiquetas.',
    'Son las cuentas del propio cliente: puedes decirle el correo y la fecha de cada una. Las contraseñas no las tienes: si las pide, usa [[datos:N]] y el bot se las manda. Nunca inventes datos. No puedes confirmar pagos, hacer descuentos, cambiar precios ni prometer fechas.',
    'Nunca muestres menús ni listas numeradas para elegir, ni le pidas números de cuenta: pregúntale por el servicio o el correo. Las fechas siempre completas ("12 de febrero de 2027"). No digas "aquí tienes..." si no lo estás mostrando en ese mismo mensaje.',
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
    '- Mandarle el correo y la contraseña de una de sus cuentas que YA tiene: [[datos:N]] (solo si te pide su contraseña o sus accesos; nunca en una compra o renovación).',
    '- Pasarlo con una persona: [[asesor]] (pagó y no se le aplicó, un problema que no puedes resolver, o lo pide). Antes intenta entender qué pasa con una pregunta corta.',
    'Pagar con credito solo si su crédito alcanza y el cliente dijo claramente que quiere usar su crédito; si no, transferencia.',
    ...(variosCobradores ? [`Por transferencia se le puede pagar a: ${cobradores.map((c) => c.nombre).join(', ')}. Pregúntale a quién nombrando a todos (${cobradores.map((c) => c.nombre).join(' o ')}) antes de usar la etiqueta y pon ese NOMBRE.`] : []),
    'COMPRAR es una cuenta NUEVA (de PLANES); RENOVAR es extender una de las cuentas que ya tiene el cliente (Cuenta N). Si dice "comprar", "una nueva" u "otra", es comprar: no hables de renovar. Si solo nombra una plataforma ("Vix"), pregúntale si quiere comprar una nueva' + (rentas.length ? ' o renovar una que ya tiene' : '') + '.',
    'EJEMPLOS:',
    'cliente: "renuevo la 2 por transferencia' + (variosCobradores ? ` a ${cobradores[0].nombre}` : '') + '" → tú: "¡Va! 🙌 Te mando los datos para renovar tu cuenta. [[renovar:2:transferencia' + (variosCobradores ? `:${cobradores[0].nombre}` : '') + ']]"',
    'cliente: "uso mi crédito" (para COMPRAR un perfil nuevo de ViX) → tú: "¡Va! ✅ Lo pago con tu crédito. [[comprar:vix:perfil:credito]]" (el bot cobra y entrega solo)',
    'cliente: "uso mi crédito" (para RENOVAR su Cuenta 3) → tú: "¡Va! ✅ La renuevo con tu crédito. [[renovar:3:credito]]". Una renovación NUNCA es [[comprar:...]].',
    'cliente: "quiero un perfil de netflix, pago por transferencia' + (variosCobradores ? ` a ${cobradores[0].nombre}` : '') + '" → tú: "¡Perfecto! 🍿 Te mando los datos para tu perfil de Netflix. [[comprar:netflix:perfil:transferencia' + (variosCobradores ? `:${cobradores[0].nombre}` : '') + ']]"',
    '',
    'PLANES (solo existe lo que está en esta lista; si piden un tipo que no hay, dile que no está disponible y ofrece el que sí hay con su precio exacto; nunca calcules ni inventes precios):',
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

// Termina en pregunta aunque lleve emojis después ("¿Anthony o Thalia? 💳").
export const esPregunta = (texto) => /\?[^\p{L}\p{N}]*$/u.test(texto);

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
  if (!ACCIONES.includes(nombre) || esPregunta(texto)) return { texto, accion: null };
  const datos = etiqueta[2] ? etiqueta[2].slice(1).split(':').map((d) => d.trim()) : [];
  return { texto, accion: { nombre, datos } };
}

// Lo que un modelo chico suele hacer mal pese a las instrucciones: inventar
// datos de pago, decir que confirmó un pago o anunciar algo que no muestra.
// Devuelve la corrección para pedirle otra respuesta, o null si está bien.
// Precios que puede decir la IA: los del catálogo, los de renovar sus cuentas,
// su crédito y los montos que escribió el cliente.
function preciosValidos(contexto, dicho) {
  const { servicios = [], rentas = [], cliente } = contexto;
  const validos = new Set([...servicios.map((s) => Number(s.price)), ...rentas.map((r) => precioDeRenovacion(r, servicios)), Number(cliente?.saldo ?? 0), RECARGA_MINIMA]);
  for (const m of String(dicho).matchAll(/\d[\d,.]*/g)) validos.add(Number(m[0].replace(/,/g, '')));
  // "te quedarían $330": su crédito menos un precio.
  const saldo = Number(cliente?.saldo ?? 0);
  for (const precio of [...validos]) if (saldo > precio) validos.add(saldo - precio);
  return validos;
}

const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "perfil de Spotify" cuando Spotify solo tiene cuenta completa (salvo que lo esté aclarando).
function tipoQueNoHay(texto, servicios) {
  if (/no (hay|tiene|tenemos|manejamos|est[aá] disponible)|solo|s[oó]lo|[uú]nicamente/i.test(texto)) return null;
  for (const grupo of agruparPorPlataforma(servicios)) {
    const tipos = new Set(grupo.opciones.map((s) => (s.type === 'cuenta' ? 'cuenta' : 'perfil')));
    const nombre = escapar(grupo.nombre);
    const cerca = (t) => new RegExp(`${t}[^.?!]{0,25}${nombre}|${nombre}[^.?!]{0,25}${t}`, 'i').test(texto);
    if (!tipos.has('perfil') && cerca('perfil')) return `${grupo.nombre} no tiene perfiles, solo cuenta completa`;
    if (!tipos.has('cuenta') && cerca('cuenta completa')) return `${grupo.nombre} no tiene cuenta completa, solo perfiles`;
  }
  return null;
}

export function revisarRespuesta({ texto, accion }, dicho = '', contexto = null) {
  if (contexto?.servicios?.length) {
    const validos = preciosValidos(contexto, dicho);
    const inventado = [...texto.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, ''))).find((n) => !validos.has(n));
    if (inventado !== undefined) {
      return `El precio $${inventado} no existe. Usa solo los precios exactos de PLANES o de sus cuentas; si el tipo que pide no está en PLANES, dile que no está disponible y ofrece el que sí hay.`;
    }
    const noHay = tipoQueNoHay(texto, contexto.servicios);
    if (noHay) return `Ojo: ${noHay}. Díselo al cliente y ofrécele lo que sí hay, con su precio exacto de PLANES.`;
  }
  // Las contraseñas de sus cuentas solo cuando las pide: una compra o un pago
  // nunca se contestan con los datos de otra cuenta.
  if (accion?.nombre === 'datos' && !pideAcceso(dicho)) {
    return 'El cliente NO pidió los datos de acceso de sus cuentas: no uses [[datos:N]]. Si quiere comprar o renovar, usa [[comprar:...]] o [[renovar:...]]; con crédito el bot cobra y entrega solo.';
  }
  if (/\[[^\]]*\]/.test(texto)) {
    return 'Escribiste un texto entre corchetes. No pongas datos inventados ni espacios para rellenar: si toca mandar datos de pago, pon la etiqueta y el bot los manda.';
  }
  if (accion) return null;
  if (/(confirmé|procesé|apliqué|acredité|registré|recibí|ya (confirm|proces|apliqu|acredit|recib)\S*)\s[^.!?]*(pago|recarga|cr[eé]dito|comprobante|transferencia)|cr[eé]dito (ya )?(est[aá] )?actualizado|ya (qued[oó]|est[aá]) (tu|el|la) (pago|recarga|cr[eé]dito)/i.test(texto)) {
    return 'No puedes confirmar ni procesar pagos ni recargas, ni ver comprobantes. Corrige: dile que un admin revisa su comprobante, y si falta generar el pedido usa la etiqueta que corresponde.';
  }
  const hablaDeDatos = /(datos (bancarios|de pago|de (la )?transferencia|para (transferir|pagar))|cuenta para transferir|clabe)/i.test(texto);
  const losDa = /(datos[^.!?¿]{0,40}\b(son|aqu[ií])\b|aqu[ií] (tienes|est[aá]n|van) (los|tus)? ?datos|te (env[ií]o|mando|paso) (los|tus) datos)/i.test(texto);
  // Mencionarlos en una pregunta ("¿a quién le pagas para darte los datos bancarios?") está bien.
  if (losDa || (hablaDeDatos && !texto.includes('?'))) {
    return 'No tienes datos bancarios. Si el cliente ya dijo qué paga, cómo y a quién, responde con una frase corta y la etiqueta al final; si falta algo, pregúntalo.';
  }
  if (/n[uú]mero de (la |tu )?cuenta|\(de 1 a \d+\)|\bdel 1 al \d+/i.test(texto)) {
    return 'No le pidas números de cuenta: pregúntale qué servicio o qué correo quiere, o usa [[mis-cuentas]] para que vea la lista.';
  }
  if (anunciaSinMostrar(texto)) {
    return 'Dijiste "aquí tienes" sin mostrar nada. Si es la lista de sus cuentas usa [[mis-cuentas]]; si no, da la información en el mensaje.';
  }
  return null;
}

// La pregunta con la que cierra un mensaje ("¿Cuál quieres renovar? 📅"), o ''.
export function preguntaFinal(texto) {
  const inicio = texto.lastIndexOf('¿');
  return inicio >= 0 && texto.indexOf('?', inicio) >= 0 ? texto.slice(inicio).trim() : '';
}

// "Aquí tienes tus cuentas: ." / "Te muestro tus cuentas para que veas cuál es: ."
// "dime: ¿quieres...?" sí es válido: los dos puntos antes de una pregunta solo
// cuentan si anunciaba algo ("te muestro tus cuentas: ¿cuál...?").
const anunciaSinMostrar = (texto) =>
  /:\s*[.!]/.test(texto) || /:\s*$/.test(texto) || /(aqu[ií]|muestro|lista|est[aá]s? son|est[aá]n)[^.!?¿:]*:\s*¿/i.test(texto);

// El modelo anunció la lista de cuentas sin la etiqueta: se manda la lista real.
export function repararRespuesta(resultado) {
  if (resultado.accion || !anunciaSinMostrar(resultado.texto) || !/cuentas?\b/i.test(resultado.texto)) return resultado;
  return { ...resultado, accion: { nombre: 'mis-cuentas', datos: [] } };
}

// Si tras la corrección la IA sigue mal, se manda esto en vez de su texto.
export function respaldoPara(correccion, cobradores = []) {
  if (correccion.startsWith('No puedes confirmar')) {
    return 'Tu pago lo revisa la persona a la que le transferiste; en cuanto lo apruebe te avisamos por aquí. 🙌';
  }
  if (correccion.startsWith('No tienes datos') || correccion.startsWith('Escribiste un texto')) {
    const quien = cobradores.length >= 2 ? ` y a quién le transfieres (${cobradores.map((c) => c.nombre).join(' o ')})` : '';
    return `Para mandarte los datos de pago dime qué quieres, si es compra o renovación${quien}. 🙂`;
  }
  if (correccion.startsWith('El precio') || correccion.startsWith('Ojo:')) return 'Perdón, me confundí con el precio. 😅 ¿De qué plataforma lo quieres? Te digo exactamente qué hay y cuánto cuesta.';
  if (correccion.startsWith('El cliente NO pidió')) return '¿Me confirmas qué quieres comprar o renovar y cómo lo pagas? 🙂';
  return 'Perdón, no te entendí bien. 😅 ¿Me lo dices con otras palabras?';
}

// Preguntas obvias por sus propias cuentas: se contestan con la lista real sin
// esperar a que el modelo ponga la etiqueta.
export function pideSusCuentas(texto) {
  const t = String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\bmis (cuentas|rentas|servicios|suscripciones|perfiles)\b|que (cuentas|servicios|perfiles) tengo|cuales (son las que |cuentas )?tengo|cuando (se )?vence|que (se )?me vence/.test(t) || (/renov/.test(t) && /no se cual|nose cual|no recuerdo cual|cuales puedo/.test(t));
}

// "pásame la contraseña", "no me sé el correo de mi netflix", "datos de acceso"...
export function pideAcceso(texto) {
  const t = String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /contrasen|password|clave|correo|acceso|datos de (mi|la|mis|las) (cuenta|perfil)|como (entro|inicio)|iniciar sesion/.test(t);
}
