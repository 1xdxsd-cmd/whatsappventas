import { readFile } from 'node:fs/promises';
import { instrucciones, interpretarRespuesta, repararRespuesta, respaldoPara, revisarRespuesta } from './conocimiento.js';

const MENSAJES_RECORDADOS = 12; // con 4096 de contexto caben pocos mensajes además de las instrucciones
const LARGO_RECORDADO = 500; // los mensajes largos del bot (listas) se recortan en la memoria
const OLVIDAR_TRAS = 6 * 3600 * 1000; // una conversación nueva tras 6 horas sin escribir
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
    const recortados = mensajes.map((m) => ({ ...m, content: String(m.content).slice(0, LARGO_RECORDADO) }));
    const todos = [...historial(chat), ...recortados].slice(-MENSAJES_RECORDADOS);
    historiales.set(chat, { mensajes: todos, ultimo: ahora() });
  }

  async function preguntar(mensajes) {
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
    const crudo = String((await respuesta.json()).message?.content ?? '');
    const resultado = interpretarRespuesta(crudo);
    if (!resultado.texto && resultado.accion === null) throw new Error('Respuesta vacía');
    return { ...resultado, crudo };
  }

  async function conversar(chat, texto, contexto) {
    if (ahora() < pausadoHasta) return null;
    const anteriores = historial(chat);
    const mensajes = [
      { role: 'system', content: instrucciones(contexto, await leerConocimiento(), { conversacionEnCurso: anteriores.length > 0 }) },
      ...anteriores,
      { role: 'user', content: texto },
    ];
    const inicio = ahora();
    try {
      let resultado = repararRespuesta(await preguntar(mensajes));
      // Si inventó datos o dijo que confirmó un pago, se le pide otra respuesta
      // una vez; si insiste, se manda un texto seguro.
      const correccion = revisarRespuesta(resultado, texto, contexto);
      if (correccion) {
        logger.warn({ texto: resultado.texto, correccion }, 'La IA respondió algo que no puede decir; le pido otra respuesta');
        resultado = repararRespuesta(await preguntar([...mensajes, { role: 'assistant', content: resultado.crudo }, { role: 'system', content: correccion }]));
        if (revisarRespuesta(resultado, texto, contexto)) {
          // Nunca se manda el texto roto; tampoco se molesta a un asesor por esto.
          resultado = { texto: respaldoPara(correccion, contexto.cobradores), accion: null, crudo: '' };
        }
      }
      // Se recuerda con su etiqueta, para que el modelo vea que así se hacen las acciones.
      const etiqueta = resultado.accion ? ` [[${[resultado.accion.nombre, ...resultado.accion.datos].join(':')}]]` : '';
      recordar(chat, { role: 'user', content: texto }, { role: 'assistant', content: `${resultado.texto}${etiqueta}` });
      return { texto: resultado.texto, accion: resultado.accion };
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
    // Lo que el bot y el cliente se dicen sin la IA (listas, números elegidos,
    // confirmaciones) también entra a la memoria, para que la IA sepa qué ve el cliente.
    anotar: (chat, role, content) => recordar(chat, { role, content }),
    // Los últimos mensajes del cliente, para que el asesor sepa qué pasó.
    loQueDijo: (chat, cuantos = 3) =>
      historial(chat)
        .filter((m) => m.role === 'user')
        .slice(-cuantos)
        .map((m) => m.content),
  };
}
