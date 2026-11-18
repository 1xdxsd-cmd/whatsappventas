import assert from 'node:assert/strict';
import { test } from 'node:test';
import { procesarMensaje } from '../src/bot/conversacion.js';
import { SERVICIOS_BASE } from '../src/catalogo/servicios.js';
import { avanzarRenovacion, quiereRenovar } from '../src/ia/renovacion.js';

const rentas = [
  { id: 'a', platform: 'netflix', type: 'cuenta', email: 'correo@ventasthalia.com', endDate: '2026-12-23', price: 230 },
  { id: 'c', platform: 'netflix', type: 'perfil', email: 'nebulosa@ventasthalia.com', endDate: '2027-02-12', price: 85 },
];
const contexto = {
  negocio: 'Streaming Thalia', moneda: '$', servicios: SERVICIOS_BASE, rentas, datosPago: 'BBVA',
  cliente: { id: 'c1', nombre: 'Luis', saldo: 415 },
  cobradores: [{ nombre: 'Anthony', datos: 'BBVA A' }, { nombre: 'Thalia', datos: 'NU T' }],
};

test('renovar sin decir cuál muestra sus cuentas para elegir por nombre', () => {
  assert.equal(quiereRenovar('Quiero renovar'), true);
  const r = avanzarRenovacion({ nueva: true }, 'Quiero renovar', contexto, procesarMensaje);
  assert.match(r.pregunta, /¿Cuál quieres renovar\?[\s\S]*1\. Netflix[\s\S]*2\. Netflix/);
  assert.doesNotMatch(r.pregunta, /n[uú]mero/);
});

test('renovar nebulosa con crédito extiende esa misma cuenta, no compra otra', () => {
  const r1 = avanzarRenovacion({ nueva: true }, 'Quiero renovar mi cuenta de nebulosa', contexto, procesarMensaje);
  assert.match(r1.pregunta, /nebulosa@ventasthalia\.com[\s\S]*\$85[\s\S]*crédito \(\$415\)/);
  const r2 = avanzarRenovacion(r1.pendiente, 'Quiero usar mi crédito', contexto, procesarMensaje);
  const cobro = r2.hecho.acciones[0];
  assert.equal(cobro.tipo, 'pagarConCredito');
  assert.equal(cobro.renta.id, 'c');
});

test('renovar por transferencia pregunta a quién y manda sus datos', () => {
  const r1 = avanzarRenovacion({ nueva: true }, 'renuevo nebulosa por transferencia', contexto, procesarMensaje);
  assert.match(r1.pregunta, /Anthony\* o \*Thalia/);
  const r2 = avanzarRenovacion(r1.pendiente, 'a thalia', contexto, procesarMensaje);
  assert.equal(r2.hecho.acciones[0].tipo, 'crearPedido');
  assert.equal(r2.hecho.acciones[0].renta.id, 'c');
  assert.match(r2.hecho.respuestas.join('\n'), /NU T/);
});

test('si escribe otra cosa, la renovación se suelta', () => {
  const r1 = avanzarRenovacion({ nueva: true }, 'Quiero renovar', contexto, procesarMensaje);
  assert.equal(avanzarRenovacion(r1.pendiente, '¿cuánto cuesta disney?', contexto, procesarMensaje).nada, true);
});
