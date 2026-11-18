import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entiendeElMenu } from '../src/bot/conversacion.js';
import { SERVICIOS_BASE } from '../src/catalogo/servicios.js';
import { crearAsistente } from '../src/ia/asistente.js';
import { ejecutarAccion, plataformaQueDijo } from '../src/ia/acciones.js';
import { aFormatoWhatsApp, fechaLegible, instrucciones, interpretarRespuesta, textoDatosDeAcceso, textoMisCuentas, revisarRespuesta, preguntaFinal, repararRespuesta, pideSusCuentas, pideAcceso, rentasNombradas } from '../src/ia/conocimiento.js';
import { procesarMensaje } from '../src/bot/conversacion.js';

const contexto = {
  negocio: 'Streaming Thalia',
  moneda: '$',
  servicios: SERVICIOS_BASE,
  cliente: { id: 'c1', nombre: 'Laura', saldo: 120 },
  rentas: [{ id: 'r1', platform: 'netflix', type: 'perfil', email: 'secreto@x.com', password: 'clave', endDate: '2026-12-01' }],
};

test('pasa el formato de Markdown al de WhatsApp', () => {
  assert.equal(aFormatoWhatsApp('Netflix cuesta **$85 pesos** y __más__\n### Título'), 'Netflix cuesta *$85 pesos* y _más_\nTítulo');
});

test('el menú de números sigue entendiendo números y palabras clave', () => {
  for (const t of ['1', ' 7 ', 'Menu', 'asesor', 'renovar', 'saldo', 'contraseña']) assert.equal(entiendeElMenu(t), true, t);
  for (const t of ['hola', '¿cuánto cuesta netflix?', 'quiero disney']) assert.equal(entiendeElMenu(t), false, t);
});

function fetchFalso(respuestas) {
  const pedidos = [];
  const fn = async (url, opciones) => {
    pedidos.push({ url, cuerpo: JSON.parse(opciones.body) });
    const siguiente = respuestas.shift();
    if (siguiente instanceof Error) throw siguiente;
    return { ok: true, json: async () => ({ message: { content: siguiente } }) };
  };
  fn.pedidos = pedidos;
  return fn;
}

test('si la IA falla, devuelve null y se pausa un minuto', async () => {
  let reloj = 0;
  const fetch = fetchFalso([new Error('timeout'), 'Hola']);
  const asistente = crearAsistente({ url: 'https://ia.x.com', modelo: 'm', esperaMs: 1000, logger: { warn() {} }, fetch, ahora: () => reloj });
  assert.equal(await asistente.conversar('chat', 'hola', contexto), null);
  reloj = 30_000;
  assert.equal(await asistente.conversar('chat', 'hola', contexto), null);
  assert.equal(fetch.pedidos.length, 1);
  reloj = 61_000;
  assert.equal((await asistente.conversar('chat', 'hola', contexto)).texto, 'Hola');
});

test('pide que el modelo se quede cargado y lo precarga al arrancar', async () => {
  const pedidos = [];
  const fetch = async (url, opciones) => {
    pedidos.push({ url, cuerpo: JSON.parse(opciones.body) });
    return { ok: true, json: async () => ({ message: { content: 'Hola' } }) };
  };
  const asistente = crearAsistente({ url: 'https://ia.x.com', modelo: 'novatech', esperaMs: 1000, logger: { info() {}, warn() {} }, fetch });
  await asistente.precalentar();
  await asistente.conversar('chat', 'hola', contexto);
  assert.equal(pedidos[0].url, 'https://ia.x.com/api/generate');
  assert.deepEqual(pedidos[0].cuerpo, { model: 'novatech', keep_alive: '24h' });
  assert.equal(pedidos[1].cuerpo.keep_alive, '24h');
  assert.equal(pedidos[1].cuerpo.options.num_predict, 300);
  assert.equal(pedidos[1].cuerpo.think, false);
});


test('las instrucciones llevan precios con su clave, cuentas numeradas con correo y conocimiento, sin contraseñas', () => {
  const texto = instrucciones({ ...contexto, cliente: { ...contexto.cliente, usuario: 'laura1' } }, 'Horario: 10 am a 10 pm');
  assert.match(texto, /Streaming Thalia/);
  assert.match(texto, /Netflix \[clave: netflix\]: perfil \$80 al mes, cuenta \$200 al mes/);
  assert.match(texto, /Laura\. Usuario de la página: laura1\. Crédito disponible: \$120/);
  assert.match(texto, /Cuenta 1: Netflix \(perfil, correo secreto@x\.com\), vence el 1 de diciembre de 2026 a las 8 pm, renovarla cuesta \$80/);
  assert.match(texto, /Horario: 10 am a 10 pm/);
  assert.doesNotMatch(instrucciones(contexto, 'Garantía: [COMPLETA: días]'), /COMPLETA/);
  assert.match(texto, /Es el primer mensaje: saluda una sola vez/);
  assert.match(texto, /Nunca muestres menús ni listas numeradas/);
  assert.doesNotMatch(texto, /clave'|Contraseña: clave/);
  assert.match(texto, /\[\[mis-cuentas\]\]/);
  assert.match(texto, /emojis/);
  const despues = instrucciones({ ...contexto, pendientes: ['Pedido esperando confirmación del pago: Netflix'], cobradores: [{ nombre: 'Anthony' }, { nombre: 'Thalia' }] }, '', { conversacionEnCurso: true });
  assert.match(despues, /NO saludes/);
  assert.match(despues, /\[\[comprar:CLAVE:TIPO:PAGO:NOMBRE\]\]/);
  assert.match(despues, /pagar a: Anthony, Thalia/);
  assert.match(despues, /EN CURSO[\s\S]*Pedido esperando confirmación/);
});

test('separa la etiqueta de acción de la respuesta', () => {
  assert.deepEqual(interpretarRespuesta('Va, te paso los datos. [[comprar:netflix:perfil:transferencia]]'), {
    texto: 'Va, te paso los datos.',
    accion: { nombre: 'comprar', datos: ['netflix', 'perfil', 'transferencia'] },
  });
  assert.deepEqual(interpretarRespuesta('Listo, lo reporto. [[reportar:1:pide código: en la tele]]').accion, { nombre: 'reportar', datos: ['1', 'pide código', 'en la tele'] });
  assert.deepEqual(interpretarRespuesta('Te paso con alguien. [[asesor]]').accion, { nombre: 'asesor', datos: [] });
  assert.deepEqual(interpretarRespuesta('<think>mmm</think>Hola 👋'), { texto: 'Hola 👋', accion: null });
  assert.equal(interpretarRespuesta('Listo [[volar:1]]').accion, null);
  // Si termina preguntando, solo ofrece.
  assert.deepEqual(interpretarRespuesta('¿Te paso los datos para pagar? [[comprar:netflix:perfil:transferencia]]'), { texto: '¿Te paso los datos para pagar?', accion: null });
});

const contextoAccion = { ...contexto, datosPago: 'BBVA 123', cobradores: [], cliente: { id: 'c1', nombre: 'Laura', saldo: 120 } };

test('comprar por transferencia: manda los datos de pago sin mostrar listas', () => {
  const r = ejecutarAccion({ nombre: 'comprar', datos: ['Netflix', 'perfil', 'transferencia'] }, contextoAccion, procesarMensaje);
  assert.equal(r.estado.paso, 'pago');
  assert.equal(r.acciones[0].tipo, 'crearPedido');
  assert.equal(r.acciones[0].servicio.platform, 'netflix');
  assert.equal(r.acciones[0].servicio.type, 'perfil');
  assert.equal(r.respuestas.some((t) => /Responde con el número|\*1\.\*/.test(t)), false);
  assert.match(r.respuestas.join('\n'), /BBVA 123/);
});

test('comprar con crédito: pide el cobro al servidor', () => {
  const r = ejecutarAccion({ nombre: 'comprar', datos: ['netflix', 'perfil', 'credito'] }, contextoAccion, procesarMensaje);
  assert.equal(r.acciones[0].tipo, 'pagarConCredito');
});

test('renovar, reportar, recargar y asesor por etiqueta', () => {
  const renovar = ejecutarAccion({ nombre: 'renovar', datos: ['1', 'transferencia'] }, contextoAccion, procesarMensaje);
  assert.equal(renovar.acciones[0].tipo, 'crearPedido');
  assert.equal(renovar.acciones[0].renta.id, 'r1');
  const reportar = ejecutarAccion({ nombre: 'reportar', datos: ['1', 'pide código'] }, contextoAccion, procesarMensaje);
  assert.deepEqual(reportar.acciones[0], { tipo: 'reportarCaida', renta: contexto.rentas[0], motivo: 'pide código' });
  const recargar = ejecutarAccion({ nombre: 'recargar', datos: ['$300'] }, contextoAccion, procesarMensaje);
  assert.equal(recargar.acciones[0].monto, 300);
  const asesor = ejecutarAccion({ nombre: 'asesor', datos: [] }, contextoAccion, procesarMensaje);
  assert.equal(asesor.estado.paso, 'asesor');
});

test('con varias personas que cobran, usa la que dijo el cliente o avisa que falta', () => {
  const ctx = { ...contextoAccion, cobradores: [{ nombre: 'Anthony', datos: 'BBVA A' }, { nombre: 'Thalia', datos: 'Banorte T' }] };
  const r = ejecutarAccion({ nombre: 'comprar', datos: ['netflix', 'cuenta', 'transferencia', 'thalia'] }, ctx, procesarMensaje);
  assert.equal(r.acciones[0].cobrador, 1);
  assert.match(r.respuestas.join('\n'), /Banorte T/);
  assert.match(ejecutarAccion({ nombre: 'comprar', datos: ['netflix', 'cuenta', 'transferencia'] }, ctx, procesarMensaje).error, /a quién se le paga/);
});

test('entiende la etiqueta aunque la IA cambie el orden o se salte la forma de pago', () => {
  const vix = [{ id: 'v1', name: 'ViX', platform: 'vix', type: 'perfil', price: 50, duration: 30 }, { id: 'v2', name: 'ViX', platform: 'vix', type: 'cuenta', price: 120, duration: 30 }];
  const ctx = { ...contextoAccion, servicios: [...SERVICIOS_BASE, ...vix], cobradores: [{ nombre: 'Anthony', datos: 'BBVA A' }, { nombre: 'Thalia', datos: 'Banorte T' }] };
  for (const datos of [['vix', 'perfil', 'Anthony'], ['ViX', 'perfil', 'Anthony', 'transferencia'], ['vix', 'perfil', 'transferencia', 'anthony']]) {
    const r = ejecutarAccion({ nombre: 'comprar', datos }, ctx, procesarMensaje);
    assert.equal(r.error, undefined, datos.join(':'));
    assert.equal(r.acciones[0].servicio.platform, 'vix');
    assert.equal(r.acciones[0].cobrador, 0);
  }
  const falta = ejecutarAccion({ nombre: 'renovar', datos: ['1', 'transferencia'] }, ctx, procesarMensaje);
  assert.equal(falta.faltaCobrador, true);
  assert.equal(ejecutarAccion({ nombre: 'renovar', datos: ['1', 'Thalia'] }, ctx, procesarMensaje).acciones[0].cobrador, 1);
});

test('una pregunta con emojis al final no hace la acción', () => {
  assert.equal(interpretarRespuesta('¿Prefieres que los datos vayan a Anthony o a Thalia? 💳 [[renovar:4:transferencia]]').accion, null);
});

test('las instrucciones separan comprar de renovar', () => {
  const texto = instrucciones({ ...contexto, cobradores: [{ nombre: 'Anthony' }, { nombre: 'Thalia' }] });
  assert.match(texto, /COMPRAR es una cuenta NUEVA/);
  assert.match(texto, /\[\[comprar:netflix:perfil:transferencia:Anthony\]\]/);
});

test('datos que no existen dan error en vez de mostrar una lista', () => {
  assert.match(ejecutarAccion({ nombre: 'comprar', datos: ['tiktok', 'perfil'] }, contextoAccion, procesarMensaje).error, /plataforma/);
  assert.match(ejecutarAccion({ nombre: 'renovar', datos: ['9'] }, contextoAccion, procesarMensaje).error, /cuenta/);
  assert.ok(ejecutarAccion({ nombre: 'recargar', datos: ['5'] }, contextoAccion, procesarMensaje).error);
});

test('el asistente recuerda la conversación y lo que hace el bot', async () => {
  const fetch = fetchFalso(['Hola Laura 👋', 'Netflix perfil cuesta $80.', 'Te paso con alguien. [[asesor]]']);
  const asistente = crearAsistente({ url: 'https://ia.x.com/', modelo: 'novatech', esperaMs: 1000, logger: { warn() {} }, fetch });
  assert.equal((await asistente.conversar('chat', 'hola', contexto)).texto, 'Hola Laura 👋');
  asistente.anotar('chat', 'assistant', 'Tu pedido...');
  assert.equal((await asistente.conversar('chat', '¿cuánto cuesta netflix?', contexto)).texto, 'Netflix perfil cuesta $80.');
  const segundo = fetch.pedidos[1];
  assert.equal(segundo.url, 'https://ia.x.com/api/chat');
  assert.equal(segundo.cuerpo.model, 'novatech');
  assert.deepEqual(segundo.cuerpo.messages.slice(1).map((m) => m.role), ['user', 'assistant', 'assistant', 'user']);
  assert.match(segundo.cuerpo.messages[0].content, /NO saludes/);
  assert.match(fetch.pedidos[0].cuerpo.messages[0].content, /saluda una sola vez/);
  assert.equal((await asistente.conversar('chat', 'pagué y no me llega', contexto)).accion.nombre, 'asesor');
  assert.deepEqual(asistente.loQueDijo('chat', 2), ['¿cuánto cuesta netflix?', 'pagué y no me llega']);
});

test('lista las cuentas del cliente con correo, tipo y fecha legible', () => {
  const texto = textoMisCuentas(contexto.rentas, SERVICIOS_BASE, '$');
  assert.match(texto, /tus cuentas activas \(1\)/);
  assert.match(texto, /\*1\. Netflix\* \(perfil\)/);
  assert.match(texto, /📧 secreto@x\.com/);
  assert.match(texto, /📅 Vence el 1 de diciembre de 2026 · 🔄 \$80/);
  assert.doesNotMatch(texto, /clave/);
  assert.match(textoMisCuentas([], SERVICIOS_BASE, '$'), /No tienes cuentas activas/);
  assert.equal(fechaLegible('2026-03-05'), '5 de marzo de 2026');
});

test('datos de acceso: correo y contraseña de la cuenta de la página', () => {
  const texto = textoDatosDeAcceso(contexto.rentas[0], { email: 'secreto@x.com', password: 'Abc123' });
  assert.match(texto, /📧 Correo: secreto@x\.com/);
  assert.match(texto, /🔑 Contraseña: Abc123/);
});

test('reconoce las etiquetas de mis cuentas y datos de acceso', () => {
  assert.deepEqual(interpretarRespuesta('Claro 😊 [[mis-cuentas]]').accion, { nombre: 'mis-cuentas', datos: [] });
  assert.deepEqual(interpretarRespuesta('Va, te los mando 🔑 [[datos:2]]').accion, { nombre: 'datos', datos: ['2'] });
});

test('detecta cuando la IA inventa datos de pago o dice que confirmó un pago', () => {
  const malas = [
    'Aquí tienes los datos de transferencia para pagar a *Anthony* por $85: [Insertar Datos Bancarios Aquí] 🏦💳',
    'Perfecto, por $85, los datos de pago son: *Anthony* 📲. ¿Te envío ahora? 💳',
    'Con transferencia a *Anthony*, aquí tienes los datos bancarios. Recuérdame el comprobante 📲✅',
    '¡Excelente, Luis! Ya confirmé el pago de $85 a *Anthony*. 📲✅',
    'Ya procesé tu recargo de $10,000 MXN. Tu crédito actualizado está listo para usar.',
    'Aquí tienes el resumen de tus cuentas: . ¿Cuál renuevas?',
  ];
  for (const texto of malas) assert.ok(revisarRespuesta({ texto, accion: null }), texto);
  const buenas = [
    '¿Prefieres pagar con tu crédito ($50) o con transferencia? 💳',
    '¿A quién le pagas: Anthony o Thalia? 🙌',
    'Cuando el admin confirme el pago te aviso 🙌',
  ];
  for (const texto of buenas) assert.equal(revisarRespuesta({ texto, accion: null }), null, texto);
  assert.equal(revisarRespuesta({ texto: '¡Va! 🙌 Te mando los datos para renovar.', accion: { nombre: 'renovar', datos: ['1'] } }), null);
  assert.equal(preguntaFinal('Aquí tienes: . ¿Cuál quieres renovar? 📅'), '¿Cuál quieres renovar? 📅');
  assert.equal(preguntaFinal('Listo ✅'), '');
});

test('si la IA inventa, le pide otra respuesta; si insiste, manda un texto seguro', async () => {
  const fetch = fetchFalso(['Ya confirmé tu pago ✅', '¡Va! 🙌 Te mando los datos. [[renovar:1:transferencia]]']);
  const asistente = crearAsistente({ url: 'https://ia.x.com', modelo: 'm', esperaMs: 1000, logger: { warn() {} }, fetch });
  const r = await asistente.conversar('chat', 'renuevo la 1 por transferencia', contexto);
  assert.deepEqual(r.accion, { nombre: 'renovar', datos: ['1', 'transferencia'] });
  assert.equal(fetch.pedidos[1].cuerpo.messages.at(-1).role, 'system');
  const otra = crearAsistente({ url: 'https://ia.x.com', modelo: 'm', esperaMs: 1000, logger: { warn() {} }, fetch: fetchFalso(['Ya confirmé tu pago ✅', 'Ya quedó tu pago ✅']) });
  const segura = await otra.conversar('chat', 'ya pagué', contexto);
  assert.equal(segura.accion, null);
  assert.match(segura.texto, /lo revisa la persona a la que le transferiste/);
});

test('la memoria guarda la etiqueta de la acción', async () => {
  const fetch = fetchFalso(['¡Va! 🙌 [[renovar:1:transferencia]]', 'Listo']);
  const asistente = crearAsistente({ url: 'https://ia.x.com', modelo: 'm', esperaMs: 1000, logger: { warn() {} }, fetch });
  await asistente.conversar('chat', 'renuevo la 1', contexto);
  await asistente.conversar('chat', 'gracias', contexto);
  assert.match(JSON.stringify(fetch.pedidos[1].cuerpo.messages), /\[\[renovar:1:transferencia\]\]/);
});

test('si la IA cambia de servicio, usa el que nombró el cliente', () => {
  const servicios = [...SERVICIOS_BASE, { id: 'v1', name: 'ViX', platform: 'vix', type: 'perfil', price: 50, duration: 30 }, { id: 's1', name: 'Spotify', platform: 'spotify', type: 'cuenta', price: 40, duration: 30 }];
  const accion = { nombre: 'comprar', datos: ['spotify', 'perfil', 'transferencia', 'Anthony'] };
  assert.deepEqual(plataformaQueDijo(accion, servicios, ['Vix', 'Quiero comprar una', 'Perfil y a Anthony']).datos, ['vix', 'perfil', 'transferencia', 'Anthony']);
  assert.equal(plataformaQueDijo(accion, servicios, ['quiero spotify']), accion);
  assert.equal(plataformaQueDijo(accion, servicios, ['quiero algo']), accion);
});

test('mencionar los datos bancarios en una pregunta no se corrige', () => {
  const texto = '¿Quieres comprar un perfil de ViX ($50)? Si es así, dime a quién transfieres (*Anthony* o *Thalia*) para que te dé los datos bancarios. 📺💳';
  assert.equal(revisarRespuesta({ texto, accion: null }), null);
});

test('si anuncia la lista de cuentas sin mostrarla, se manda la lista real', () => {
  const r = repararRespuesta({ texto: 'Te muestro tus cuentas con sus correos y fechas para que veas cuál es: . ¿Cuál te gustaría renovar? 🍿', accion: null });
  assert.deepEqual(r.accion, { nombre: 'mis-cuentas', datos: [] });
  assert.equal(repararRespuesta({ texto: '¿Quieres comprar o renovar? 📺', accion: null }).accion, null);
});

test('reconoce cuando el cliente pregunta por sus propias cuentas', () => {
  for (const t of ['Cuales son mis cuentas?', '¿Qué cuentas tengo?', 'Quiero renovar una cuenta pero nose cual', '¿cuándo vence mi netflix?']) assert.equal(pideSusCuentas(t), true, t);
  for (const t of ['Quiero comprar Vix', 'no sé cuál comprar', 'hola', 'quiero renovar netflix']) assert.equal(pideSusCuentas(t), false, t);
});

test('nunca manda contraseñas en una compra: solo si el cliente las pidió', () => {
  const accion = { nombre: 'datos', datos: ['3'] };
  assert.match(revisarRespuesta({ texto: '¡Genial! ✅ Te envío los datos de acceso ahora mismo.', accion }, 'Uso mi crédito'), /NO pidió/);
  assert.equal(revisarRespuesta({ texto: 'Va 🔑', accion }, 'pásame la contraseña de netflix'), null);
  for (const t of ['pásame la contraseña', 'no me sé el correo', 'cómo entro a disney', 'mis datos de acceso']) assert.equal(pideAcceso(t), true, t);
  for (const t of ['Uso mi crédito', 'Comprar un perfil', 'Anthony por favor']) assert.equal(pideAcceso(t), false, t);
});

test('si la IA manda datos de acceso en una compra, le pide la etiqueta correcta', async () => {
  const fetch = fetchFalso(['Te envío los datos de acceso ahora mismo. [[datos:3]]', '¡Listo! ✅ [[comprar:netflix:perfil:credito]]']);
  const asistente = crearAsistente({ url: 'https://ia.x.com', modelo: 'm', esperaMs: 1000, logger: { warn() {} }, fetch });
  const r = await asistente.conversar('chat', 'Uso mi crédito', contexto);
  assert.deepEqual(r.accion, { nombre: 'comprar', datos: ['netflix', 'perfil', 'credito'] });
});

test('una pregunta con dos puntos no se toma como "aquí tienes" vacío', () => {
  const texto = '¡Perfecto! 🍿 Para renovar *nebulosa@ventasthalia.com* (Netflix perfil), dime: ¿quieres renovar la que vence el 12 o la del 18? También, ¿pagas por transferencia a Anthony o Thalia?';
  assert.equal(revisarRespuesta({ texto, accion: null }), null);
  assert.ok(revisarRespuesta({ texto: 'Te muestro tus cuentas: ¿cuál renuevas?', accion: null }));
});

const rentasAnthony = [
  { id: 'a', platform: 'netflix', type: 'cuenta', email: 'correo@ventasthalia.com', endDate: '2026-12-23', price: 230 },
  { id: 'b', platform: 'disney', type: 'cuenta', email: 'correo@ventasthalia.com', endDate: '2027-01-19', price: 180 },
  { id: 'c', platform: 'netflix', type: 'perfil', email: 'nebulosa@ventasthalia.com', endDate: '2027-02-12', price: 85 },
  { id: 'd', platform: 'vix', type: 'perfil', email: 'raw37@sarquizshop.com', endDate: '2026-12-18', price: 50 },
];

test('reconoce la cuenta que nombra el cliente', () => {
  assert.deepEqual(rentasNombradas('Quiero renovar mi cuenta de nebulosa', rentasAnthony), [2]);
  assert.deepEqual(rentasNombradas('mi perfil de netflix', rentasAnthony), [2]);
  assert.deepEqual(rentasNombradas('la de netflix', rentasAnthony), [0, 2]);
  assert.deepEqual(rentasNombradas('la 4', rentasAnthony), [3]);
  assert.deepEqual(rentasNombradas('quiero renovar', rentasAnthony), []);
});

test('bloquea precios inventados y tipos que la plataforma no tiene', () => {
  const servicios = [...SERVICIOS_BASE, { id: 's1', name: 'Spotify', platform: 'spotify', type: 'cuenta', price: 40, duration: 30 }];
  const ctx = { ...contexto, servicios, cliente: { id: 'c1', nombre: 'Luis', saldo: 415 } };
  assert.match(revisarRespuesta({ texto: 'El perfil de Spotify cuesta $25 al mes 🎵', accion: null }, '¿cuánto el perfil de spotify?', ctx), /\$25 no existe/);
  assert.match(revisarRespuesta({ texto: 'Claro, te vendo un perfil de Spotify 🎵', accion: null }, 'quiero spotify', ctx), /no tiene perfiles/);
  assert.equal(revisarRespuesta({ texto: 'Spotify solo tiene cuenta completa a $40 al mes 🎵', accion: null }, '¿hay perfil de spotify?', ctx), null);
  assert.equal(revisarRespuesta({ texto: 'Netflix perfil cuesta $80 y te quedarían $335 de crédito ✅', accion: null }, 'netflix', ctx), null);
  assert.equal(revisarRespuesta({ texto: 'Para recargar $10,000 te mando los datos ✅', accion: { nombre: 'recargar', datos: ['10000'] } }, '10000', ctx), null);
});

test('PLANES dice qué tipo no hay en cada plataforma', () => {
  const servicios = [...SERVICIOS_BASE, { id: 's1', name: 'Spotify', platform: 'spotify', type: 'cuenta', price: 40, duration: 30 }];
  assert.match(instrucciones({ ...contexto, servicios }), /Spotify \[clave: spotify\]: cuenta \$40 al mes \(NO hay perfiles, solo cuenta completa\)/);
});

test('comprar un tipo que no hay ofrece el que sí hay', () => {
  const servicios = [...SERVICIOS_BASE, { id: 's1', name: 'Spotify', platform: 'spotify', type: 'cuenta', price: 40, duration: 30 }];
  const r = ejecutarAccion({ nombre: 'comprar', datos: ['spotify', 'perfil', 'transferencia'] }, { ...contextoAccion, servicios }, procesarMensaje);
  assert.match(r.aviso, /Spotify no tiene perfiles por ahora; solo cuenta completa a \$40/);
});
