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
// La IA a veces cambia el orden o se salta un dato ([[comprar:vix:perfil:Anthony]]):
// la forma de pago y a quién se paga se reconocen por lo que dicen.
function ordenar(datos, cobradores) {
  const esPago = (d) => /^(transf|credit|cr[eé]dit|saldo)/i.test(normalizar(d));
  const esCobrador = (d) => cobradores.some((c) => normalizar(c.nombre) === normalizar(d));
  const pago = datos.find(esPago);
  const cobrador = datos.find(esCobrador);
  const resto = datos.filter((d) => !esPago(d) && !esCobrador(d));
  return { resto, pago: pago ?? 'transferencia', cobrador };
}

export function pasosDeAccion({ nombre, datos: crudos }, contexto) {
  const { servicios = [], rentas = [], cobradores = [] } = contexto;
  const usaPago = ['comprar', 'renovar', 'recargar'].includes(nombre);
  const { resto, pago, cobrador } = usaPago ? ordenar(crudos, cobradores) : { resto: crudos };
  const datos = usaPago ? [...resto, ...(nombre === 'recargar' ? [] : [pago])] : crudos;
  const cuenta = (n) => {
    const numero = Number.parseInt(n, 10);
    return numero >= 1 && numero <= rentas.length ? String(numero) : null;
  };
  switch (nombre) {
    case 'comprar': {
      const [clave, tipo = 'perfil'] = datos;
      const grupos = agruparPorPlataforma(servicios);
      const g = indicePlataforma(grupos, clave);
      if (g < 0) return { error: `no encontré la plataforma "${clave ?? ''}"` };
      const buscado = normalizar(tipo).startsWith('cuenta') || normalizar(tipo).startsWith('complet') ? 'cuenta' : 'perfil';
      const o = grupos[g].opciones.findIndex((s) => (s.type === 'cuenta' ? 'cuenta' : 'perfil') === buscado);
      if (o < 0) return { error: `${grupos[g].nombre} no tiene ${buscado}` };
      return { entradas: ['1', String(g + 1), String(o + 1)], pago, cobrador };
    }
    case 'renovar': {
      const numero = cuenta(datos[0]);
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
      const [monto] = datos;
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
    if (i < 0) return { error: `falta a quién se le paga (${cobradores.map((c) => c.nombre).join(' o ')})`, faltaCobrador: true };
    paso(String(i + 1));
  }
  if (PASOS_DE_LISTA.includes(estado.paso)) return { error: 'faltó un dato para terminar' };
  return { respuestas: resultado.respuestas, estado, acciones, aviso };
}

/**
 * El modelo a veces cambia de servicio en la etiqueta (el cliente habla de ViX y
 * pone spotify). Si la plataforma de la etiqueta no aparece en lo que dijo el
 * cliente y él nombró exactamente otra, se usa la que nombró.
 * @param {string[]} dijo últimos mensajes del cliente
 */
export function plataformaQueDijo(accion, servicios, dijo) {
  if (accion?.nombre !== 'comprar' || !accion.datos.length) return accion;
  const grupos = agruparPorPlataforma(servicios);
  const texto = normalizar(dijo.join(' '));
  const nombrada = (g) => [g.platform, g.nombre].some((n) => normalizar(n).length >= 3 && texto.includes(normalizar(n)));
  const pedida = grupos[indicePlataforma(grupos, accion.datos[0])];
  if (pedida && nombrada(pedida)) return accion;
  const nombradas = grupos.filter(nombrada);
  if (nombradas.length !== 1) return accion;
  return { ...accion, datos: [nombradas[0].platform, ...accion.datos.slice(1)] };
}
