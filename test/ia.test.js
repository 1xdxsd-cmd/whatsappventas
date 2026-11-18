import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entiendeElMenu } from '../src/bot/conversacion.js';
import { SERVICIOS_BASE } from '../src/catalogo/servicios.js';
import { crearAsistente } from '../src/ia/asistente.js';
import { ejecutarAccion } from '../src/ia/acciones.js';
import { aFormatoWhatsApp, instrucciones, interpretarRespuesta } from '../src/ia/conocimiento.js';
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


test('las instrucciones llevan precios con su clave, cuentas numeradas y conocimiento, sin accesos', () => {
  const texto = instrucciones({ ...contexto, cliente: { ...contexto.cliente, usuario: 'laura1' } }, 'Horario: 10 am a 10 pm');
  assert.match(texto, /Streaming Thalia/);
  assert.match(texto, /Netflix \[clave: netflix\]: perfil \$80 al mes, cuenta \$200 al mes/);
  assert.match(texto, /Laura\. Usuario de la página: laura1\. Crédito disponible: \$120/);
  assert.match(texto, /Cuenta 1: Netflix \(perfil\), vence el 2026-12-01 a las 8 pm, renovarla cuesta \$80/);
  assert.match(texto, /Horario: 10 am a 10 pm/);
  assert.match(texto, /Es el primer mensaje: saluda una sola vez/);
  assert.match(texto, /Nunca muestres menús ni listas numeradas/);
  assert.doesNotMatch(texto, /secreto@x\.com/);
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
