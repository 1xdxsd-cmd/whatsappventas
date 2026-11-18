import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entiendeElMenu } from '../src/bot/conversacion.js';
import { SERVICIOS_BASE } from '../src/catalogo/servicios.js';
import { crearAsistente } from '../src/ia/asistente.js';
import { instrucciones, interpretarRespuesta } from '../src/ia/conocimiento.js';

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
  assert.deepEqual(interpretarRespuesta('¡Claro! Te muestro los planes. [[opcion:1]]'), { texto: '¡Claro! Te muestro los planes.', opcion: 1 });
  assert.deepEqual(interpretarRespuesta('<think>mmm</think>Hola 👋'), { texto: 'Hola 👋', opcion: null });
  assert.deepEqual(interpretarRespuesta('Listo [[opcion:9]]'), { texto: 'Listo', opcion: null });
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

test('el asistente recuerda la conversación y manda el modelo configurado', async () => {
  const fetch = fetchFalso(['Hola Laura 👋', 'Netflix perfil cuesta $80. [[opcion:1]]']);
  const asistente = crearAsistente({ url: 'https://ia.x.com/', modelo: 'novatech', esperaMs: 1000, logger: { warn() {} }, fetch });
  assert.deepEqual(await asistente.conversar('chat', 'hola', contexto), { texto: 'Hola Laura 👋', opcion: null });
  assert.deepEqual(await asistente.conversar('chat', '¿cuánto cuesta netflix?', contexto), { texto: 'Netflix perfil cuesta $80.', opcion: 1 });
  const segundo = fetch.pedidos[1];
  assert.equal(segundo.url, 'https://ia.x.com/api/chat');
  assert.equal(segundo.cuerpo.model, 'novatech');
  assert.deepEqual(segundo.cuerpo.messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user']);
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
  assert.deepEqual(await asistente.conversar('chat', 'hola', contexto), { texto: 'Hola', opcion: null });
});

test('a las direcciones sin esquema se les pone http:// o https://', async () => {
  const { conEsquema } = await import('../src/config.js');
  assert.equal(conEsquema('ia.ventasthalia.com', 'https'), 'https://ia.ventasthalia.com');
  assert.equal(conEsquema('http://10.0.0.5:11434', 'https'), 'http://10.0.0.5:11434');
  assert.equal(conEsquema(' 45.1.2.3:8081 ', 'http'), 'http://45.1.2.3:8081');
  assert.equal(conEsquema('', 'http'), '');
});
