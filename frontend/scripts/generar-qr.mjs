#!/usr/bin/env node
/**
 * Genera el QR de pago del campamento como SVG con estilo propio:
 * módulos redondeados, esquinas de localización en verde con centro lima,
 * degradado de marca y el glifo del campamento en el centro.
 *
 * Se usa corrección de errores alta (H, 30%) para que el logo central no
 * impida la lectura.
 *
 * Uso: node scripts/generar-qr.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

// Payload EMV de Bre-B (llave @plata3143817689).
const PAYLOAD =
  '00020101021126380014CO.COM.RBM.LLA0416@plata314381768949250014CO.COM.RBM.RED0103RBM50310013CO.COM.RBM.CU0110000000000051220013CO.COM.RBM.CA010105204000053031705802CO59010600106101062270710CC058456A4080200110363180270016CO.COM.RBM.CANAL0103APP81250015CO.COM.RBM.CIVA01020282260014CO.COM.RBM.IVA01040.0083270015CO.COM.RBM.BASE01040.0084250015CO.COM.RBM.CINC01020285260014CO.COM.RBM.INC01040.0090430016CO.COM.RBM.TRXID0119000000_AkX1Hao3_Y0Y91460014CO.COM.RBM.SEC0124HmOiwldpajXaQmIk++TUpXo663048156';

const SALIDA = path.resolve('public/img/pago/qr-pago.svg');

// --- Paleta de marca ---
const LIMA = '#c7ff3d';
const VERDE = '#173f32';
const VERDE_OSCURO = '#0a1a16';
const CREMA = '#ffffff';

const NIVEL = process.env.QR_ECC ?? 'M';
const qr = QRCode.create(PAYLOAD, { errorCorrectionLevel: NIVEL });
const tamano = qr.modules.size;
const datos = qr.modules.data;

const activo = (x, y) =>
  x >= 0 && y >= 0 && x < tamano && y < tamano && !!datos[y * tamano + x];

/** Las tres esquinas de localización se dibujan aparte, con su propio estilo. */
function esEsquina(x, y) {
  const enBloque = (ox, oy) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
  return enBloque(0, 0) || enBloque(tamano - 7, 0) || enBloque(0, tamano - 7);
}

/** Zona central reservada para el logo. */
const radioLogo = Math.floor(tamano * 0.06);
const centro = (tamano - 1) / 2;
const enLogo = (x, y) =>
  Math.abs(x - centro) <= radioLogo && Math.abs(y - centro) <= radioLogo;

// ------------------------------------------------------------
//  Módulos de datos: puntos redondeados que se unen entre vecinos
// ------------------------------------------------------------

const piezas = [];

for (let y = 0; y < tamano; y++) {
  for (let x = 0; x < tamano; x++) {
    if (!activo(x, y) || esEsquina(x, y) || enLogo(x, y)) continue;

    // El radio se reduce del lado donde hay un vecino, para que se vean
    // como trazos continuos en vez de puntos sueltos.
    const r = 0.42;
    const arriba = activo(x, y - 1) && !esEsquina(x, y - 1) && !enLogo(x, y - 1);
    const abajo = activo(x, y + 1) && !esEsquina(x, y + 1) && !enLogo(x, y + 1);
    const izq = activo(x - 1, y) && !esEsquina(x - 1, y) && !enLogo(x - 1, y);
    const der = activo(x + 1, y) && !esEsquina(x + 1, y) && !enLogo(x + 1, y);

    const ri = (a, b) => (a || b ? 0 : r);
    const rSupIzq = ri(arriba, izq);
    const rSupDer = ri(arriba, der);
    const rInfDer = ri(abajo, der);
    const rInfIzq = ri(abajo, izq);

    piezas.push(
      `M${x + rSupIzq} ${y}` +
        `H${x + 1 - rSupDer}${rSupDer ? `a${rSupDer} ${rSupDer} 0 0 1 ${rSupDer} ${rSupDer}` : ''}` +
        `V${y + 1 - rInfDer}${rInfDer ? `a${rInfDer} ${rInfDer} 0 0 1 -${rInfDer} ${rInfDer}` : ''}` +
        `H${x + rInfIzq}${rInfIzq ? `a${rInfIzq} ${rInfIzq} 0 0 1 -${rInfIzq} -${rInfIzq}` : ''}` +
        `V${y + rSupIzq}${rSupIzq ? `a${rSupIzq} ${rSupIzq} 0 0 1 ${rSupIzq} -${rSupIzq}` : ''}Z`,
    );
  }
}

// ------------------------------------------------------------
//  Esquinas de localización
//  Deben respetar la proporción 1:1:3:1:1 de oscuro/claro/oscuro y el
//  centro tiene que ser OSCURO: los lectores miden luminancia, así que
//  el lima (que es claro) no puede ir aquí. El estilo se logra con
//  esquinas redondeadas, que sí es seguro.
// ------------------------------------------------------------

function esquina(ox, oy) {
  return `
    <rect x="${ox}" y="${oy}" width="7" height="7" rx="2.3" fill="${VERDE}"/>
    <rect x="${ox + 1}" y="${oy + 1}" width="5" height="5" rx="1.6" fill="${CREMA}"/>
    <rect x="${ox + 2}" y="${oy + 2}" width="3" height="3" rx="1" fill="${VERDE_OSCURO}"/>`;
}

const esquinas = [
  esquina(0, 0),
  esquina(tamano - 7, 0),
  esquina(0, tamano - 7),
].join('');

// ------------------------------------------------------------
//  SVG final
// ------------------------------------------------------------

const margen = 4;
const lado = tamano + margen * 2;
const logo = radioLogo + 0.6;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}"
     width="512" height="512" role="img"
     aria-label="Código QR para pagar el campamento a la llave @plata3143817689">
  <title>Pago Campamento IPUC Bosque Popular</title>

  <defs>
    <!-- Degradado de marca para los módulos -->
    <linearGradient id="trazo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${VERDE}"/>
      <stop offset="55%" stop-color="${VERDE_OSCURO}"/>
      <stop offset="100%" stop-color="${VERDE}"/>
    </linearGradient>
    <linearGradient id="marco" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${LIMA}"/>
      <stop offset="100%" stop-color="#8fd41f"/>
    </linearGradient>
  </defs>

  <!-- Tarjeta: fondo claro para que cualquier lector funcione -->
  <rect width="${lado}" height="${lado}" rx="${margen + 1}" fill="${CREMA}"/>
  <rect x="0.6" y="0.6" width="${lado - 1.2}" height="${lado - 1.2}"
        rx="${margen + 0.6}" fill="none" stroke="url(#marco)" stroke-width="1.2"/>

  <g transform="translate(${margen} ${margen})">
    <!-- Módulos de datos -->
    <path fill="url(#trazo)" d="${piezas.join('')}"/>

    <!-- Esquinas de localización -->
    ${esquinas}

    <!-- Logo central: rombo oscuro con el glifo del campamento en lima -->
    <g transform="translate(${centro + 0.5} ${centro + 0.5})">
      <rect x="${-logo}" y="${-logo}" width="${logo * 2}" height="${logo * 2}"
            rx="${logo * 0.42}" fill="${CREMA}"/>
      <rect x="${-logo + 0.5}" y="${-logo + 0.5}" width="${logo * 2 - 1}" height="${logo * 2 - 1}"
            rx="${logo * 0.36}" fill="${VERDE}"/>
      <g transform="scale(${(logo * 1.5) / 32}) translate(-16 -16)"
         fill="none" stroke="${LIMA}" stroke-width="2.6"
         stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 26 16 7l12 19"/>
        <path d="M11 26 16 17l5 9"/>
      </g>
    </g>
  </g>
</svg>
`;

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, svg);

console.log(`QR generado: ${SALIDA}`);
console.log(`  versión ${qr.version} · ${tamano}x${tamano} módulos · corrección ${NIVEL}`);
console.log(`  ${piezas.length} módulos de datos dibujados`);
console.log(`  payload de ${PAYLOAD.length} caracteres`);
