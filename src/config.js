import 'dotenv/config';
import { normalizarNumero, normalizarNumeroBot } from './whatsapp/conexion.js';

// Uno o varios administradores, separados por comas.
const numerosAdmin = String(process.env.NUMERO_ADMIN ?? '')
  .split(',')
  .map(normalizarNumero)
  .filter(Boolean);

export const config = {
  numerosAdmin,
  negocio: process.env.NOMBRE_NEGOCIO || 'Streaming Thalia',
  moneda: process.env.MONEDA || '$',
  // Si los escribiste en el .env, mandan sobre los métodos de pago de la página.
  datosTransferenciaEnEnv: Boolean(process.env.DATOS_TRANSFERENCIA?.trim()),
  datosTransferencia: (process.env.DATOS_TRANSFERENCIA || 'Pide los datos de transferencia a un asesor.').replace(/\\n/g, '\n'),
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
