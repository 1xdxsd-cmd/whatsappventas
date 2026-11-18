import { readFile } from 'node:fs/promises';
import { instrucciones, interpretarRespuesta } from './conocimiento.js';

const MENSAJES_RECORDADOS = 8; // con 4096 de contexto caben pocos mensajes además de las instrucciones
const OLVIDAR_TRAS = 2 * 3600 * 1000; // una conversación nueva tras 2 horas sin escribir
const PAUSA_TRAS_FALLA = 60_000; // si Ollama no responde, se usa el menú de números un minuto

/**
 * Conversa con el modelo de Ollama. Si no responde a tiempo, devuelve null y
 * el bot sigue con el menú de números.
 * @param {{ url: string, modelo: string, esperaMs: number, archivoConocimiento?: string, logger: object, fetch?: Function, ahora?: () => number }} opciones
 */
export function crearAsistente({ url, modelo, esperaMs, archivoConocimiento, logger, fetch = globalThis.fetch, ahora = Date.now }) {
  const base = url.replace(/\/+$/, '');
  const historiales = new Map(); // chat -> { mensajes, ultimo }
  let pausadoHasta = 0;

  async function leerConocimiento() {
    if (!archivoConocimiento) return '';
    try {
      return await readFile(archivoConocimiento, 'utf8');
    } catch {
      return '';
    }
  }

  function historial(chat) {
    const guardado = historiales.get(chat);
    if (!guardado || ahora() - guardado.ultimo > OLVIDAR_TRAS) return [];
    return guardado.mensajes;
  }

  function recordar(chat, ...mensajes) {
    const todos = [...historial(chat), ...mensajes].slice(-MENSAJES_RECORDADOS);
    historiales.set(chat, { mensajes: todos, ultimo: ahora() });
  }

  async function conversar(chat, texto, contexto) {
    if (ahora() < pausadoHasta) return null;
    const mensajes = [
      { role: 'system', content: instrucciones(contexto, await leerConocimiento()) },
      ...historial(chat),
      { role: 'user', content: texto },
    ];
    try {
      const respuesta = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelo, messages: mensajes, stream: false, options: { temperature: 0.4 } }),
        signal: AbortSignal.timeout(esperaMs),
      });
      if (!respuesta.ok) throw new Error(`Ollama respondió ${respuesta.status}`);
      const datos = await respuesta.json();
      const resultado = interpretarRespuesta(datos.message?.content);
      if (!resultado.texto && resultado.opcion === null) throw new Error('Respuesta vacía');
      recordar(chat, { role: 'user', content: texto }, { role: 'assistant', content: datos.message.content });
      return resultado;
    } catch (error) {
      pausadoHasta = ahora() + PAUSA_TRAS_FALLA;
      logger.warn({ causa: error.cause?.code ?? error.name ?? error.message, url: base }, 'La IA no respondió; uso el menú de números');
      return null;
    }
  }

  return {
    conversar,
    // Al volver al menú con "menu", la siguiente conversación empieza de cero.
    olvidar: (chat) => historiales.delete(chat),
  };
}
