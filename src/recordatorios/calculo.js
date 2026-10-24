import { nombrePlataforma, nombreTipo } from '../catalogo/servicios.js';
import { rentaActiva } from '../pagina/datos.js';

// Cálculo puro de los recordatorios de vencimiento.
// Desde 3 días antes del vencimiento, se avisa una vez al día a partir de las
// 12 pm (hora de la Ciudad de México). Si a esa hora el bot estaba apagado,
// el aviso del día sale en cuanto vuelve, hasta las 8 pm.

export const DIAS_DE_AVISO = 3;
const HORA_INICIO = 12;
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

// Rentas activas que vencen en DIAS_DE_AVISO días o menos.
export function rentasPorVencer(rentas, ahora = new Date()) {
  return rentas.filter((r) => rentaActiva(r.endDate, ahora) && diasParaVencer(r.endDate, ahora) <= DIAS_DE_AVISO);
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fechaLegible(fechaFin) {
  const [, mes, dia] = String(fechaFin).slice(0, 10).split('-').map(Number);
  return `${dia} de ${MESES.at(mes - 1)}`;
}

export function cuandoVence(dias, fechaFin) {
  if (dias <= 0) return 'vence *hoy* a las 8 pm';
  if (dias === 1) return `vence *mañana* (${fechaLegible(fechaFin)})`;
  return `vence en ${dias} días (${fechaLegible(fechaFin)})`;
}

export function lineaDeVencimiento(renta, ahora = new Date()) {
  const correo = renta.email ? `, ${renta.email}` : '';
  return `• ${nombrePlataforma(renta.platform)} (${nombreTipo(renta.type).toLowerCase()}${correo}) ${cuandoVence(diasParaVencer(renta.endDate, ahora), renta.endDate)}`;
}

/**
 * Devuelve un mensaje por cliente con todas sus rentas que vencen pronto y
 * que hoy todavía no recibieron aviso.
 * @param {{ clientes: object[], rentas: object[], enviados: Set<string>, ahora?: Date, negocio?: string }} datos
 * @returns {{ telefono: string, nombre: string, texto: string, claves: string[] }[]}
 */
export function recordatoriosPendientes({ clientes, rentas, enviados, ahora = new Date(), negocio = '' }) {
  const { fecha } = fechaHoraMexico(ahora);
  const resultado = [];
  for (const cliente of clientes) {
    if (!cliente.phone) continue;
    const avisos = rentasPorVencer(rentas.filter((r) => r.clientId === cliente.id), ahora)
      // Una clave por renta, fecha de vencimiento y día: un aviso al día, y si
      // renueva, la nueva fecha empieza de cero.
      .map((renta) => ({ renta, clave: `${renta.id}:${String(renta.endDate).slice(0, 10)}:${fecha}` }))
      .filter((a) => !enviados.has(a.clave));
    if (avisos.length === 0) continue;

    resultado.push({
      telefono: cliente.phone,
      nombre: cliente.name,
      claves: avisos.map((a) => a.clave),
      texto: [
        `Hola ${cliente.name} 👋${negocio ? `, te escribimos de *${negocio}*` : ''}. Te recordamos que:`,
        '',
        ...avisos.map(({ renta }) => lineaDeVencimiento(renta, ahora)),
        '',
        'Para renovar, responde *renovar*.',
      ].join('\n'),
    });
  }
  return resultado;
}

/**
 * Resumen del día para los admins: todas las rentas activas que vencen en
 * DIAS_DE_AVISO días o menos, de la más próxima a la más lejana, con el cliente
 * y su teléfono. Sale una vez al día (clave `admins:<fecha>`).
 * @returns {{ clave: string, texto: string } | null} null si ya salió hoy o no vence nada.
 */
export function resumenParaAdmins({ clientes, rentas, enviados, ahora = new Date() }) {
  const { fecha } = fechaHoraMexico(ahora);
  const clave = `admins:${fecha}`;
  if (enviados.has(clave)) return null;
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const porVencer = rentasPorVencer(rentas, ahora).sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)));
  if (porVencer.length === 0) return { clave, texto: null };
  const lineas = porVencer.map((renta) => {
    const cliente = porId.get(renta.clientId);
    const quien = cliente ? `${cliente.name}${cliente.phone ? ` (${cliente.phone})` : ' (sin teléfono)'}` : renta.clientName || 'Cliente sin ficha';
    return `${lineaDeVencimiento(renta, ahora)}: ${quien}`;
  });
  return {
    clave,
    texto: [`📅 *Cuentas por vencer* (${porVencer.length})`, '', ...lineas].join('\n'),
  };
}
