import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entiendeElMenu } from '../src/bot/conversacion.js';
import { SERVICIOS_BASE } from '../src/catalogo/servicios.js';
import { crearAsistente } from '../src/ia/asistente.js';
import { aFormatoWhatsApp, instrucciones, interpretarRespuesta } from '../src/ia/conocimiento.js';

const contexto = {
  negocio: 'Streaming Thalia',
  moneda: '$',
  servicios: SERVICIOS_BASE,
  cliente: { id: 'c1', nombre: 'Laura', saldo: 120 },
  rentas: [{ id: 'r1', platform: 'netflix', type: 'perfil', email: 'secreto@x.com', password: 'clave', endDate: '2026-12-01' }],
};

test('las instrucciones llevan precios, datos del cliente y conocimiento, sin accesos', () => {
  const texto = instrucciones(contexto, 'Horario: 10 am a 10 pm');
  assert.match(texto, /Streaming Thalia/);
  assert.match(texto, /Netflix: perfil \$80 al mes, cuenta completa \$200 al mes/i);
  assert.match(texto, /Laura\. Crédito disponible: \$120/);
  assert.match(texto, /Netflix \(perfil\), vence el 2026-12-01/);
  assert.match(texto, /Horario: 10 am a 10 pm/);
  assert.doesNotMatch(texto, /secreto@x\.com/);
});

test('separa la etiqueta de acción de la respuesta', () => {
  assert.deepEqual(interpretarRespuesta('¡Claro! Vamos a renovar. [[accion:renovar]]'), { texto: '¡Claro! Vamos a renovar.', opcion: 2, elegir: null, accion: 'renovar' });
  assert.deepEqual(interpretarRespuesta('Va la de Netflix. [[elegir:3]]'), { texto: 'Va la de Netflix.', opcion: null, elegir: 3, accion: null });
  assert.deepEqual(interpretarRespuesta('Te muestro [[opcion:1]]'), { texto: 'Te muestro', opcion: 1, elegir: null, accion: null });
  assert.deepEqual(interpretarRespuesta('<think>mmm</think>Hola 👋'), { texto: 'Hola 👋', opcion: null, elegir: null, accion: null });
  assert.equal(interpretarRespuesta('Listo [[accion:volar]]').opcion, null);
});

test('pasa el formato de Markdown al de WhatsApp', () => {
  assert.equal(aFormatoWhatsApp('Netflix cuesta **$85 pesos** y __más__\n### Título'), 'Netflix cuesta *$85 pesos* y _más_\nTítulo');
});

test('las instrucciones no ofrecen números y cambian si ya hay conversación', () => {
  const primera = instrucciones(contexto);
  assert.match(primera, /Es el primer mensaje: saluda una sola vez/);
  assert.match(primera, /Nunca le pidas al cliente que escriba números/);
  assert.match(primera, /\[\[accion:renovar\]\]/);
  assert.doesNotMatch(primera, /1 = /);
  const despues = instrucciones({ ...contexto, pendientes: ['Pedido esperando confirmación del pago: Netflix'] }, '', { paso: 'reporte', conversacionEnCurso: true });
  assert.match(despues, /NO saludes/);
  assert.match(despues, /lista de sus cuentas para elegir cuál no funciona[\s\S]*\[\[elegir:N\]\]/);
  assert.match(despues, /EN CURSO[\s\S]*Pedido esperando confirmación/);
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

test('el asistente recuerda la conversación, lo que hace el bot y manda el modelo configurado', async () => {
  const fetch = fetchFalso(['Hola Laura 👋', 'Netflix perfil cuesta $80.', 'Va. [[accion:asesor]]']);
  const asistente = crearAsistente({ url: 'https://ia.x.com/', modelo: 'novatech', esperaMs: 1000, logger: { warn() {} }, fetch });
  assert.equal((await asistente.conversar('chat', 'hola', contexto)).texto, 'Hola Laura 👋');
  asistente.anotar('chat', 'user', '1');
  asistente.anotar('chat', 'assistant', 'Planes (pesos mexicanos)...');
  assert.equal((await asistente.conversar('chat', '¿cuánto cuesta netflix?', contexto, 'catalogo')).texto, 'Netflix perfil cuesta $80.');
  const segundo = fetch.pedidos[1];
  assert.equal(segundo.url, 'https://ia.x.com/api/chat');
  assert.equal(segundo.cuerpo.model, 'novatech');
  assert.deepEqual(segundo.cuerpo.messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.match(segundo.cuerpo.messages[0].content, /NO saludes/);
  assert.match(fetch.pedidos[0].cuerpo.messages[0].content, /saluda una sola vez/);
  const tercero = await asistente.conversar('chat', 'pagué y no me llega', contexto);
  assert.equal(tercero.accion, 'asesor');
  assert.deepEqual(asistente.loQueDijo('chat', 2), ['¿cuánto cuesta netflix?', 'pagué y no me llega']);
});

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

test('si la IA termina preguntando, solo ofrece: no inicia la acción', () => {
  assert.deepEqual(interpretarRespuesta('¡Hola! ¿Te gustaría ver la lista de planes? [[accion:planes]]'), {
    texto: '¡Hola! ¿Te gustaría ver la lista de planes?',
    opcion: null,
    elegir: null,
    accion: null,
  });
  assert.equal(interpretarRespuesta('¡Va! Aquí están. [[accion:planes]]').opcion, 1);
});
