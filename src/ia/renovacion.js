import { formatearPrecio } from '../catalogo/servicios.js';
import { ejecutarAccion } from './acciones.js';
import { nombreDe, rentasNombradas, textoElegirCuenta } from './conocimiento.js';

// Renovar es lo que más se pide y lo que el modelo local más confunde (lo
// hacía compra nueva o pedía números): el bot lo lleva paso a paso con los
// datos reales. Funciones puras.

const limpio = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const quiereRenovar = (texto) => /renov/.test(limpio(texto)) && !/como (se )?renuev|cuando (se )?renuev/.test(limpio(texto));

function leerPago(texto, cobradores) {
  const t = limpio(texto);
  const cobrador = cobradores.find((c) => new RegExp(`\\b${limpio(c.nombre).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t))?.nombre;
  if (/credito|saldo/.test(t)) return { pago: 'credito' };
  if (cobrador) return { pago: 'transferencia', cobrador };
  if (/transf|deposit/.test(t)) return { pago: 'transferencia' };
  return {};
}

/**
 * Avanza una renovación con lo que escribió el cliente.
 * @param {{ n?: number, indices?: number[], pago?: string, cobrador?: string }} pendiente
 * @returns {{ hecho: object } | { pregunta: string, pendiente: object } | { nada: true }}
 */
export function avanzarRenovacion(pendiente, texto, contexto, procesar) {
  const { rentas = [], servicios = [], cobradores = [], cliente, moneda = '$' } = contexto;
  const candidatas = pendiente.indices?.length ? pendiente.indices : rentas.map((_, i) => i);
  const actual = { ...pendiente };
  let avanzo = false;

  if (actual.n == null) {
    const nombradas = rentasNombradas(texto, rentas, servicios).filter((i) => candidatas.includes(i));
    if (nombradas.length === 1) [actual.n, avanzo] = [nombradas[0] + 1, true];
    else if (nombradas.length > 1) [actual.indices, avanzo] = [nombradas, true];
    else if (candidatas.length === 1) actual.n = candidatas[0] + 1;
  }
  const leido = leerPago(texto, cobradores);
  if (leido.pago && !(actual.pago === 'transferencia' && leido.pago === 'transferencia' && !leido.cobrador)) {
    Object.assign(actual, leido);
    avanzo = true;
  }
  if (!avanzo && !pendiente.nueva) return { nada: true };
  delete actual.nueva;

  if (actual.n == null) {
    const indices = actual.indices?.length ? actual.indices : candidatas;
    return { pregunta: textoElegirCuenta(rentas, indices, servicios, moneda), pendiente: { ...actual, indices } };
  }
  const renta = rentas[actual.n - 1];
  const precio = Number(renta.price) || servicios.find((s) => s.platform === renta.platform && s.type === renta.type)?.price || 0;
  const nombre = `tu ${nombreDe(renta.platform, servicios)} (${renta.type === 'cuenta' ? 'cuenta completa' : 'perfil'}${renta.email ? `, ${renta.email}` : ''})`;
  const alcanza = cliente && Number(cliente.saldo ?? 0) >= precio && precio > 0;
  if (actual.pago === 'credito' && !alcanza) {
    actual.pago = undefined;
    const nombres = cobradores.map((c) => `*${c.nombre}*`).join(' o ');
    return {
      pregunta: `Tu crédito (${formatearPrecio(cliente?.saldo ?? 0, moneda)}) no alcanza para renovar ${nombre}, que cuesta ${formatearPrecio(precio, moneda)}. 😕 ¿La pagas por transferencia${nombres ? ` a ${nombres}` : ''}?`,
      pendiente: actual,
    };
  }
  if (!actual.pago) {
    const nombres = cobradores.length >= 2 ? ` (a ${cobradores.map((c) => `*${c.nombre}*`).join(' o ')})` : '';
    const credito = alcanza ? `con tu crédito (${formatearPrecio(cliente.saldo, moneda)}) o ` : '';
    return { pregunta: `Renovar ${nombre} cuesta ${formatearPrecio(precio, moneda)}. 💳 ¿La pagas ${credito}por transferencia${nombres}?`, pendiente: actual };
  }
  if (actual.pago === 'transferencia' && cobradores.length >= 2 && !actual.cobrador) {
    return { pregunta: `¿A quién le haces la transferencia: ${cobradores.map((c) => `*${c.nombre}*`).join(' o ')}? 🙌`, pendiente: actual };
  }
  const datos = [String(actual.n), actual.pago, ...(actual.cobrador ? [actual.cobrador] : [])];
  const hecho = ejecutarAccion({ nombre: 'renovar', datos }, contexto, procesar);
  if (hecho.error) return { pregunta: 'Perdón, no pude preparar esa renovación. 😕 ¿Me dices otra vez cuál cuenta y cómo la pagas?', pendiente: {} };
  return { hecho, accion: { nombre: 'renovar', datos } };
}
