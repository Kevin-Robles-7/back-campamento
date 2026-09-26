/**
 * Extrae los datos clave de un comprobante de pago colombiano a partir
 * del texto reconocido (OCR o modelo de visión).
 *
 * Los patrones cubren los formatos más comunes: Nequi, Daviplata, Bancolombia,
 * Bre-B / llaves, Nu, Lulo, Movii y transferencias PSE.
 */

const MESES = {
  ene: 0, enero: 0,
  feb: 1, febrero: 1,
  mar: 2, marzo: 2,
  abr: 3, abril: 3,
  may: 4, mayo: 4,
  jun: 5, junio: 5,
  jul: 6, julio: 6,
  ago: 7, agosto: 7,
  sep: 8, sept: 8, septiembre: 8,
  oct: 9, octubre: 9,
  nov: 10, noviembre: 10,
  dic: 11, diciembre: 11,
};

const BANCOS = [
  'Nequi', 'Daviplata', 'Bancolombia', 'Davivienda', 'BBVA', 'Banco de Bogotá',
  'Banco de Occidente', 'Banco Popular', 'Banco Caja Social', 'Banco Agrario',
  'Banco AV Villas', 'Banco Falabella', 'Banco Pichincha', 'Banco W', 'Bancamía',
  'Scotiabank', 'Colpatria', 'Itaú', 'Citibank', 'Nu', 'Lulo Bank', 'Movii',
  'Rappipay', 'Iris', 'Ualá', 'Powwi', 'Dale', 'Coink', 'Tuya', 'Pibank',
];

/** Normaliza el texto para facilitar las búsquedas. */
function limpiar(texto) {
  return texto
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r/g, '');
}

/**
 * Corrige confusiones típicas del OCR en correos electrónicos:
 * "campamentobp O gmail.com", "campamentobp e gmail.com" o
 * "campamentobp @ gmail. com" se convierten en "campamentobp@gmail.com".
 */
const TLD = '(?:com|co|net|org|edu|es|gov|info)';

/** La arroba está presente pero con espacios sobrantes. */
const CORREO_ESPACIADO = new RegExp(
  `([A-Za-z0-9._%+-]{3,})\\s*@\\s*([A-Za-z0-9-]{2,})\\s*\\.\\s*(${TLD})((?:\\s*\\.\\s*[a-z]{2})?)`,
  'gi',
);

/**
 * La arroba se leyó como una letra suelta. Se exige espacio a ambos lados
 * para no partir un dominio que ya estaba bien escrito.
 */
const CORREO_ARROBA_PERDIDA = new RegExp(
  `([A-Za-z0-9._%+-]{3,})\\s+(?:\\(a\\)|\\[at\\]|at|[aeocOQ0©®°])\\s+([A-Za-z0-9-]{2,})\\s*\\.\\s*(${TLD})((?:\\s*\\.\\s*[a-z]{2})?)`,
  'gi',
);

function unirCorreo(_completo, usuario, dominio, tld, pais) {
  const sufijo = pais ? pais.replace(/\s/g, '') : '';
  return `${usuario}@${dominio}.${tld.toLowerCase()}${sufijo}`;
}

function corregirCorreos(texto) {
  return texto
    .replace(CORREO_ESPACIADO, unirCorreo)
    .replace(CORREO_ARROBA_PERDIDA, unirCorreo);
}

/**
 * Corrige llaves tipo Bre-B donde el OCR pierde la arroba:
 * "OPlata3143817689" o "0 Plata 314 381 7689" -> "@Plata3143817689".
 */
function corregirLlaves(texto) {
  return texto.replace(
    /(?:^|\s)[@O0o]\s?([A-Za-z]{3,12})\s?((?:\d[\s-]?){8,14})/g,
    // El espacio final evita que la palabra siguiente quede pegada a la llave.
    (_, nombre, digitos) => ` @${nombre}${digitos.replace(/[\s-]/g, '')} `,
  );
}

/** Quita tildes y pasa a minúsculas. */
function sinTildes(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// ------------------------------------------------------------
//  Valor
// ------------------------------------------------------------

/** Convierte "180.000,50" o "180,000.50" o "$ 180.000" a 180000. */
function aNumero(crudo) {
  if (!crudo) return null;
  let texto = String(crudo).replace(/[^\d.,]/g, '');
  if (!texto) return null;

  const ultimaComa = texto.lastIndexOf(',');
  const ultimoPunto = texto.lastIndexOf('.');
  const separadorDecimal = Math.max(ultimaComa, ultimoPunto);

  // Solo se considera decimal si deja exactamente 2 dígitos al final.
  if (separadorDecimal > -1 && texto.length - separadorDecimal - 1 === 2) {
    const enteros = texto.slice(0, separadorDecimal).replace(/[.,]/g, '');
    texto = enteros;
  } else {
    texto = texto.replace(/[.,]/g, '');
  }

  const valor = Number.parseInt(texto, 10);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

const PATRONES_VALOR = [
  /(?:valor|monto|total)\s*(?:enviado|transferido|pagado|de la transacci[oó]n)?\s*[:$]*\s*\$?\s*([\d.,]{4,})/i,
  /(?:enviaste|env[ií]o|transferiste|pagaste)\s*\$?\s*([\d.,]{4,})/i,
  /\$\s*([\d]{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?)/,
  /\$\s*([\d]{4,})/,
];

function extraerValor(texto) {
  for (const patron of PATRONES_VALOR) {
    const valor = aNumero(texto.match(patron)?.[1]);
    if (valor) return valor;
  }

  // Último recurso: el número con formato de miles más grande del texto.
  const candidatos = [...texto.matchAll(/\b\d{1,3}(?:[.,]\d{3})+\b/g)]
    .map((m) => aNumero(m[0]))
    .filter((n) => n && n >= 1000);
  return candidatos.length ? Math.max(...candidatos) : null;
}

// ------------------------------------------------------------
//  Número de transacción
// ------------------------------------------------------------

const PATRONES_TRANSACCION = [
  /(?:n[uú]mero|n[°º.]?|no\.?|c[oó]digo|id)\s*(?:de)?\s*(?:transacci[oó]n|comprobante|referencia|aprobaci[oó]n|operaci[oó]n)\s*[:#]?\s*([A-Z0-9-]{5,30})/i,
  /(?:transacci[oó]n|comprobante|referencia|aprobaci[oó]n|operaci[oó]n|cus)\s*[:#]?\s*([A-Z0-9-]{5,30})/i,
];

function extraerTransaccion(texto) {
  for (const patron of PATRONES_TRANSACCION) {
    const crudo = texto.match(patron)?.[1];
    if (crudo && /\d/.test(crudo)) return crudo.trim().toUpperCase();
  }

  // Secuencia larga de dígitos que no parece un valor de dinero ni un teléfono.
  const suelto = [...texto.matchAll(/\b(\d{8,20})\b/g)]
    .map((m) => m[1])
    .find((n) => !n.startsWith('3') || n.length > 10);
  return suelto ?? null;
}

// ------------------------------------------------------------
//  Bancos y llave destino
// ------------------------------------------------------------

/** ¿El texto menciona este banco como palabra completa? Evita que "Nu"
 *  coincida dentro de "Número" o "Iris" dentro de otra palabra. */
function mencionaBanco(texto, banco) {
  const patron = new RegExp(`(?<![a-z])${sinTildes(banco).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i');
  return patron.test(sinTildes(texto));
}

/**
 * Busca el nombre de un banco en la ventana de texto que sigue a una etiqueta.
 * Se usa una ventana (y no solo la misma línea) porque los comprobantes suelen
 * partir el dato: "Enviaste a: WILBERTO ROBLES SOTO -\nDaviplata".
 *
 * Solo devuelve entidades conocidas: si no reconoce ninguna, prefiere null
 * antes que texto basura como "Ahorros No.".
 */
function extraerBanco(texto, etiquetas) {
  for (const etiqueta of etiquetas) {
    const patron = new RegExp(`${etiqueta}\\s*[:]?([\\s\\S]{0,80})`, 'i');
    const ventana = texto.match(patron)?.[1];
    if (!ventana) continue;
    const conocido = BANCOS.find((banco) => mencionaBanco(ventana, banco));
    if (conocido) return conocido;
  }
  return null;
}

/** Último recurso: cualquier banco conocido mencionado en el comprobante. */
function bancoMencionado(texto, excluir) {
  return BANCOS.find((banco) => banco !== excluir && mencionaBanco(texto, banco)) ?? null;
}

/** Correos que nunca son el destino del pago (pie de página, soporte, etc.). */
const CORREOS_IGNORADOS =
  /^(no-?reply|noreply|soporte|servicio|ayuda|info|contacto|atencion|notificaciones)@|@(nequi|bancolombia|daviplata|davivienda|bbva|scotiabank|lulobank|movii|rappipay)\./i;

/**
 * Llave Bre-B tolerante a errores de OCR. La arroba suele leerse como
 * A, O, 0, Q o desaparecer, y el celular queda pegado al nombre:
 * "APLATA3143817689", "OPlata 314 381 7689" o "PLATA3143817689".
 */
const LLAVE_BRE_B = /(?:^|[\s:])[@AaOo0QqCc]?\s?([A-Za-z]{3,14})\s?((?:\d[\s-]?){9,13}\d|\d{10})(?!\d)/;

/**
 * Devuelve la cuenta que RECIBE el dinero. Se prioriza el valor que aparece
 * junto a una etiqueta explícita, porque un comprobante puede traer otros
 * correos o números que no son el destino.
 */
function extraerLlave(texto) {
  const ETIQUETAS =
    '(?:llave(?:\\s+destino)?|clave|destino|cuenta\\s+destino|n[uú]mero\\s+de\\s+cuenta|para|envia(?:ste|do)\\s+a|receptor|beneficiario)';

  // 1) Valor pegado a la etiqueta: "Llave destino: @Plata3143817689"
  const etiquetado = texto.match(
    new RegExp(
      `${ETIQUETAS}\\s*[:\\-]?\\s*(@?[\\w.+-]+@[\\w-]+\\.[\\w.-]{2,}|@[A-Za-z][\\w.-]{3,30}|[+\\d][\\d\\s-]{6,25})`,
      'i',
    ),
  )?.[1];
  if (etiquetado) {
    const valor = etiquetado.trim();
    return /^[+\d][\d\s-]+$/.test(valor) ? valor.replace(/[\s-]/g, '') : valor.toLowerCase();
  }

  // 2) Llave Bre-B, aunque el OCR haya perdido o cambiado la arroba.
  const breB = texto.match(LLAVE_BRE_B);
  if (breB) {
    const digitos = breB[2].replace(/[\s-]/g, '');
    if (digitos.length >= 10) return `@${breB[1]}${digitos}`;
  }

  // 3) Llave con arroba bien leída.
  const arroba = texto.match(/@[A-Za-z][\w.-]{3,30}/)?.[0];
  if (arroba) return arroba;

  // 4) Correo, descartando los de soporte del banco.
  const correo = [...texto.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g)]
    .map((m) => m[0].toLowerCase())
    .find((c) => !CORREOS_IGNORADOS.test(c));
  if (correo) return correo;

  // 5) Celular colombiano suelto (puede venir pegado a letras).
  return texto.match(/(?<!\d)3\d{9}(?!\d)/)?.[0] ?? null;
}

// ------------------------------------------------------------
//  Fecha
// ------------------------------------------------------------

function extraerFecha(texto) {
  const hora = texto.match(/\b(\d{1,2}):(\d{2})\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/i);
  let horas = hora ? Number(hora[1]) : 12;
  const minutos = hora ? Number(hora[2]) : 0;
  const sufijo = hora?.[3] ? sinTildes(hora[3]).replace(/[.\s]/g, '') : null;
  if (sufijo === 'pm' && horas < 12) horas += 12;
  if (sufijo === 'am' && horas === 12) horas = 0;

  // 15 sep. 2026  /  15 de septiembre de 2026
  const conMes = texto.match(/\b(\d{1,2})\s*(?:de\s*)?([a-záéíóú]{3,10})\.?\s*(?:de\s*)?(\d{4})\b/i);
  if (conMes) {
    const mes = MESES[sinTildes(conMes[2]).replace('.', '')];
    if (mes !== undefined) {
      return new Date(Number(conMes[3]), mes, Number(conMes[1]), horas, minutos);
    }
  }

  // 2026-09-15
  const iso = texto.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), horas, minutos);
  }

  // 15/09/2026  o  15-09-26
  const numerica = texto.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (numerica) {
    const anio = Number(numerica[3]);
    return new Date(
      anio < 100 ? 2000 + anio : anio,
      Number(numerica[2]) - 1,
      Number(numerica[1]),
      horas,
      minutos,
    );
  }

  return null;
}

// ------------------------------------------------------------
//  API pública
// ------------------------------------------------------------

/**
 * Analiza el texto de un comprobante y devuelve los campos detectados.
 * @param {string} textoCrudo texto reconocido por OCR o por un modelo de visión
 */
export function analizarTexto(textoCrudo) {
  const texto = corregirLlaves(corregirCorreos(limpiar(textoCrudo ?? '')));
  const fecha = extraerFecha(texto);

  const bancoDestino = extraerBanco(texto, [
    'banco de destino',
    'banco destino',
    'destino',
    'entidad destino',
    'hacia',
    'para',
    'envia(?:ste|do) a',
  ]);

  const bancoOrigen =
    extraerBanco(texto, ['banco de origen', 'origen', 'desde', 'cuenta origen']) ??
    bancoMencionado(texto, bancoDestino);

  return {
    numeroTransaccion: extraerTransaccion(texto),
    valorEnviado: extraerValor(texto),
    bancoOrigen,
    bancoDestino,
    llaveDestino: extraerLlave(texto),
    fechaTransaccion: fecha && !Number.isNaN(fecha.getTime()) ? fecha.toISOString() : null,
  };
}

export { aNumero, sinTildes };
