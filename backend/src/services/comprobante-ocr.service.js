import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { config } from '../config.js';
import { analizarTexto } from './comprobante-parser.service.js';

/**
 * Extracción automática de los datos del comprobante.
 *
 * Estrategia por defecto (`OCR_PROVIDER=auto`):
 *   1. Se preprocesa la imagen (escala de grises, contraste, tamaño) con sharp.
 *   2. Se reconoce el texto con Tesseract en español (funciona sin API key).
 *   3. Se interpretan los campos con expresiones regulares.
 *
 * Si se configura `gemini` u `openai` se usa el modelo de visión, que es más
 * preciso, y se cae a Tesseract si falla.
 */

const CAMPOS_VACIOS = {
  numeroTransaccion: null,
  valorEnviado: null,
  bancoOrigen: null,
  bancoDestino: null,
  llaveDestino: null,
  fechaTransaccion: null,
};

const INSTRUCCION = `Analiza el comprobante de pago colombiano de la imagen y responde SOLO con un JSON valido con esta forma exacta:
{"numeroTransaccion":string|null,"valorEnviado":number|null,"bancoOrigen":string|null,"bancoDestino":string|null,"llaveDestino":string|null,"fechaTransaccion":string|null}
Reglas: valorEnviado en pesos colombianos como numero entero sin puntos ni simbolos.
llaveDestino es el correo, celular o llave (@algo) que RECIBE el dinero.
fechaTransaccion en formato ISO 8601. Si un dato no aparece usa null. No agregues texto fuera del JSON.`;

/**
 * Modelos a los que se recurre si el configurado falla. Los Flash-Lite leen
 * comprobantes igual de bien que los Flash grandes, son más rápidos y su
 * cuota gratuita es muchísimo más holgada.
 */
const MODELOS_RESPALDO = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

// ------------------------------------------------------------
//  Tesseract: un worker reutilizable para todas las peticiones
// ------------------------------------------------------------

let workerPromise = null;

async function obtenerWorker() {
  workerPromise ??= createWorker('spa', 1, { cache_method: 'readOnly', legacyCore: false });
  return workerPromise;
}

/** Realza la imagen para que el OCR lea mejor cifras y etiquetas. */
async function prepararImagen(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: 1400, withoutEnlargement: false, fit: 'inside' })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

async function conTesseract(buffer) {
  const imagen = await prepararImagen(buffer);
  const worker = await obtenerWorker();
  const { data } = await worker.recognize(imagen);
  return { texto: data.text ?? '', confianza: data.confidence ?? 0 };
}

// ------------------------------------------------------------
//  Modelos de visión
// ------------------------------------------------------------

function extraerJson(texto) {
  if (!texto) return null;
  const limpio = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
  const inicio = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  if (inicio === -1 || fin === -1) return null;
  try {
    return JSON.parse(limpio.slice(inicio, fin + 1));
  } catch {
    return null;
  }
}

function normalizar(datos) {
  if (!datos || typeof datos !== 'object') return { ...CAMPOS_VACIOS };
  const valor = Number(String(datos.valorEnviado ?? '').replace(/[^\d]/g, ''));
  const texto = (campo) => (datos[campo] ? String(datos[campo]).trim() : null);

  return {
    numeroTransaccion: texto('numeroTransaccion'),
    valorEnviado: Number.isFinite(valor) && valor > 0 ? valor : null,
    bancoOrigen: texto('bancoOrigen'),
    bancoDestino: texto('bancoDestino'),
    llaveDestino: texto('llaveDestino'),
    fechaTransaccion: texto('fechaTransaccion'),
  };
}

async function conGemini(buffer, mimeType, modelo = config.ocr.geminiModelo) {
  const base64 = buffer.toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${config.ocr.geminiApiKey}`;
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { parts: [{ text: INSTRUCCION }, { inline_data: { mime_type: mimeType, data: base64 } }] },
      ],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  if (!respuesta.ok) throw new Error(`Gemini (${modelo}) respondio ${respuesta.status}`);
  const json = await respuesta.json();
  return extraerJson(json?.candidates?.[0]?.content?.parts?.[0]?.text);
}

/**
 * Llama a Gemini probando los modelos de respaldo si el principal está
 * agotado (429), saturado (503) o retirado (404). El plan gratuito de los
 * modelos Flash grandes es muy corto; los Flash-Lite aguantan mucho más.
 */
async function conGeminiTolerante(buffer, mimeType) {
  const candidatos = [
    config.ocr.geminiModelo,
    ...MODELOS_RESPALDO.filter((m) => m !== config.ocr.geminiModelo),
  ];

  for (const modelo of candidatos) {
    try {
      const datos = normalizar(await conGemini(buffer, mimeType, modelo));
      if (datos.valorEnviado) return datos;
      console.warn(`[comprobantes] ${modelo} no encontró el valor; se prueba el siguiente`);
    } catch (error) {
      console.warn(`[comprobantes] ${error.message}; se prueba el siguiente modelo`);
    }
  }
  return null;
}

async function conOpenai(buffer, mimeType) {
  const base64 = buffer.toString('base64');
  const respuesta = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ocr.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: INSTRUCCION },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
    }),
  });
  if (!respuesta.ok) throw new Error(`OpenAI respondio ${respuesta.status}`);
  const json = await respuesta.json();
  return extraerJson(json?.choices?.[0]?.message?.content);
}

// ------------------------------------------------------------
//  API pública
// ------------------------------------------------------------

/**
 * Campos que la validación necesita para aceptar un comprobante sin
 * intervención humana: sin ellos hay que recurrir al modelo de visión.
 */
function estaCompleto(datos) {
  return Boolean(
    datos.valorEnviado && datos.numeroTransaccion && datos.llaveDestino && datos.fechaTransaccion,
  );
}

/**
 * Analiza el comprobante y devuelve los datos detectados.
 * `requiereRevisionManual` indica que falta información clave y el usuario
 * debe completarla antes de continuar.
 *
 * Estrategias según `OCR_PROVIDER`:
 *   auto   -> Tesseract primero (~0,4 s, sin red ni cuota) y solo si falta
 *             algún campo se consulta a Gemini. Es la más rápida y la que
 *             menos cuota gasta.
 *   gemini -> Gemini primero, Tesseract como red de seguridad.
 *   manual -> sin extracción automática.
 */
export async function analizarComprobante({ buffer, mimeType }) {
  const esPdf = mimeType === 'application/pdf';
  const proveedor = config.ocr.provider;
  const hayGemini = Boolean(config.ocr.geminiApiKey);

  // ---- Estrategia rápida: OCR local primero -------------------------
  // Tesseract tarda una fracción de lo que tarda una llamada de red y no
  // consume cuota. Si saca todos los campos, no hace falta nada más.
  if (proveedor === 'auto' && !esPdf) {
    let local = null;
    try {
      const { texto, confianza } = await conTesseract(buffer);
      const datos = normalizar(analizarTexto(texto));
      local = { datos, confianza, texto };
      if (estaCompleto(datos)) {
        return {
          datos,
          origen: 'ocr',
          confianza: Math.round(confianza),
          requiereRevisionManual: false,
          texto,
        };
      }
      const faltan = Object.entries({
        valor: datos.valorEnviado,
        transaccion: datos.numeroTransaccion,
        llave: datos.llaveDestino,
        fecha: datos.fechaTransaccion,
      })
        .filter(([, v]) => !v)
        .map(([k]) => k);
      console.log(`[comprobantes] OCR local no leyó: ${faltan.join(', ')} · se consulta el modelo`);
    } catch (error) {
      console.warn('[comprobantes] OCR local falló:', error.message);
    }

    // Faltó algo: el modelo de visión completa la lectura.
    if (hayGemini) {
      const datos = await conGeminiTolerante(buffer, mimeType);
      if (datos) return { datos, origen: 'ia', requiereRevisionManual: false, texto: null };
    }

    // Sin Gemini disponible se devuelve lo que sacó Tesseract.
    if (local) {
      return {
        datos: local.datos,
        origen: 'ocr',
        confianza: Math.round(local.confianza),
        requiereRevisionManual:
          !local.datos.valorEnviado || !local.datos.numeroTransaccion,
        texto: local.texto,
      };
    }
  }

  // ---- Estrategia con modelo de visión primero ----------------------
  if (proveedor === 'gemini' && hayGemini) {
    const datos = await conGeminiTolerante(buffer, mimeType);
    if (datos) return { datos, origen: 'ia', requiereRevisionManual: false, texto: null };
  }

  if (proveedor === 'openai' && config.ocr.openaiApiKey) {
    try {
      const datos = normalizar(await conOpenai(buffer, mimeType));
      if (datos.valorEnviado) {
        return { datos, origen: 'ia', requiereRevisionManual: false, texto: null };
      }
    } catch (error) {
      console.warn('[comprobantes] OpenAI falló:', error.message);
    }
  }

  // ---- Red de seguridad: OCR local (no aplica a PDF) ---------------
  if (proveedor !== 'manual' && !esPdf) {
    try {
      const { texto, confianza } = await conTesseract(buffer);
      const datos = normalizar(analizarTexto(texto));
      return {
        datos,
        origen: 'ocr',
        confianza: Math.round(confianza),
        requiereRevisionManual: !datos.valorEnviado || !datos.numeroTransaccion,
        texto,
      };
    } catch (error) {
      console.warn('[comprobantes] OCR local falló:', error.message);
    }
  }

  // ---- Sin extracción posible: el usuario diligencia los datos ------
  return {
    datos: { ...CAMPOS_VACIOS },
    origen: 'manual',
    requiereRevisionManual: true,
    texto: null,
  };
}

/** Libera el worker de Tesseract al apagar el servidor. */
export async function cerrarOcr() {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    /* nada que hacer al apagar */
  }
  workerPromise = null;
}
