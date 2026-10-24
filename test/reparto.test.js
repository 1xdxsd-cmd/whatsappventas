import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearRepartoDePagos } from '../src/admin/reparto.js';

test('reparte a los clientes por turnos y cada uno conserva su cuenta', () => {
  const ana = { numeroAdmin: '521', datos: 'BBVA Ana' };
  const beto = { numeroAdmin: '522', datos: 'Banorte Beto' };
  const reparto = crearRepartoDePagos([ana, beto]);
  assert.equal(reparto.cuentaPara('cliente-1'), ana);
  assert.equal(reparto.cuentaPara('cliente-2'), beto);
  assert.equal(reparto.cuentaPara('cliente-3'), ana);
  assert.equal(reparto.cuentaPara('cliente-2'), beto);
});

test('sin cuentas por admin no asigna ninguna', () => {
  assert.equal(crearRepartoDePagos([]).cuentaPara('cliente-1'), null);
});
