import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mismoTelefono, rentaActiva, textoMetodosPago } from '../src/pagina/datos.js';

test('una renta sigue activa hasta las 8 pm de México del día de vencimiento', () => {
  assert.equal(rentaActiva('2026-11-05', new Date('2026-11-05T19:59:00-06:00')), true);
  assert.equal(rentaActiva('2026-11-05', new Date('2026-11-05T20:00:00-06:00')), false);
  assert.equal(rentaActiva(null), false);
});

test('compara teléfonos por los últimos 10 dígitos', () => {
  assert.equal(mismoTelefono('+52 1 55 1234 5678', '525512345678'), true);
  assert.equal(mismoTelefono('55 1234 5678', '5215512345678'), true);
  assert.equal(mismoTelefono('5512345679', '525512345678'), false);
  assert.equal(mismoTelefono(null, '525512345678'), false);
  assert.equal(mismoTelefono('1234', '1234'), false);
});

test('arma el texto de pago con los métodos activos', () => {
  const texto = textoMetodosPago([
    { type: 'transferencia', bank: 'BBVA', holder: 'Anthony', clabe: '012345', cardNumber: '', active: true },
    { type: 'transferencia', bank: 'Banorte', active: false },
  ]);
  assert.equal(texto, '*Transferencia BBVA*\nTitular: Anthony\nCLABE: 012345');
});
