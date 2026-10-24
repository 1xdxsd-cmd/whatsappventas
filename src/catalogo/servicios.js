// Precios mensuales por servicio. "perfil" es un perfil dentro de una cuenta
// compartida; "completa" es la cuenta entera para un solo cliente.
export const SERVICIOS = [
  { id: 'netflix', nombre: 'Netflix', precios: { perfil: 80, completa: 200 } },
  { id: 'disney', nombre: 'Disney+', precios: { perfil: 60, completa: 140 } },
  { id: 'hbo', nombre: 'HBO Max', precios: { perfil: 50, completa: 140 } },
];

export const TIPOS = [
  { id: 'perfil', nombre: 'Perfil' },
  { id: 'completa', nombre: 'Cuenta completa' },
];

export function formatearPrecio(monto, moneda) {
  return `${moneda}${monto}`;
}
