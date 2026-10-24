import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatearCodigo, leerMensaje, normalizarNumeroBot } from '../src/whatsapp/conexion.js';

test('el código de vinculación se muestra como XXXX-XXXX', () => {
  assert.equal(formatearCodigo('ABCD1234'), 'ABCD-1234');
});

test('el número del bot se normaliza para pedir el código', () => {
  assert.equal(normalizarNumeroBot('+52 55 1234 5678'), '525512345678');
  assert.equal(normalizarNumeroBot('55 1234 5678'), '525512345678');
  assert.equal(normalizarNumeroBot('5215512345678'), '5215512345678');
  assert.equal(normalizarNumeroBot(''), null);
  assert.equal(normalizarNumeroBot('12345'), null);
});

test('lee el texto y detecta comprobantes', () => {
  assert.deepEqual(leerMensaje({ message: { conversation: 'hola' } }), { texto: 'hola', tieneComprobante: false, tieneArchivo: false });
  assert.deepEqual(leerMensaje({ message: { imageMessage: { caption: 'pago' } } }), { texto: 'pago', tieneComprobante: true, tieneArchivo: true });
  assert.equal(leerMensaje({ message: { audioMessage: {} } }).tieneArchivo, true);
});
