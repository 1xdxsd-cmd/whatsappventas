import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatearCodigo, leerMensaje, normalizarNumero, normalizarNumeroBot, prepararCodigo } from '../src/whatsapp/conexion.js';

test('el código de vinculación se muestra como XXXX-XXXX', () => {
  assert.equal(formatearCodigo('ABCD1234'), 'ABCD-1234');
});

test('el número del bot se normaliza para pedir el código', () => {
  assert.equal(normalizarNumeroBot('+52 55 1234 5678'), '525512345678');
  assert.equal(normalizarNumeroBot('55 1234 5678'), '525512345678');
  // Para vincular se respeta el "1" si lo escribes: debe coincidir con la cuenta.
  assert.equal(normalizarNumeroBot('5216771319656'), '5216771319656');
  assert.equal(normalizarNumeroBot('526771319656'), '526771319656');
  assert.equal(normalizarNumeroBot(''), null);
  assert.equal(normalizarNumeroBot('12345'), null);
});

test('lee el texto y detecta comprobantes', () => {
  assert.deepEqual(leerMensaje({ message: { conversation: 'hola' } }), { texto: 'hola', tieneComprobante: false, tieneArchivo: false });
  assert.deepEqual(leerMensaje({ message: { imageMessage: { caption: 'pago' } } }), { texto: 'pago', tieneComprobante: true, tieneArchivo: true });
  assert.equal(leerMensaje({ message: { audioMessage: {} } }).tieneArchivo, true);
});

test('para buscar chats, el "1" de celular de México se quita', () => {
  assert.equal(normalizarNumero('5216771319656'), '526771319656');
  assert.equal(normalizarNumero('6771319656'), '526771319656');
});

test('prepararCodigo respeta un código válido y genera uno si no', () => {
  assert.equal(prepararCodigo('stre-am26'), 'STREAM26');
  for (const malo of [undefined, '', 'ABC', 'OOOO0000']) {
    const codigo = prepararCodigo(malo);
    assert.match(codigo, /^[1-9A-HJ-NP-TV-Z]{8}$/);
  }
});
