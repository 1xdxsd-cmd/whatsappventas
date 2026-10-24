import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diasParaVencer, enHorarioDeAvisos, recordatoriosPendientes } from '../src/recordatorios/calculo.js';

// 24 de octubre de 2026, 11:00 am en México.
const ahora = new Date('2026-10-24T11:00:00-06:00');

const clientes = [
  { id: 'c1', name: 'Laura', phone: '5512345678' },
  { id: 'c2', name: 'Pedro', phone: null },
  { id: 'c3', name: 'Ana', phone: '5598765432' },
];
const rentas = [
  { id: 'r1', clientId: 'c1', platform: 'netflix', type: 'perfil', email: 'n1@ales98.com', endDate: '2026-10-27' },
  { id: 'r2', clientId: 'c1', platform: 'disney', type: 'cuenta', email: 'd1@ales98.com', endDate: '2026-10-24' },
  { id: 'r3', clientId: 'c1', platform: 'hbo', type: 'perfil', endDate: '2026-11-20' },
  { id: 'r4', clientId: 'c2', platform: 'netflix', type: 'perfil', endDate: '2026-10-25' },
  { id: 'r5', clientId: 'c3', platform: 'netflix', type: 'cuenta', endDate: '2026-10-20' },
];

test('cuenta los días con la fecha de México', () => {
  assert.equal(diasParaVencer('2026-10-27', ahora), 3);
  assert.equal(diasParaVencer('2026-10-24', ahora), 0);
  // 11 pm del 24 en México ya es 25 en UTC, pero sigue siendo el 24 allá.
  assert.equal(diasParaVencer('2026-10-25', new Date('2026-10-24T23:00:00-06:00')), 1);
});

test('solo avisa entre 10 am y 8 pm de México', () => {
  assert.equal(enHorarioDeAvisos(ahora), true);
  assert.equal(enHorarioDeAvisos(new Date('2026-10-24T09:59:00-06:00')), false);
  assert.equal(enHorarioDeAvisos(new Date('2026-10-24T20:00:00-06:00')), false);
});

test('junta en un mensaje las rentas que vencen pronto de cada cliente', () => {
  const pendientes = recordatoriosPendientes({ clientes, rentas, enviados: new Set(), ahora });
  // Pedro no tiene teléfono y la renta de Ana ya venció.
  assert.equal(pendientes.length, 1);
  const [laura] = pendientes;
  assert.equal(laura.telefono, '5512345678');
  assert.deepEqual(laura.claves, ['r1:2026-10-27:3', 'r2:2026-10-24:0']);
  assert.match(laura.texto, /Hola Laura/);
  assert.match(laura.texto, /Netflix \(perfil, n1@ales98\.com\) vence en 3 días \(27 de octubre\)/);
  assert.match(laura.texto, /Disney\+ \(cuenta completa, d1@ales98\.com\) vence \*hoy\* a las 8 pm/);
  assert.match(laura.texto, /responde \*renovar\*/);
  assert.doesNotMatch(laura.texto, /HBO/);
});

test('no repite un aviso ya enviado', () => {
  const enviados = new Set(['r1:2026-10-27:3', 'r2:2026-10-24:0']);
  assert.deepEqual(recordatoriosPendientes({ clientes, rentas, enviados, ahora }), []);
});

test('si se pasó un aviso, manda el siguiente que toca', () => {
  // El bot estuvo apagado: la renta vence mañana y nunca se mandó el aviso de 3 días.
  const manana = [{ id: 'r9', clientId: 'c1', platform: 'netflix', type: 'perfil', endDate: '2026-10-25' }];
  const [aviso] = recordatoriosPendientes({ clientes, rentas: manana, enviados: new Set(), ahora });
  assert.deepEqual(aviso.claves, ['r9:2026-10-25:1']);
  assert.match(aviso.texto, /vence \*mañana\* \(25 de octubre\)/);
});

test('al renovar, la nueva fecha vuelve a generar avisos', () => {
  const enviados = new Set(['r1:2026-10-27:3']);
  const renovada = [{ ...rentas[0], endDate: '2026-11-26' }];
  assert.deepEqual(recordatoriosPendientes({ clientes, rentas: renovada, enviados, ahora }), []);
  const despues = new Date('2026-11-23T12:00:00-06:00');
  assert.deepEqual(recordatoriosPendientes({ clientes, rentas: renovada, enviados, ahora: despues })[0].claves, ['r1:2026-11-26:3']);
});
