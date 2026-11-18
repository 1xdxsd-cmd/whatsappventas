import { readFile } from 'node:fs/promises';
import { instrucciones, interpretarRespuesta } from './conocimiento.js';

const MENSAJES_RECORDADOS = 8; // con 4096 de contexto caben pocos mensajes además de las instrucciones
const OLVIDAR_TRAS = 2 * 3600 * 1000; // una conversación nueva tras 2 horas sin escribir
const PAUSA_TRAS_FALLA = 60_000; // si Ollama no responde, se usa el menú de números un minuto
// Ollama descarga el modelo de la tarjeta de video tras 5 minutos sin uso, y
// volver a cargarlo tarda; así se queda cargado todo el día.
const MANTENER_CARGADO = '24h';
const MAXIMO_DE_PALABRAS = 300; // tope de tokens por respuesta: los mensajes son cortos

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
    const inicio = ahora();
    try {
      const respuesta = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelo,
          messages: mensajes,
          stream: false,
          keep_alive: MANTENER_CARGADO,
          // Sin razonamiento: los modelos que "piensan" (tipo Qwen) tardan
          // minutos en eso hasta para un "hola".
          think: false,
          options: { temperature: 0.4, num_predict: MAXIMO_DE_PALABRAS },
        }),
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
      logger.warn(
        { causa: error.cause?.code ?? error.name ?? error.message, url: base, segundos: Math.round((ahora() - inicio) / 1000) },
        'La IA no respondió; uso el menú de números',
      );
      return null;
    }
  }

  // Carga el modelo al arrancar el bot, sin límite de tiempo, para que el
  // primer cliente no espere la carga.
  async function precalentar() {
    const inicio = ahora();
    try {
      const respuesta = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelo, keep_alive: MANTENER_CARGADO }),
      });
      if (!respuesta.ok) throw new Error(`Ollama respondió ${respuesta.status}`);
      await respuesta.json();
      logger.info({ modelo, segundos: Math.round((ahora() - inicio) / 1000) }, 'Modelo de IA cargado');
    } catch (error) {
      logger.warn({ causa: error.cause?.code ?? error.message, url: base }, 'No se pudo cargar el modelo de IA al arrancar');
    }
  }

  return {
    conversar,
    precalentar,
    // Al volver al menú con "menu", la siguiente conversación empieza de cero.
    olvidar: (chat) => historiales.delete(chat),
  };
}
