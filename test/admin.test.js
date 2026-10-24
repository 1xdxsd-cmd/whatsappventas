import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearAtencionAdmin } from '../src/admin/atencion.js';
import { crearRegistroDeCasos, interpretarComando, textoCasos } from '../src/admin/comandos.js';

test('interpreta los comandos de admin', () => {
  assert.deepEqual(interpretarComando('#12 Correo: a@b.com'), { comando: 'enviar', caso: 12, resto: 'Correo: a@b.com' });
  assert.deepEqual(interpretarComando('/aprobar 7'), { comando: 'aprobar', caso: 7, resto: '' });
  assert.deepEqual(interpretarComando('/Rechazar #7 monto incompleto'), { comando: 'rechazar', caso: 7, resto: 'monto incompleto' });
  assert.deepEqual(interpretarComando('/fin'), { comando: 'fin', caso: null, resto: '' });
  assert.deepEqual(interpretarComando('hola, ¿cómo estás?'), { comando: null, caso: null, resto: 'hola, ¿cómo estás?' });
});

const ADMIN = '525500000000@s.whatsapp.net';
const CLIENTE = '5215512345678@s.whatsapp.net';
const texto = (t) => ({ key: { remoteJid: ADMIN }, message: { conversation: t } });

function preparar({ cuentas = [], fallar = {} } = {}) {
  const enviados = [];
  const reenviados = [];
  const llamadas = [];
  const estadosGuardados = new Map();
  const conexion = {
    enviarTexto: async (jid, t) => enviados.push([jid, t]),
    reenviar: async (jid, m) => reenviados.push([jid, m]),
  };
  const pagina = {
    completarPedido: async (...a) => llamadas.push(['completarPedido', ...a]),
    actualizarPedido: async (...a) => llamadas.push(['actualizarPedido', ...a]),
    actualizarCaida: async (...a) => llamadas.push(['actualizarCaida', ...a]),
    ajustarSaldo: async (...a) => {
      llamadas.push(['ajustarSaldo', ...a]);
      if (fallar.saldo) throw new Error('400');
      return { balance: 250 };
    },
    olvidarCache: () => {},
  };
  const cobros = {
    entregarPagado: async (pedido) => {
      llamadas.push(['entregarPagado', pedido]);
      if (fallar.entregar) throw new Error('página caída');
      if (pedido.renta) return { cuenta: null, fechaFin: '2026-11-26', renovacion: true };
      return { cuenta: cuentas[0] ?? null, fechaFin: '2026-11-23', renovacion: false };
    },
  };
  const casos = crearRegistroDeCasos();
  const admin = crearAtencionAdmin({
    conexion,
    pagina,
    cobros,
    casos,
    estados: { obtener: (jid) => estadosGuardados.get(jid), guardar: (jid, e) => estadosGuardados.set(jid, e) },
    logger: { error() {} },
  });
  const alCliente = () => enviados.filter(([jid]) => jid === CLIENTE).map(([, t]) => t);
  const alAdmin = () => enviados.filter(([jid]) => jid === ADMIN).map(([, t]) => t);
  return { admin, casos, llamadas, estadosGuardados, alCliente, alAdmin, reenviados };
}

const servicio = { platform: 'netflix', type: 'perfil', price: 80, duration: 30 };
const pedido = { jid: CLIENTE, telefono: '5215512345678', nombre: 'Laura', cliente: { id: 'client-1', nombre: 'Laura' }, tipo: 'pedido', servicio, resumen: 'Netflix, perfil', pedidoId: 'ord-1', notas: 'Pedido por WhatsApp' };

test('/aprobar entrega la cuenta al cliente y pasa el pedido a Ventas', async () => {
  const p = preparar({ cuentas: [{ email: 'libre@x.com', password: 'clave' }] });
  const caso = p.casos.abrir(pedido);
  await p.admin.manejar(texto(`/aprobar ${caso.id}`));
  assert.match(p.alCliente()[0], /Pago confirmado[\s\S]*Correo: libre@x\.com\nContraseña: clave\nVence: 2026-11-23/);
  assert.deepEqual(p.llamadas.find(([n]) => n === 'completarPedido'), ['completarPedido', 'ord-1', { price: 80, paymentMethod: 'transferencia' }]);
  assert.equal(p.casos.obtener(caso.id).abierto, false);
  assert.deepEqual(p.estadosGuardados.get(CLIENTE), { paso: 'menu' });
  assert.match(p.alAdmin()[0], /entregado con libre@x\.com/);
});

test('/aprobar de una renovación extiende la renta', async () => {
  const p = preparar();
  const caso = p.casos.abrir({ ...pedido, renta: { id: 'r1', endDate: '2026-10-27' } });
  await p.admin.manejar(texto(`/aprobar ${caso.id}`));
  assert.match(p.alCliente()[0], /nueva fecha de vencimiento: \*2026-11-26\*/);
});

test('/aprobar sin cuenta libre deja el caso como entrega pendiente', async () => {
  const p = preparar();
  const caso = p.casos.abrir(pedido);
  await p.admin.manejar(texto(`/aprobar ${caso.id}`));
  assert.match(p.alCliente()[0], /En breve te enviamos los datos/);
  assert.equal(p.casos.obtener(caso.id).tipo, 'entrega');
  assert.equal(p.casos.obtener(caso.id).abierto, true);
});

test('si la página falla al aprobar, no le dice nada al cliente', async () => {
  const p = preparar({ fallar: { entregar: true } });
  const caso = p.casos.abrir(pedido);
  await p.admin.manejar(texto(`/aprobar ${caso.id}`));
  assert.deepEqual(p.alCliente(), []);
  assert.match(p.alAdmin()[0], /No pude crear la renta/);
  assert.equal(p.casos.obtener(caso.id).abierto, true);
});

test('/rechazar avisa al cliente y le deja reenviar el comprobante', async () => {
  const p = preparar();
  const caso = p.casos.abrir(pedido);
  await p.admin.manejar(texto(`/rechazar ${caso.id} el monto no coincide`));
  assert.match(p.alCliente()[0], /No pudimos confirmar tu pago: el monto no coincide/);
  assert.equal(p.estadosGuardados.get(CLIENTE).paso, 'pago');
});

test('#N texto envía al cliente, y /resuelto cierra el reporte en la página', async () => {
  const p = preparar();
  const caso = p.casos.abrir({ jid: CLIENTE, nombre: 'Laura', tipo: 'reporte', plataforma: 'netflix', caidaId: 'fall-1' });
  await p.admin.manejar(texto(`#${caso.id} Ya lo estamos revisando`));
  await p.admin.manejar(texto(`/resuelto ${caso.id} Nueva contraseña: abc123`));
  assert.deepEqual(p.alCliente(), ['Ya lo estamos revisando', '✅ Tu reporte de Netflix quedó resuelto.\n\nNueva contraseña: abc123']);
  assert.deepEqual(p.llamadas.at(-1), ['actualizarCaida', 'fall-1', { status: 'resuelto', resolution: 'Nueva contraseña: abc123' }]);
  assert.equal(p.casos.obtener(caso.id).abierto, false);
});

test('chat con asesor: lo que escribe el admin le llega al cliente', async () => {
  const p = preparar();
  const caso = p.casos.abrir({ jid: CLIENTE, nombre: 'Laura', tipo: 'asesor' });
  assert.equal(p.admin.abrirChat(caso), true);
  await p.admin.manejar(texto('Hola Laura, ¿en qué te ayudo?'));
  await p.admin.manejar({ key: { remoteJid: ADMIN }, message: { imageMessage: { caption: '' } } });
  assert.deepEqual(p.alCliente(), ['Hola Laura, ¿en qué te ayudo?']);
  assert.equal(p.reenviados.length, 1);

  await p.admin.manejar(texto('/fin'));
  assert.match(p.alCliente().at(-1), /El asesor terminó la conversación/);
  assert.deepEqual(p.estadosGuardados.get(CLIENTE), { paso: 'menu' });
  assert.equal(p.admin.chatActivo, null);
});

test('un segundo chat no le quita el activo al primero', async () => {
  const p = preparar();
  const uno = p.casos.abrir({ jid: CLIENTE, nombre: 'Laura', tipo: 'asesor' });
  const dos = p.casos.abrir({ jid: 'otro@s.whatsapp.net', nombre: 'Pedro', tipo: 'asesor' });
  assert.equal(p.admin.abrirChat(uno), true);
  assert.equal(p.admin.abrirChat(dos), false);
  await p.admin.manejar(texto(`/chat ${dos.id}`));
  assert.equal(p.admin.chatActivo, dos.id);
});

test('sin chat activo o con un caso que no existe, responde con ayuda', async () => {
  const p = preparar();
  await p.admin.manejar(texto('hola'));
  await p.admin.manejar(texto('/aprobar 99'));
  await p.admin.manejar(texto('/inventado 1'));
  assert.match(p.alAdmin()[0], /No hay un chat activo/);
  assert.match(p.alAdmin()[1], /No encuentro el caso #99/);
  assert.match(p.alAdmin()[2], /No conozco \/inventado/);
});

test('lista los casos abiertos', () => {
  const casos = crearRegistroDeCasos();
  casos.abrir({ nombre: 'Laura', tipo: 'pedido', resumen: 'Netflix, perfil' });
  assert.equal(textoCasos(casos.abiertos()), '*Casos abiertos*\n\n#1 Laura: pedido (Netflix, perfil)');
});

const recarga = { jid: CLIENTE, telefono: '5215512345678', nombre: 'Laura', cliente: { id: 'client-1', nombre: 'Laura' }, tipo: 'recarga', monto: 200, resumen: 'Recarga de crédito de $200' };

test('/aprobar de una recarga suma el crédito y le avisa al cliente', async () => {
  const p = preparar();
  const caso = p.casos.abrir(recarga);
  await p.admin.manejar(texto(`/aprobar ${caso.id}`));
  const [, id, monto] = p.llamadas.find(([n]) => n === 'ajustarSaldo');
  assert.deepEqual([id, monto], ['client-1', 200]);
  assert.match(p.alCliente()[0], /Recargamos \$200 a tu crédito; ahora tienes \*\$250\*/);
  assert.equal(p.casos.obtener(caso.id).abierto, false);
  assert.match(p.alAdmin()[0], /recargado/);
});

test('si la página no suma la recarga, no le dice nada al cliente', async () => {
  const p = preparar({ fallar: { saldo: true } });
  const caso = p.casos.abrir(recarga);
  await p.admin.manejar(texto(`/aprobar ${caso.id}`));
  assert.deepEqual(p.alCliente(), []);
  assert.match(p.alAdmin()[0], /No pude sumar el crédito/);
  assert.equal(p.casos.obtener(caso.id).abierto, true);
});

test('/rechazar de una recarga deja al cliente mandar otro comprobante', async () => {
  const p = preparar();
  const caso = p.casos.abrir(recarga);
  await p.admin.manejar(texto(`/rechazar ${caso.id} monto incompleto`));
  assert.equal(p.estadosGuardados.get(CLIENTE).recarga, true);
  assert.equal(p.estadosGuardados.get(CLIENTE).paso, 'pago');
});
