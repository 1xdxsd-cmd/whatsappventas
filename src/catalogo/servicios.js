// Catálogo con la misma forma que los servicios de la página (StreamRent):
// { id, name, platform, type: 'perfil' | 'cuenta', price, duration (días) }.
// Este es el respaldo cuando el bot no está conectado a la página.
// Precios mensuales en pesos mexicanos.
export const SERVICIOS_BASE = [
  { id: 'base-netflix-perfil', name: 'Netflix', platform: 'netflix', type: 'perfil', price: 80, duration: 30 },
  { id: 'base-netflix-cuenta', name: 'Netflix', platform: 'netflix', type: 'cuenta', price: 200, duration: 30 },
  { id: 'base-disney-perfil', name: 'Disney+', platform: 'disney', type: 'perfil', price: 60, duration: 30 },
  { id: 'base-disney-cuenta', name: 'Disney+', platform: 'disney', type: 'cuenta', price: 140, duration: 30 },
  { id: 'base-hbo-perfil', name: 'HBO Max', platform: 'hbo', type: 'perfil', price: 50, duration: 30 },
  { id: 'base-hbo-cuenta', name: 'HBO Max', platform: 'hbo', type: 'cuenta', price: 140, duration: 30 },
];

const NOMBRES_PLATAFORMA = {
  netflix: 'Netflix',
  disney: 'Disney+',
  hbo: 'HBO Max',
  spotify: 'Spotify',
  prime: 'Prime Video',
  youtube: 'YouTube Premium',
  crunchyroll: 'Crunchyroll',
  paramount: 'Paramount+',
};

export function nombrePlataforma(platform, respaldo) {
  return NOMBRES_PLATAFORMA[platform] ?? respaldo ?? platform;
}

export function nombreTipo(type) {
  return type === 'perfil' ? 'Perfil' : 'Cuenta completa';
}

// Agrupa los servicios por plataforma, en el orden en que aparecen.
export function agruparPorPlataforma(servicios) {
  const grupos = [];
  for (const servicio of servicios) {
    let grupo = grupos.find((g) => g.platform === servicio.platform);
    if (!grupo) {
      grupo = { platform: servicio.platform, nombre: nombrePlataforma(servicio.platform, servicio.name), opciones: [] };
      grupos.push(grupo);
    }
    grupo.opciones.push(servicio);
  }
  for (const grupo of grupos) {
    grupo.opciones.sort((a, b) => a.price - b.price);
  }
  return grupos;
}

export function formatearPrecio(monto, moneda) {
  return `${moneda}${monto}`;
}

export function formatearDuracion(dias) {
  return dias === 30 ? 'al mes' : `por ${dias} días`;
}

// 2026-12-23 -> 23 de diciembre de 2026
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function fechaLegible(fecha) {
  const [anio, mes, dia] = String(fecha).slice(0, 10).split('-').map(Number);
  if (!anio || !mes || !dia) return String(fecha);
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}


// Lo que recibe el cliente al entregarle una cuenta.
export function textoDeAcceso(cuenta, fechaFin) {
  return [
    '*Tus datos de acceso* 🔑',
    `📧 Correo: ${cuenta.email}`,
    `🔑 Contraseña: ${cuenta.password}`,
    ...(fechaFin ? [`📅 Vence el ${fechaLegible(fechaFin)} a las 8 pm`] : []),
    '',
    'Por seguridad, no compartas estos datos. 🔒',
  ].join('\n');
}
