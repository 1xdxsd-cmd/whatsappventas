import 'dotenv/config';

function limpiarNumero(numero) {
  return (numero ?? '').replace(/\D/g, '');
}

const numeroAdmin = limpiarNumero(process.env.NUMERO_ADMIN);

export const config = {
  numeroAdmin,
  jidAdmin: numeroAdmin ? `${numeroAdmin}@s.whatsapp.net` : null,
  moneda: process.env.MONEDA || '$',
  datosTransferencia: (process.env.DATOS_TRANSFERENCIA || 'Pide los datos de transferencia a un asesor.').replace(/\\n/g, '\n'),
  carpetaSesion: process.env.CARPETA_SESION || 'auth',
  archivoRecordatorios: process.env.ARCHIVO_RECORDATORIOS || 'datos/recordatorios.json',
  pagina: process.env.PAGINA_URL
    ? { url: process.env.PAGINA_URL, usuario: process.env.PAGINA_USUARIO, clave: process.env.PAGINA_CLAVE }
    : null,
};
