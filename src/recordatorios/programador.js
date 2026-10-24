import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { enHorarioDeAvisos, recordatoriosPendientes } from './calculo.js';

const CADA = 10 * 60 * 1000; // revisa cada 10 minutos: los avisos salen poco después de las 12 pm
const PAUSA_ENTRE_CLIENTES = 20_000; // mensajes que el bot inicia: más espaciados para cuidar el número
const DIAS_GUARDADOS = 60;

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Guarda en un archivo qué avisos ya se mandaron, para no repetirlos tras un reinicio.
async function leerEnviados(archivo) {
  try {
    return JSON.parse(await readFile(archivo, 'utf8'));
  } catch {
    return {};
  }
}

async function guardarEnviados(archivo, enviados) {
  const limite = Date.now() - DIAS_GUARDADOS * 864e5;
  const vigentes = Object.fromEntries(Object.entries(enviados).filter(([, fecha]) => Date.parse(fecha) > limite));
  await mkdir(dirname(archivo), { recursive: true });
  await writeFile(archivo, JSON.stringify(vigentes, null, 2));
}

export function iniciarRecordatorios({ pagina, conexion, archivo, avisarAdmin, negocio, logger }) {
  let corriendo = false;

  async function revisar() {
    if (corriendo || !enHorarioDeAvisos() || !conexion.conectado()) return;
    corriendo = true;
    try {
      const enviados = await leerEnviados(archivo);
      const [clientes, rentas] = await Promise.all([pagina.clientes(), pagina.rentas()]);
      const pendientes = recordatoriosPendientes({ clientes, rentas, enviados: new Set(Object.keys(enviados)), negocio });
      const avisados = [];
      for (const pendiente of pendientes) {
        const jid = await conexion.buscarJid(pendiente.telefono);
        if (!jid) {
          logger.warn({ cliente: pendiente.nombre }, 'El teléfono del cliente no tiene WhatsApp; no se envía recordatorio');
        } else {
          await conexion.enviarTexto(jid, pendiente.texto);
          avisados.push(pendiente.nombre);
        }
        // Se marca aunque no tenga WhatsApp, para no reintentarlo cada media hora.
        for (const clave of pendiente.claves) enviados[clave] = new Date().toISOString();
        await guardarEnviados(archivo, enviados);
        await esperar(PAUSA_ENTRE_CLIENTES);
      }
      if (avisados.length > 0) {
        logger.info({ total: avisados.length }, 'Recordatorios de vencimiento enviados');
        await avisarAdmin(`🔔 Recordatorios de vencimiento enviados a: ${avisados.join(', ')}`);
      }
    } catch (error) {
      logger.error({ err: error }, 'No se pudieron enviar los recordatorios');
    } finally {
      corriendo = false;
    }
  }

  setTimeout(revisar, 60_000); // primera revisión un minuto después de arrancar
  setInterval(revisar, CADA);
}
