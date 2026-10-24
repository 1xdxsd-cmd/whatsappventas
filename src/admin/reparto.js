// Reparte a los clientes entre las cuentas de transferencia de los admins, por
// turnos. Cada cliente se queda con la misma cuenta mientras el bot siga
// encendido, para que el comprobante le llegue al admin al que le pagó.
export function crearRepartoDePagos(cuentas) {
  const asignadas = new Map();
  let siguiente = 0;
  return {
    cuentaPara(cliente) {
      if (cuentas.length === 0) return null;
      if (!asignadas.has(cliente)) {
        asignadas.set(cliente, cuentas[siguiente % cuentas.length]);
        siguiente += 1;
      }
      return asignadas.get(cliente);
    },
  };
}
