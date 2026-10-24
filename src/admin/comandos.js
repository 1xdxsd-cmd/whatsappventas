// Comandos que Anthony escribe al bot desde su WhatsApp.

export const AYUDA = [
  '*Comandos de admin*',
  '',
  '*#12 texto*: envía ese texto al cliente del caso 12 (sirve para mandar cuentas o responder reportes)',
  '*/aprobar 12*: confirma el pago, entrega la cuenta (o renueva) y pasa el pedido a Ventas; en una recarga, suma el crédito',
  '*/rechazar 12 motivo*: avisa al cliente que no se confirmó el pago',
  '*/resuelto 12 texto*: marca el reporte como resuelto en la página y le manda el texto al cliente',
  '*/tomar 12*: atiendes tú al cliente del caso 12 (a los demás admins se les avisa). Lo que escribas le llega a él, y lo que él escriba te llega solo a ti',
  '*/fin*: termina el chat activo y el cliente vuelve al bot',
  '*/casos*: lista los casos abiertos',
  '*/ayuda*: esta lista',
].join('\n');

function sinAcentos(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * @returns {{ comando: string | null, caso: number | null, resto: string }}
 */
export function interpretarComando(texto) {
  const limpio = (texto ?? '').trim();
  const directo = limpio.match(/^#(\d+)\s*([\s\S]*)$/);
  if (directo) return { comando: 'enviar', caso: Number(directo[1]), resto: directo[2].trim() };
  const comando = limpio.match(/^\/(\S+)(?:\s+#?(\d+))?\s*([\s\S]*)$/);
  if (comando) {
    return { comando: sinAcentos(comando[1]), caso: comando[2] ? Number(comando[2]) : null, resto: comando[3].trim() };
  }
  return { comando: null, caso: null, resto: limpio };
}

// Registro de casos en memoria: cada pedido, reporte o chat con asesor tiene
// un número corto (#12) para que Anthony lo atienda desde WhatsApp.
// Se pierde al reiniciar el bot, igual que el estado de las conversaciones.
export function crearRegistroDeCasos() {
  const casos = new Map();
  let siguiente = 1;
  return {
    abrir(datos) {
      const caso = { id: siguiente++, abierto: true, creado: new Date().toISOString(), ...datos };
      casos.set(caso.id, caso);
      return caso;
    },
    obtener(id) {
      return casos.get(id) ?? null;
    },
    cerrar(id) {
      const caso = casos.get(id);
      if (caso) caso.abierto = false;
      return caso ?? null;
    },
    abiertoDe(jid, tipo) {
      return [...casos.values()].reverse().find((c) => c.abierto && c.jid === jid && c.tipo === tipo) ?? null;
    },
    abiertos() {
      return [...casos.values()].filter((c) => c.abierto);
    },
  };
}

const NOMBRE_TIPO = { pedido: 'pedido', recarga: 'recarga de crédito', reporte: 'reporte', asesor: 'chat con asesor', entrega: 'entrega pendiente' };

export function textoCasos(casos) {
  if (casos.length === 0) return 'No hay casos abiertos.';
  return ['*Casos abiertos*', '', ...casos.map((c) => `#${c.id} ${c.nombre}: ${NOMBRE_TIPO[c.tipo] ?? c.tipo}${c.resumen ? ` (${c.resumen})` : ''}`)].join('\n');
}
