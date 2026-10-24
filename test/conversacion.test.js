import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_INICIAL, procesarMensaje } from '../src/bot/conversacion.js';

const opciones = { moneda: '$', datosTransferencia: 'Banco X\nCuenta 123' };

// Envía varios mensajes seguidos y devuelve el último resultado.
function conversar(...mensajes) {
  let estado = ESTADO_INICIAL;
  let resultado;
  for (const mensaje of mensajes) {
    resultado = procesarMensaje(typeof mensaje === 'string' ? { texto: mensaje } : mensaje, estado, opciones);
    estado = resultado.estado;
  }
  return resultado;
}

test('el primer mensaje recibe la bienvenida y el menú', () => {
  const resultado = conversar('buenas tardes');
  assert.equal(resultado.estado.paso, 'menu');
  assert.match(resultado.respuestas[0], /Bienvenido/);
  assert.match(resultado.respuestas[0], /Ver planes y precios/);
});

test('el catálogo muestra los precios reales', () => {
  const [catalogo] = conversar('hola', '1').respuestas;
  assert.match(catalogo, /Netflix: perfil \$80, cuenta completa \$200/);
  assert.match(catalogo, /Disney\+: perfil \$60, cuenta completa \$140/);
  assert.match(catalogo, /HBO Max: perfil \$50, cuenta completa \$140/);
});

test('elegir servicio y tipo crea el pedido y avisa a Anthony', () => {
  const resultado = conversar('hola', '1', '1', '2');
  assert.deepEqual(resultado.estado, { paso: 'pago', servicio: 'netflix', tipo: 'completa' });
  assert.match(resultado.respuestas[0], /Netflix, cuenta completa, \$200 al mes/);
  assert.match(resultado.respuestas[1], /Banco X\nCuenta 123/);
  assert.match(resultado.aviso.texto, /Nuevo pedido: Netflix, cuenta completa, \$200/);
});

test('sin comprobante, el bot lo vuelve a pedir', () => {
  const resultado = conversar('hola', '1', '2', '1', 'ya pagué');
  assert.equal(resultado.estado.paso, 'pago');
  assert.match(resultado.respuestas[0], /foto del comprobante/);
  assert.equal(resultado.aviso, undefined);
});

test('el comprobante se reenvía a Anthony y deja el pedido en revisión', () => {
  const resultado = conversar('hola', '1', '3', '1', { texto: '', tieneComprobante: true });
  assert.equal(resultado.estado.paso, 'revision');
  assert.equal(resultado.aviso.reenviar, true);
  assert.match(resultado.aviso.texto, /HBO Max, perfil, \$50/);
});

test('una opción inválida repite la pregunta sin perder el paso', () => {
  const resultado = conversar('hola', '1', '9');
  assert.equal(resultado.estado.paso, 'catalogo');
  assert.match(resultado.respuestas[0], /No entendí/);
});

test('0 vuelve atrás', () => {
  assert.equal(conversar('hola', '1', '1', '0').estado.paso, 'catalogo');
  assert.equal(conversar('hola', '1', '0').estado.paso, 'menu');
});

test('con un asesor el bot calla hasta que el cliente escribe menu', () => {
  const asesor = conversar('hola', '3');
  assert.equal(asesor.estado.paso, 'asesor');
  assert.ok(asesor.aviso);

  assert.deepEqual(conversar('hola', '3', 'hola, tengo una duda').respuestas, []);
  assert.equal(conversar('hola', '3', 'Menú').estado.paso, 'menu');
});

test('"menu" cancela un pedido a medias', () => {
  assert.equal(conversar('hola', '1', '1', '1', 'menu').estado.paso, 'menu');
});
