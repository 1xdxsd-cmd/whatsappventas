import { nombrePlataforma, nombreTipo } from '../catalogo/servicios.js';
import { rentaActiva } from '../pagina/datos.js';

// Cálculo puro de los recordatorios de vencimiento.
// Se avisa 3 días antes, 1 día antes y el mismo día. Si el bot estuvo apagado
// y se pasó un aviso, se manda el siguiente que toque; nunca se repite uno.

const UMBRALES = [3, 1, 0];
const HORA_INICIO = 10;
const HORA_FIN = 20; // las rentas vencen a las 8 pm, después ya no tiene caso avisar

// México centro usa UTC-6 todo el año desde 2022.
function fechaHoraMexico(ahora) {
  const mexico = new Date(ahora.getTime() - 6 * 3600 * 1000);
  return { fecha: mexico.toISOString().slice(0, 10), hora: mexico.getUTCHours() };
}

export function enHorarioDeAvisos(ahora = new Date()) {
  const { hora } = fechaHoraMexico(ahora);
  return hora >= HORA_INICIO && hora < HORA_FIN;
}

export function diasParaVencer(fechaFin, ahora = new Date()) {
  const { fecha } = fechaHoraMexico(ahora);
  return Math.round((Date.parse(String(fechaFin).slice(0, 10)) - Date.parse(fecha)) / 864e5);
}

function umbralPara(dias) {
  return [...UMBRALES].reverse().find((u) => dias <= u);
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fechaLegible(fechaFin) {
  const [, mes, dia] = String(fechaFin).slice(0, 10).split('-').map(Number);
  return `${dia} de ${MESES.at(mes - 1)}`;
}

function cuandoVence(dias, fechaFin) {
  if (dias <= 0) return 'vence *hoy* a las 8 pm';
  if (dias === 1) return `vence *mañana* (${fechaLegible(fechaFin)})`;
  return `vence en ${dias} días (${fechaLegible(fechaFin)})`;
}

/**
 * Devuelve un mensaje por cliente con todas sus rentas que necesitan aviso.
 * @param {{ clientes: object[], rentas: object[], enviados: Set<string>, ahora?: Date }} datos
 * @returns {{ telefono: string, nombre: string, texto: string, claves: string[] }[]}
 */
export function recordatoriosPendientes({ clientes, rentas, enviados, ahora = new Date() }) {
  const resultado = [];
  for (const cliente of clientes) {
    if (!cliente.phone) continue;
    const avisos = rentas
      .filter((r) => r.clientId === cliente.id && rentaActiva(r.endDate, ahora))
      .map((r) => {
        const dias = diasParaVencer(r.endDate, ahora);
        const umbral = umbralPara(dias);
        // La fecha va en la clave: si renueva, la nueva fecha vuelve a generar avisos.
        return { renta: r, dias, clave: `${r.id}:${String(r.endDate).slice(0, 10)}:${umbral}`, umbral };
      })
      .filter((a) => a.umbral !== undefined && !enviados.has(a.clave));
    if (avisos.length === 0) continue;

    const lineas = avisos.map(
      ({ renta, dias }) =>
        `• ${nombrePlataforma(renta.platform)} (${nombreTipo(renta.type).toLowerCase()}${renta.email ? `, ${renta.email}` : ''}) ${cuandoVence(dias, renta.endDate)}`,
    );
    resultado.push({
      telefono: cliente.phone,
      nombre: cliente.name,
      claves: avisos.map((a) => a.clave),
      texto: [
        `Hola ${cliente.name} 👋, te recordamos que:`,
        '',
        ...lineas,
        '',
        'Para renovar, responde *renovar*.',
      ].join('\n'),
    });
  }
  return resultado;
}
