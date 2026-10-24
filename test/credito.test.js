import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearCobrosConCredito, elegirCuenta, fechaMexico, sumarDias } from '../src/pagina/credito.js';

// Página falsa en memoria que se comporta como la real: rechaza saldo negativo con 400.
function paginaFalsa({ saldo = 500, cuentas = [], fallar = {} } = {}) {
  const registro = [];
  const estado = { saldo };
  const fallo = (nombre) => {
    if (fallar[nombre]) {
      const error = new Error(`falla ${nombre}`);
      error.estado = fallar[nombre];
      throw error;
    }
  };
  return {
    estado,
    registro,
    olvidarCache() {},
    async ajustarSaldo(id, monto, nota) {
      registro.push(['saldo', monto, nota]);
      if (monto > 0) fallo('devolver');
      else fallo('descontar');
      if (estado.saldo + monto < 0) {
        const error = new Error('El saldo no puede quedar negativo');
        error.estado = 400;
        throw error;
      }
      estado.saldo += monto;
      return { balance: estado.saldo };
    },
    async cuentas() {
      return cuentas;
    },
    async crearRenta(renta) {
      registro.push(['crearRenta', renta]);
      fallo('crearRenta');
      return { id: 'r-nueva', ...renta };
    },
    async actualizarRenta(id, cambios) {
      registro.push(['actualizarRenta', id, cambios]);
      fallo('actualizarRenta');
      return { id, ...cambios };
    },
    async registrarVenta(venta) {
      registro.push(['venta', venta]);
      fallo('venta');
      return venta;
    },
  };
}

const cliente = { id: 'client-1', nombre: 'Laura' };
const netflixPerfil = { platform: 'netflix', type: 'perfil', price: 80, duration: 30 };
const ahora = () => new Date('2026-10-24T12:00:00-06:00');
const cuentasNetflix = [
  { id: 'acc-llena', platform: 'netflix', saleType: 'perfil', capacity: 4, usedProfiles: 4, email: 'llena@x.com', password: 'a' },
  { id: 'acc-suspendida', platform: 'netflix', saleType: 'perfil', capacity: 4, usedProfiles: 0, suspended: true, email: 's@x.com', password: 'b' },
  { id: 'acc-completa', platform: 'netflix', saleType: 'cuenta', capacity: 1, usedProfiles: 0, email: 'c@x.com', password: 'c' },
  { id: 'acc-libre', platform: 'netflix', saleType: 'perfil', capacity: 4, usedProfiles: 2, email: 'libre@x.com', password: 'd' },
];

test('fechas en hora de México', () => {
  assert.equal(fechaMexico(new Date('2026-10-24T23:30:00-06:00')), '2026-10-24');
  assert.equal(sumarDias('2026-10-24', 30), '2026-11-23');
});

test('elige una cuenta del mismo tipo, no suspendida y con cupo', () => {
  assert.equal(elegirCuenta(cuentasNetflix, netflixPerfil).id, 'acc-libre');
  assert.equal(elegirCuenta(cuentasNetflix, { platform: 'netflix', type: 'cuenta' }).id, 'acc-completa');
  assert.equal(elegirCuenta(cuentasNetflix, { platform: 'disney', type: 'perfil' }), null);
});

test('compra con crédito: descuenta, crea la renta con cuenta y registra la venta', async () => {
  const pagina = paginaFalsa({ cuentas: cuentasNetflix });
  const resultado = await crearCobrosConCredito({ pagina, ahora }).pagar({ cliente, servicio: netflixPerfil, resumen: 'Netflix perfil' });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.saldo, 420);
  assert.equal(resultado.cuenta.id, 'acc-libre');
  assert.equal(resultado.fechaFin, '2026-11-23');
  const renta = pagina.registro.find(([tipo]) => tipo === 'crearRenta')[1];
  assert.deepEqual(
    { accountId: renta.accountId, email: renta.email, startDate: renta.startDate, endDate: renta.endDate, price: renta.price },
    { accountId: 'acc-libre', email: 'libre@x.com', startDate: '2026-10-24', endDate: '2026-11-23', price: 80 },
  );
  assert.equal(pagina.registro.at(-1)[1].paymentMethod, 'saldo');
});

test('sin cuenta disponible, cobra y deja la renta como entrega pendiente', async () => {
  const pagina = paginaFalsa({ cuentas: [] });
  const resultado = await crearCobrosConCredito({ pagina, ahora }).pagar({ cliente, servicio: netflixPerfil, resumen: 'x' });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.cuenta, null);
  assert.deepEqual(pagina.registro.find(([tipo]) => tipo === 'actualizarRenta').slice(1), ['r-nueva', { needsSetup: true, source: 'saldo' }]);
});

test('renovación: extiende desde el vencimiento actual si aún no vence', async () => {
  const pagina = paginaFalsa();
  const renta = { id: 'r1', endDate: '2026-10-27' };
  const resultado = await crearCobrosConCredito({ pagina, ahora }).pagar({ cliente, servicio: netflixPerfil, resumen: 'x', renta });
  assert.equal(resultado.fechaFin, '2026-11-26');
  assert.equal(resultado.renovacion, true);
  assert.deepEqual(pagina.registro[1], ['actualizarRenta', 'r1', { endDate: '2026-11-26', status: 'activa' }]);
});

test('renovación de una renta vencida cuenta desde hoy', async () => {
  const pagina = paginaFalsa();
  const resultado = await crearCobrosConCredito({ pagina, ahora }).pagar({
    cliente, servicio: netflixPerfil, resumen: 'x', renta: { id: 'r1', endDate: '2026-10-01' },
  });
  assert.equal(resultado.fechaFin, '2026-11-23');
});

test('si el crédito no alcanza, no crea nada', async () => {
  const pagina = paginaFalsa({ saldo: 50 });
  const resultado = await crearCobrosConCredito({ pagina, ahora }).pagar({ cliente, servicio: netflixPerfil, resumen: 'x' });
  assert.deepEqual(resultado, { ok: false, motivo: 'saldoInsuficiente' });
  assert.equal(pagina.estado.saldo, 50);
  assert.equal(pagina.registro.some(([tipo]) => tipo === 'crearRenta'), false);
});

test('si falla la entrega después de cobrar, devuelve el crédito', async () => {
  const pagina = paginaFalsa({ cuentas: cuentasNetflix, fallar: { crearRenta: 500 } });
  const resultado = await crearCobrosConCredito({ pagina, ahora }).pagar({ cliente, servicio: netflixPerfil, resumen: 'x' });
  assert.deepEqual(resultado, { ok: false, motivo: 'reembolsado' });
  assert.equal(pagina.estado.saldo, 500);
});

test('si tampoco se puede devolver, lo dice para que se corrija a mano', async () => {
  const pagina = paginaFalsa({ fallar: { actualizarRenta: 500, devolver: 500 } });
  const resultado = await crearCobrosConCredito({ pagina, ahora }).pagar({
    cliente, servicio: netflixPerfil, resumen: 'x', renta: { id: 'r1', endDate: '2026-10-27' },
  });
  assert.deepEqual(resultado, { ok: false, motivo: 'sinReembolso' });
});

test('si el descuento falla sin respuesta clara, no entrega', async () => {
  const pagina = paginaFalsa({ fallar: { descontar: 502 } });
  const resultado = await crearCobrosConCredito({ pagina, ahora }).pagar({ cliente, servicio: netflixPerfil, resumen: 'x' });
  assert.deepEqual(resultado, { ok: false, motivo: 'descuentoIncierto' });
  assert.equal(pagina.registro.some(([tipo]) => tipo === 'crearRenta'), false);
});

test('si falla registrar la venta, la compra sigue válida', async () => {
  const pagina = paginaFalsa({ cuentas: cuentasNetflix, fallar: { venta: 500 } });
  const resultado = await crearCobrosConCredito({ pagina, ahora }).pagar({ cliente, servicio: netflixPerfil, resumen: 'x' });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.ventaRegistrada, false);
});

test('dos compras al mismo tiempo no gastan más crédito del que hay', async () => {
  const pagina = paginaFalsa({ saldo: 100, cuentas: cuentasNetflix });
  const cobros = crearCobrosConCredito({ pagina, ahora });
  const [a, b] = await Promise.all([
    cobros.pagar({ cliente, servicio: netflixPerfil, resumen: 'x' }),
    cobros.pagar({ cliente, servicio: netflixPerfil, resumen: 'y' }),
  ]);
  assert.deepEqual([a.ok, b.ok], [true, false]);
  assert.equal(b.motivo, 'saldoInsuficiente');
  assert.equal(pagina.estado.saldo, 20);
});
