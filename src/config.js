import 'dotenv/config';
import { normalizarNumero, normalizarNumeroBot } from './whatsapp/conexion.js';

const numeroAdmin = normalizarNumero(process.env.NUMERO_ADMIN);

export const config = {
  numeroAdmin,
  // Respaldo; el bot le pregunta a WhatsApp el chat correcto del admin al conectarse.
  jidAdmin: numeroAdmin ? `${numeroAdmin}@s.whatsapp.net` : null,
  negocio: process.env.NOMBRE_NEGOCIO || 'Streaming Thalia',
  moneda: process.env.MONEDA || '$',
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
