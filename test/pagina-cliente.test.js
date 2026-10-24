import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { crearClientePagina } from '../src/pagina/cliente.js';

// Servidor falso con las mismas rutas y respuestas que la página (StreamRent).
const recibidos = [];
let tokenValido = 'token-1';
let logins = 0;
const servidor = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (parte) => (cuerpo += parte));
  req.on('end', () => {
    const json = (estado, datos) => {
      res.writeHead(estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(datos));
    };
    if (req.url === '/api/login') {
      const { username, password } = JSON.parse(cuerpo);
      if (username !== 'admin' || password !== 'secreta') return json(401, { error: 'Credenciales inválidas' });
      logins += 1;
      return json(200, { token: tokenValido, role: 'admin' });
    }
    if (req.headers.authorization !== `Bearer ${tokenValido}`) return json(401, { error: 'No autorizado' });
    recibidos.push({ metodo: req.method, ruta: req.url, cuerpo: cuerpo ? JSON.parse(cuerpo) : null });
    if (req.url === '/api/admin/services') {
      return json(200, [
        { id: 'svc-1', name: 'Netflix', platform: 'netflix', type: 'cuenta', price: 230, duration: 30, active: true },
        { id: 'svc-9', name: 'Viejo', platform: 'otro', type: 'cuenta', price: 1, duration: 30, active: false },
      ]);
    }
    if (req.url === '/api/admin/clients') {
      return json(200, [{ id: 'client-1', name: 'Laura', phone: '55 1234 5678' }]);
    }
    if (req.url === '/api/rentals') {
      return json(200, [
        { id: 'r1', clientId: 'client-1', platform: 'netflix', endDate: '2099-01-01' },
        { id: 'r2', clientId: 'client-1', platform: 'disney', endDate: '2000-01-01' },
        { id: 'r3', clientId: 'client-2', platform: 'hbo', endDate: '2099-01-01' },
      ]);
    }
    if (req.method === 'POST' && req.url === '/api/admin/orders') return json(201, { id: 'ord-1', ...JSON.parse(cuerpo) });
    if (req.method === 'PUT' && req.url === '/api/admin/orders/ord-1') return json(200, { id: 'ord-1' });
    if (req.method === 'POST' && req.url === '/api/admin/fallen') return json(201, { id: 'fall-1' });
    return json(404, { error: 'No encontrado' });
  });
});

let pagina;
before(async () => {
  await new Promise((listo) => servidor.listen(0, listo));
  pagina = crearClientePagina({ url: `http://127.0.0.1:${servidor.address().port}/`, usuario: 'admin', clave: 'secreta' });
});
after(() => servidor.close());

test('lee solo los servicios activos', async () => {
  const servicios = await pagina.servicios();
  assert.deepEqual(servicios.map((s) => s.id), ['svc-1']);
});

test('encuentra al cliente por su número de WhatsApp y sus rentas activas', async () => {
  const cliente = await pagina.clientePorTelefono('5215512345678');
  assert.equal(cliente.id, 'client-1');
  assert.equal(await pagina.clientePorTelefono('5219999999999'), null);
  const rentas = await pagina.rentasActivas('client-1');
  assert.deepEqual(rentas.map((r) => r.id), ['r1']);
});

test('crea y actualiza pedidos y reporta caídas', async () => {
  const pedido = await pagina.crearPedido({ clientName: 'Laura', platform: 'netflix', type: 'cuenta', phone: '52155', notes: 'x' });
  assert.equal(pedido.id, 'ord-1');
  await pagina.actualizarPedido('ord-1', { notes: 'y' });
  await pagina.reportarCaida({ accountId: 'acc-1', platform: 'netflix', reason: 'pide código' });
  const escrituras = recibidos.filter((r) => r.metodo !== 'GET').map((r) => `${r.metodo} ${r.ruta}`);
  assert.deepEqual(escrituras, ['POST /api/admin/orders', 'PUT /api/admin/orders/ord-1', 'POST /api/admin/fallen']);
});

test('vuelve a iniciar sesión si la página se reinició', async () => {
  const antes = logins;
  tokenValido = 'token-2';
  await pagina.reportarCaida({ platform: 'netflix', reason: 'otra' });
  assert.equal(logins, antes + 1);
});
