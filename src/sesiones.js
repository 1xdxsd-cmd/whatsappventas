import { ESTADO_INICIAL } from './bot/conversacion.js';

// Estado de cada conversación en memoria. Se pierde al reiniciar el servidor;
// en la fase 3 pasa a la base de datos junto con los pedidos.
const estados = new Map();

export function obtenerEstado(jid) {
  return estados.get(jid) ?? ESTADO_INICIAL;
}

export function guardarEstado(jid, estado) {
  estados.set(jid, estado);
}
