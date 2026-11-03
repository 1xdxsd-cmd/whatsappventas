import 'dotenv/config';
import { normalizarNumero, normalizarNumeroBot } from './whatsapp/conexion.js';

const listaDeNumeros = (texto) => String(texto ?? '').split(',').map(normalizarNumero).filter(Boolean);
const conSaltos = (texto) => texto.replace(/\\n/g, '\n');

// Personas a las que el cliente puede pagar: PAGO_1_NOMBRE, PAGO_1_NUMEROS
// (uno o varios, separados por comas) y PAGO_1_DATOS; luego PAGO_2_..., etc.
const cobradores = [];
for (let i = 1; process.env[`PAGO_${i}_NOMBRE`] || process.env[`PAGO_${i}_DATOS`]; i += 1) {
  const datos = process.env[`PAGO_${i}_DATOS`]?.trim();
  if (!datos) continue;
  cobradores.push({
    nombre: process.env[`PAGO_${i}_NOMBRE`]?.trim() || `Cuenta ${i}`,
    numeros: listaDeNumeros(process.env[`PAGO_${i}_NUMEROS`]),
    datos: conSaltos(datos),
  });
}

// Uno o varios administradores, separados por comas. Los números de quienes
// cobran también son admins.
const numerosAdmin = [...new Set([...listaDeNumeros(process.env.NUMERO_ADMIN), ...cobradores.flatMap((c) => c.numeros)])];

export const config = {
  numerosAdmin,
  cobradores,
  negocio: process.env.NOMBRE_NEGOCIO || 'Streaming Thalia',
  moneda: process.env.MONEDA || '$',
  // Si los escribiste en el .env, mandan sobre los métodos de pago de la página.
  datosTransferenciaEnEnv: Boolean(process.env.DATOS_TRANSFERENCIA?.trim()),
  datosTransferencia: conSaltos(process.env.DATOS_TRANSFERENCIA || 'Pide los datos de transferencia a un asesor.'),
  carpetaSesion: process.env.CARPETA_SESION || 'auth',
  numeroBot: normalizarNumeroBot(process.env.NUMERO_BOT),
  codigoVinculacion: process.env.CODIGO_VINCULACION,
  // Dirección de la página que ven los clientes (puede ser distinta de PAGINA_URL).
  enlacePagina: process.env.PAGINA_ENLACE || '',
  archivoRecordatorios: process.env.ARCHIVO_RECORDATORIOS || 'datos/recordatorios.json',
  pagina: process.env.PAGINA_URL
    ? { url: process.env.PAGINA_URL, usuario: process.env.PAGINA_USUARIO, clave: process.env.PAGINA_CLAVE }
    : null,
};
