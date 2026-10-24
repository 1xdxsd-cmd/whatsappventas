import { mismoTelefono, rentaActiva } from './datos.js';

// Cliente de la API de la página (StreamRent). El bot entra como administrador
// y usa los mismos endpoints que el panel.
export function crearClientePagina({ url, usuario, clave, logger }) {
  let token = null;
  const base = url.replace(/\/+$/, '');

  async function entrar() {
    const respuesta = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usuario, password: clave }),
    });
    if (!respuesta.ok) throw new Error(`La página rechazó el inicio de sesión (${respuesta.status})`);
    token = (await respuesta.json()).token;
  }

  async function pedir(metodo, ruta, cuerpo, reintento = true) {
    if (!token) await entrar();
    const respuesta = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    // La página guarda las sesiones en memoria y expiran en 24 h, o al reiniciarse.
    if (respuesta.status === 401 && reintento) {
      token = null;
      return pedir(metodo, ruta, cuerpo, false);
    }
    if (!respuesta.ok) {
      const detalle = await respuesta.json().catch(() => ({}));
      const error = new Error(`${metodo} ${ruta} respondió ${respuesta.status}${detalle.error ? `: ${detalle.error}` : ''}`);
      error.estado = respuesta.status;
      throw error;
    }
    return respuesta.json();
  }

  // Lecturas que cambian poco: se guardan un minuto para no pedirlas en cada mensaje.
  const cache = new Map();
  async function conCache(clave, ms, obtener) {
    const guardado = cache.get(clave);
    if (guardado && Date.now() - guardado.en < ms) return guardado.valor;
    const valor = await obtener();
    cache.set(clave, { valor, en: Date.now() });
    return valor;
  }

  return {
    async servicios() {
      const lista = await conCache('servicios', 60_000, () => pedir('GET', '/api/admin/services'));
      return lista.filter((s) => s.active !== false);
    },

    metodosPago() {
      return conCache('pagos', 60_000, () => pedir('GET', '/api/admin/payments'));
    },

    clientes() {
      return conCache('clientes', 30_000, () => pedir('GET', '/api/admin/clients'));
    },

    rentas() {
      return conCache('rentas', 30_000, () => pedir('GET', '/api/rentals'));
    },

    async clientePorTelefono(telefono) {
      const clientes = await this.clientes();
      return clientes.find((c) => mismoTelefono(c.phone, telefono)) ?? null;
    },

    async rentasActivas(clienteId) {
      const rentas = await this.rentas();
      return rentas.filter((r) => r.clientId === clienteId && rentaActiva(r.endDate));
    },

    // La página guarda solo el hash; nunca se puede leer la contraseña actual.
    cambiarClave(clienteId, clave) {
      return pedir('PUT', `/api/admin/clients/${encodeURIComponent(clienteId)}`, { password: clave });
    },

    crearPedido(pedido) {
      return pedir('POST', '/api/admin/orders', pedido);
    },

    actualizarPedido(id, cambios) {
      return pedir('PUT', `/api/admin/orders/${encodeURIComponent(id)}`, cambios);
    },

    // Tras mover crédito o rentas, la siguiente lectura debe ver los datos nuevos.
    olvidarCache() {
      cache.clear();
    },

    // La página rechaza con 400 si el saldo quedaría negativo.
    ajustarSaldo(clienteId, monto, nota) {
      return pedir('POST', `/api/admin/clients/${encodeURIComponent(clienteId)}/balance`, { amount: monto, note: nota });
    },

    cuentas() {
      return pedir('GET', '/api/admin/accounts');
    },

    crearRenta(renta) {
      return pedir('POST', '/api/rentals', renta);
    },

    actualizarRenta(id, cambios) {
      return pedir('PUT', `/api/rentals/${encodeURIComponent(id)}`, cambios);
    },

    registrarVenta(venta) {
      return pedir('POST', '/api/admin/sales', venta);
    },

    // Pasa el pedido a Ventas, como el botón "Completar" del panel.
    completarPedido(id, { price, paymentMethod }) {
      return pedir('POST', `/api/admin/orders/${encodeURIComponent(id)}/complete`, { price, paymentMethod });
    },

    actualizarCaida(id, cambios) {
      return pedir('PUT', `/api/admin/fallen/${encodeURIComponent(id)}`, cambios);
    },

    reportarCaida(reporte) {
      logger?.info({ plataforma: reporte.platform }, 'Reportando cuenta caída en la página');
      return pedir('POST', '/api/admin/fallen', reporte);
    },
  };
}
