import 'dotenv/config';
import { normalizarNumeroBot } from './whatsapp/conexion.js';

function limpiarNumero(numero) {
  return (numero ?? '').replace(/\D/g, '');
}

const numeroAdmin = limpiarNumero(process.env.NUMERO_ADMIN);

export const config = {
  numeroAdmin,
  jidAdmin: numeroAdmin ? `${numeroAdmin}@s.whatsapp.net` : null,
  negocio: process.env.NOMBRE_NEGOCIO || 'Streaming Thalia',
  moneda: process.env.MONEDA || '$',
  datosTransferencia: (process.env.DATOS_TRANSFERENCIA || 'Pide los datos de transferencia a un asesor.').replace(/\\n/g, '\n'),
  carpetaSesion: process.env.CARPETA_SESION || 'auth',
  numeroBot: normalizarNumeroBot(process.env.NUMERO_BOT),
  archivoRecordatorios: process.env.ARCHIVO_RECORDATORIOS || 'datos/recordatorios.json',
  pagina: process.env.PAGINA_URL
    ? { url: process.env.PAGINA_URL, usuario: process.env.PAGINA_USUARIO, clave: process.env.PAGINA_CLAVE }
    : null,
};
