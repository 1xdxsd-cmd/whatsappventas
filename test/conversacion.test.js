import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_INICIAL, procesarMensaje } from '../src/bot/conversacion.js';
import { SERVICIOS_BASE } from '../src/catalogo/servicios.js';

const contextoBase = { moneda: '$', servicios: SERVICIOS_BASE, datosPago: 'Banco X\nCuenta 123' };

// Envía varios mensajes seguidos y devuelve el último resultado.
function conversar(contexto, ...mensajes) {
  let estado = ESTADO_INICIAL;
  let resultado;
  for (const mensaje of mensajes) {
    resultado = procesarMensaje(typeof mensaje === 'string' ? { texto: mensaje } : mensaje, estado, contexto);
    estado = resultado.estado;
  }
  return resultado;
}
const hablar = (...mensajes) => conversar(contextoBase, ...mensajes);

test('el primer mensaje recibe la bienvenida y el menú', () => {
  const resultado = hablar('buenas tardes');
  assert.equal(resultado.estado.paso, 'menu');
  assert.match(resultado.respuestas[0], /Bienvenido/);
  assert.match(resultado.respuestas[0], /Reportar una cuenta que no funciona/);
});

test('saluda por su nombre a un cliente registrado en la página', () => {
  const resultado = conversar({ ...contextoBase, cliente: { nombre: 'Laura' } }, 'hola');
  assert.match(resultado.respuestas[0], /Hola, Laura/);
});

test('el catálogo muestra los precios reales en pesos', () => {
  const [catalogo] = hablar('hola', '1').respuestas;
  assert.match(catalogo, /pesos mexicanos/);
  assert.match(catalogo, /Netflix: perfil \$80, cuenta completa \$200/);
  assert.match(catalogo, /Disney\+: perfil \$60, cuenta completa \$140/);
  assert.match(catalogo, /HBO Max: perfil \$50, cuenta completa \$140/);
});

test('el catálogo sale de los servicios de la página', () => {
  const servicios = [
    { id: 'svc-1', name: 'Netflix', platform: 'netflix', type: 'cuenta', price: 230, duration: 30 },
    { id: 'svc-4', name: 'Spotify', platform: 'spotify', type: 'cuenta', price: 80, duration: 30 },
  ];
  const contexto = { ...contextoBase, servicios };
  assert.match(conversar(contexto, 'hola', '1').respuestas[0], /\*2\.\* Spotify: cuenta completa \$80/);
  const pedido = conversar(contexto, 'hola', '1', '2', '1');
  assert.equal(pedido.acciones[0].servicio.id, 'svc-4');
});

test('elegir servicio y tipo pide crear el pedido y avisa a Anthony', () => {
  const resultado = hablar('hola', '1', '1', '2');
  assert.equal(resultado.estado.paso, 'pago');
  assert.match(resultado.respuestas[0], /Netflix, cuenta completa, \$200 al mes/);
  assert.match(resultado.respuestas[1], /Banco X\nCuenta 123/);
  assert.equal(resultado.acciones[0].tipo, 'crearPedido');
  assert.equal(resultado.acciones[0].servicio.type, 'cuenta');
  assert.match(resultado.aviso.texto, /Nuevo pedido: Netflix, cuenta completa, \$200/);
});

test('sin comprobante, el bot lo vuelve a pedir', () => {
  const resultado = hablar('hola', '1', '2', '1', 'ya pagué');
  assert.equal(resultado.estado.paso, 'pago');
  assert.match(resultado.respuestas[0], /foto del comprobante/);
  assert.equal(resultado.aviso, undefined);
});

test('el comprobante se reenvía a Anthony y marca el pedido', () => {
  const resultado = hablar('hola', '1', '3', '1', { texto: '', tieneComprobante: true });
  assert.equal(resultado.estado.paso, 'revision');
  assert.equal(resultado.aviso.reenviar, true);
  assert.deepEqual(resultado.acciones, [{ tipo: 'comprobanteRecibido' }]);
  assert.match(resultado.aviso.texto, /HBO Max, perfil, \$50/);
});

test('una opción inválida repite la pregunta sin perder el paso', () => {
  const resultado = hablar('hola', '1', '9');
  assert.equal(resultado.estado.paso, 'catalogo');
  assert.match(resultado.respuestas[0], /No entendí/);
});

test('0 vuelve atrás', () => {
  assert.equal(hablar('hola', '1', '1', '0').estado.paso, 'catalogo');
  assert.equal(hablar('hola', '1', '0').estado.paso, 'menu');
});

test('con un asesor el bot calla hasta que el cliente escribe menu', () => {
  const asesor = hablar('hola', '5');
  assert.equal(asesor.estado.paso, 'asesor');
  assert.ok(asesor.aviso);
  assert.deepEqual(hablar('hola', '5', 'hola, tengo una duda').respuestas, []);
  assert.equal(hablar('hola', '5', 'Menú').estado.paso, 'menu');
});

test('"menu" cancela un pedido a medias', () => {
  assert.equal(hablar('hola', '1', '1', '1', 'menu').estado.paso, 'menu');
});

const conRentas = {
  ...contextoBase,
  cliente: { nombre: 'Laura' },
  rentas: [
    { id: 'r1', platform: 'netflix', type: 'perfil', email: 'n1@ales98.com', endDate: '2026-11-20', accountId: 'acc-1', price: 75 },
    { id: 'r2', platform: 'disney', type: 'cuenta', email: 'd1@ales98.com', endDate: '2026-11-05', accountId: 'acc-2' },
  ],
};

test('reportar una cuenta caída: lista sus cuentas activas', () => {
  const [lista] = conversar(conRentas, 'hola', '3').respuestas;
  assert.match(lista, /\*1\.\* Netflix \(perfil, n1@ales98\.com\), vence 2026-11-20/);
  assert.match(lista, /\*2\.\* Disney\+ \(cuenta completa, d1@ales98\.com\), vence 2026-11-05/);
});

test('reportar una cuenta caída: guarda el reporte con el motivo', () => {
  const resultado = conversar(conRentas, 'hola', '3', '2', 'Me pide un código de verificación');
  assert.equal(resultado.estado.paso, 'menu');
  assert.deepEqual(resultado.acciones, [
    { tipo: 'reportarCaida', renta: conRentas.rentas[1], motivo: 'Me pide un código de verificación' },
  ]);
  assert.match(resultado.aviso.texto, /Disney\+ d1@ales98\.com\. Motivo: Me pide un código/);
});

test('reportar sin cuentas activas pasa a un asesor', () => {
  const resultado = hablar('hola', '3');
  assert.equal(resultado.estado.paso, 'asesor');
  assert.match(resultado.aviso.texto, /no está registrado en la página/);
  assert.equal(resultado.acciones, undefined);
});

test('renovar desde el recordatorio usa el precio que paga ese cliente', () => {
  const lista = conversar(conRentas, 'renovar');
  assert.equal(lista.estado.paso, 'renovar');
  assert.match(lista.respuestas[0], /Netflix \(perfil, n1@ales98\.com\), vence 2026-11-20, renovar por \$75/);
  // Sin precio en la renta, usa el del catálogo.
  assert.match(lista.respuestas[0], /Disney\+ \(cuenta completa, d1@ales98\.com\), vence 2026-11-05, renovar por \$140/);

  const pedido = conversar(conRentas, 'renovar', '1');
  assert.equal(pedido.estado.paso, 'pago');
  assert.match(pedido.respuestas[0], /Renovación de Netflix, perfil, \$75 al mes \(n1@ales98\.com\)/);
  assert.equal(pedido.acciones[0].tipo, 'crearPedido');
  assert.equal(pedido.acciones[0].servicio.price, 75);
});

test('renovar también está en el menú, y sin rentas pasa a un asesor', () => {
  assert.equal(conversar(conRentas, 'hola', '2').estado.paso, 'renovar');
  const sinRentas = hablar('hola', '2');
  assert.equal(sinRentas.estado.paso, 'asesor');
  assert.match(sinRentas.aviso.texto, /quiere renovar/);
});

test('"renovar" no interrumpe a un asesor', () => {
  assert.deepEqual(conversar(conRentas, 'hola', '5', 'renovar').respuestas, []);
});
