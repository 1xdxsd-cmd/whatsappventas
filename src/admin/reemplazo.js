import { nombrePlataforma } from '../catalogo/servicios.js';

// Cuentas que pueden reemplazar a una caída: misma plataforma y tipo de venta,
// no suspendidas, distintas de la caída y con lugares libres. La página pasa a
// la cuenta nueva todas las rentas activas de la caída, así que primero van
// las que tienen más lugares.
export function opcionesDeReemplazo(cuentas, renta, maximo = 5) {
  const tipo = renta.type === 'cuenta' ? 'cuenta' : 'perfil';
  const correoCaido = String(renta.email ?? '').toLowerCase();
  return cuentas
    .filter((c) => c.platform === renta.platform && !c.suspended && (c.saleType || 'perfil') === tipo)
    .filter((c) => c.id !== renta.accountId && String(c.email ?? '').toLowerCase() !== correoCaido)
    .map((c) => {
      const cupo = c.capacity ?? (tipo === 'cuenta' ? 1 : c.totalProfiles || 1);
      return { id: c.id, email: c.email, libres: cupo - (c.usedProfiles ?? 0) };
    })
    .filter((c) => c.libres > 0)
    .sort((a, b) => b.libres - a.libres)
    .slice(0, maximo);
}

// Lo que se le muestra al admin en el aviso del reporte.
export function textoOpcionesDeReemplazo(caso) {
  const lineas = [`Respóndele con #${caso.id} texto.`];
  const plataforma = nombrePlataforma(caso.plataforma);
  if (caso.opciones?.length) {
    lineas.push('', `Cuentas de ${plataforma} libres para reemplazarla:`);
    caso.opciones.forEach((c, i) => lineas.push(`*${i + 1}.* ${c.email} (${c.libres} ${c.libres === 1 ? 'libre' : 'libres'})`));
    lineas.push('', `Para usar una: */reemplazar ${caso.id} 1*`);
  } else {
    lineas.push('', `No hay cuentas de ${plataforma} libres para reemplazarla.`);
  }
  lineas.push(`Para una cuenta nueva: */reemplazar ${caso.id} correo contraseña* (opcional al final: número de perfiles)`);
  lineas.push(`Si lo arreglas de otra forma: */resuelto ${caso.id} texto*`);
  return lineas.join('\n');
}

/**
 * Lee lo que va después del número de caso en /reemplazar.
 * @returns {{ opcion: number } | { email: string, password: string, perfiles: number | null } | null}
 */
export function leerReemplazo(resto) {
  const partes = String(resto ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 1 && /^\d+$/.test(partes[0])) return { opcion: Number(partes[0]) };
  if (partes.length === 2 || (partes.length === 3 && /^\d+$/.test(partes[2]))) {
    if (!partes[0].includes('@')) return null;
    return { email: partes[0], password: partes[1], perfiles: partes[2] ? Number(partes[2]) : null };
  }
  return null;
}
