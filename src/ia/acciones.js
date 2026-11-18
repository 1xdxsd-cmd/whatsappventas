import { agruparPorPlataforma } from '../catalogo/servicios.js';

// Convierte la etiqueta de la IA ([[comprar:netflix:perfil:transferencia]]) en
// lo que el cliente habría escrito en el menú de números, y lo pasa por la
// misma conversación de siempre. Así los cobros, pedidos y reportes siguen
// las mismas reglas, pero el cliente no ve ninguna lista. Funciones puras.

const normalizar = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function indicePlataforma(grupos, clave) {
  const buscada = normalizar(clave);
  const i = grupos.findIndex((g) => normalizar(g.platform) === buscada || normalizar(g.nombre) === buscada);
  if (i >= 0) return i;
  return grupos.findIndex((g) => buscada && (normalizar(g.nombre).startsWith(buscada) || normalizar(g.platform).startsWith(buscada)));
}

const pagoEnNumero = (pago) => (normalizar(pago).startsWith('credit') ? '1' : '2');

/**
 * @returns {{ entradas: string[], pago?: string, cobrador?: string } | { error: string }}
 */
export function pasosDeAccion({ nombre, datos }, contexto) {
  const { servicios = [], rentas = [] } = contexto;
  const cuenta = (n) => {
    const numero = Number.parseInt(n, 10);
    return numero >= 1 && numero <= rentas.length ? String(numero) : null;
  };
  switch (nombre) {
    case 'comprar': {
      const [clave, tipo, pago, cobrador] = datos;
      const grupos = agruparPorPlataforma(servicios);
      const g = indicePlataforma(grupos, clave);
      if (g < 0) return { error: `no encontré la plataforma "${clave ?? ''}"` };
      const buscado = normalizar(tipo).startsWith('cuenta') || normalizar(tipo).startsWith('complet') ? 'cuenta' : 'perfil';
      const o = grupos[g].opciones.findIndex((s) => (s.type === 'cuenta' ? 'cuenta' : 'perfil') === buscado);
      if (o < 0) return { error: `${grupos[g].nombre} no tiene ${buscado}` };
      return { entradas: ['1', String(g + 1), String(o + 1)], pago, cobrador };
    }
    case 'renovar': {
      const [n, pago, cobrador] = datos;
      const numero = cuenta(n);
      if (!numero) return { error: 'no encontré esa cuenta' };
      return { entradas: ['2', numero], pago, cobrador };
    }
    case 'reportar': {
      const [n, ...motivo] = datos;
      const numero = cuenta(n);
      if (!numero) return { error: 'no encontré esa cuenta' };
      return { entradas: ['3', numero, motivo.join(':').trim() || 'No funciona'] };
    }
    case 'recargar': {
      const [monto, cobrador] = datos;
      return { entradas: ['7', String(monto ?? '').replace(/[^\d.]/g, '')], cobrador };
    }
    case 'clave':
      return { entradas: ['6', '1'] };
    case 'asesor':
      return { entradas: ['5'] };
    default:
      return { error: `no conozco la acción ${nombre}` };
  }
}

// Pasos que piden elegir de una lista: si la acción termina en uno, faltó un dato.
const PASOS_DE_LISTA = ['catalogo', 'tipo', 'renovar', 'reporte', 'forma-pago', 'elegir-cobrador', 'cuenta'];

/**
 * Corre la acción en la conversación de números sin mostrar las listas.
 * @param {Function} procesar procesarMensaje
 * @returns {{ respuestas: string[], estado: object, acciones: object[], aviso?: object } | { error: string }}
 */
export function ejecutarAccion(accion, contexto, procesar) {
  const plan = pasosDeAccion(accion, contexto);
  if (plan.error) return plan;
  const { cobradores = [] } = contexto;
  const acciones = [];
  let aviso;
  let estado = { paso: 'menu' };
  let resultado = null;

  const paso = (texto) => {
    resultado = procesar({ texto }, estado, contexto);
    acciones.push(...(resultado.acciones ?? []));
    if (resultado.aviso) aviso = resultado.aviso;
    estado = resultado.estado;
    return !String(resultado.respuestas[0] ?? '').startsWith('No entendí') && !String(resultado.respuestas[0] ?? '').startsWith('Escribe solo el monto');
  };

  for (const texto of plan.entradas) {
    if (!paso(texto)) return { error: 'la página no aceptó un dato' };
    // Algunas acciones terminan antes (sin cuentas, página caída, reporte en curso).
    if (!PASOS_DE_LISTA.includes(estado.paso) && !['reporte-motivo', 'recarga'].includes(estado.paso)) break;
  }
  if (estado.paso === 'forma-pago' && !paso(pagoEnNumero(plan.pago))) return { error: 'no pude elegir la forma de pago' };
  if (estado.paso === 'elegir-cobrador') {
    const i = cobradores.findIndex((c) => normalizar(c.nombre) === normalizar(plan.cobrador));
    if (i < 0) return { error: `falta a quién se le paga (${cobradores.map((c) => c.nombre).join(' o ')})` };
    paso(String(i + 1));
  }
  if (PASOS_DE_LISTA.includes(estado.paso)) return { error: 'faltó un dato para terminar' };
  return { respuestas: resultado.respuestas, estado, acciones, aviso };
}
