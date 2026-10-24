// Funciones puras para interpretar los datos de la página (StreamRent).

// Igual que en la página: una renta sigue activa hasta las 8:00 pm (hora de
// México) del día de vencimiento.
const CORTE_VENCIMIENTO_MX = 'T20:00:00-06:00';

export function rentaActiva(fechaFin, ahora = new Date()) {
  if (!fechaFin) return false;
  const corte = new Date(String(fechaFin).slice(0, 10) + CORTE_VENCIMIENTO_MX).getTime();
  if (Number.isNaN(corte)) return new Date(fechaFin) > ahora;
  return ahora.getTime() < corte;
}

// Compara por los últimos 10 dígitos, así "+52 1 55 1234 5678",
// "5215512345678" y "5512345678" son el mismo número.
export function mismoTelefono(a, b) {
  const ultimos = (numero) => String(numero ?? '').replace(/\D/g, '').slice(-10);
  const x = ultimos(a);
  return x.length === 10 && x === ultimos(b);
}

export function textoMetodosPago(metodos) {
  return metodos
    .filter((m) => m.active !== false)
    .map((m) => {
      const lineas = [`*${m.type === 'transferencia' ? 'Transferencia' : m.type} ${m.bank}*`];
      if (m.holder) lineas.push(`Titular: ${m.holder}`);
      if (m.clabe) lineas.push(`CLABE: ${m.clabe}`);
      if (m.cardNumber) lineas.push(`Tarjeta: ${m.cardNumber}`);
      return lineas.join('\n');
    })
    .join('\n\n');
}
