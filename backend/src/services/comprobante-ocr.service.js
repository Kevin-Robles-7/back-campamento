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

async function conGemini(buffer, mimeType) {
  const base64 = buffer.toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.ocr.geminiModelo}:generateContent?key=${config.ocr.geminiApiKey}`;
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
  if (!respuesta.ok) throw new Error(`Gemini respondio ${respuesta.status}`);
  const json = await respuesta.json();
  return extraerJson(json?.candidates?.[0]?.content?.parts?.[0]?.text);
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
 * Analiza el comprobante y devuelve los datos detectados.
 * `requiereRevisionManual` indica que falta información clave y el usuario
 * debe completarla antes de continuar.
 */
export async function analizarComprobante({ buffer, mimeType }) {
  const esPdf = mimeType === 'application/pdf';
  const proveedor = config.ocr.provider;

  // 1) Modelo de visión, si está configurado.
  if (proveedor === 'gemini' && config.ocr.geminiApiKey) {
    try {
      const datos = normalizar(await conGemini(buffer, mimeType));
      if (datos.valorEnviado) {
        return { datos, origen: 'ia', requiereRevisionManual: false, texto: null };
      }
    } catch (error) {
      console.warn('[comprobantes] Gemini falló:', error.message);
    }
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

  // 2) OCR local con Tesseract (no aplica a PDF).
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

  // 3) Sin extracción posible: el usuario diligencia los datos.
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
