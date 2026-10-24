import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diasParaVencer, enHorarioDeAvisos, recordatoriosPendientes } from '../src/recordatorios/calculo.js';

// 24 de octubre de 2026, 12:05 pm en la Ciudad de México.
const ahora = new Date('2026-10-24T12:05:00-06:00');

const clientes = [
  { id: 'c1', name: 'Laura', phone: '5512345678' },
  { id: 'c2', name: 'Pedro', phone: null },
  { id: 'c3', name: 'Ana', phone: '5598765432' },
];
const rentas = [
  { id: 'r1', clientId: 'c1', platform: 'netflix', type: 'perfil', email: 'n1@ales98.com', endDate: '2026-10-27' },
  { id: 'r2', clientId: 'c1', platform: 'disney', type: 'cuenta', email: 'd1@ales98.com', endDate: '2026-10-24' },
  { id: 'r3', clientId: 'c1', platform: 'hbo', type: 'perfil', endDate: '2026-10-28' },
  { id: 'r4', clientId: 'c2', platform: 'netflix', type: 'perfil', endDate: '2026-10-25' },
  { id: 'r5', clientId: 'c3', platform: 'netflix', type: 'cuenta', endDate: '2026-10-20' },
];

test('cuenta los días con la fecha de la Ciudad de México', () => {
  assert.equal(diasParaVencer('2026-10-27', ahora), 3);
  assert.equal(diasParaVencer('2026-10-24', ahora), 0);
  // 11 pm del 24 en México ya es 25 en UTC, pero sigue siendo el 24 allá.
  assert.equal(diasParaVencer('2026-10-25', new Date('2026-10-24T23:00:00-06:00')), 1);
});

test('los avisos salen a partir de las 12 pm y hasta las 8 pm', () => {
  assert.equal(enHorarioDeAvisos(ahora), true);
  assert.equal(enHorarioDeAvisos(new Date('2026-10-24T11:59:00-06:00')), false);
  assert.equal(enHorarioDeAvisos(new Date('2026-10-24T20:00:00-06:00')), false);
});

test('junta en un mensaje las rentas que vencen en 3 días o menos', () => {
  const pendientes = recordatoriosPendientes({ clientes, rentas, enviados: new Set(), ahora, negocio: 'Streaming Thalia' });
  // Pedro no tiene teléfono y la renta de Ana ya venció.
  assert.equal(pendientes.length, 1);
  const [laura] = pendientes;
  assert.deepEqual(laura.claves, ['r1:2026-10-27:2026-10-24', 'r2:2026-10-24:2026-10-24']);
  assert.match(laura.texto, /Hola Laura 👋, te escribimos de \*Streaming Thalia\*/);
  assert.match(laura.texto, /Netflix \(perfil, n1@ales98\.com\) vence en 3 días \(27 de octubre\)/);
  assert.match(laura.texto, /Disney\+ \(cuenta completa, d1@ales98\.com\) vence \*hoy\* a las 8 pm/);
  assert.match(laura.texto, /responde \*renovar\*/);
  // Vence en 4 días: todavía no.
  assert.doesNotMatch(laura.texto, /HBO/);
});

test('un aviso por día: hoy no se repite, mañana sí', () => {
  const enviados = new Set(['r1:2026-10-27:2026-10-24', 'r2:2026-10-24:2026-10-24']);
  assert.deepEqual(recordatoriosPendientes({ clientes, rentas, enviados, ahora }), []);
  const manana = new Date('2026-10-25T12:05:00-06:00');
  const [laura] = recordatoriosPendientes({ clientes, rentas, enviados, ahora: manana });
  assert.deepEqual(laura.claves, ['r1:2026-10-27:2026-10-25', 'r3:2026-10-28:2026-10-25']);
  assert.match(laura.texto, /Netflix .* vence en 2 días/);
});

test('al renovar, deja de avisar hasta que la nueva fecha esté cerca', () => {
  const renovada = [{ ...rentas[0], endDate: '2026-11-26' }];
  assert.deepEqual(recordatoriosPendientes({ clientes, rentas: renovada, enviados: new Set(), ahora }), []);
  const despues = new Date('2026-11-23T12:30:00-06:00');
  assert.deepEqual(recordatoriosPendientes({ clientes, rentas: renovada, enviados: new Set(), ahora: despues })[0].claves, ['r1:2026-11-26:2026-11-23']);
});
