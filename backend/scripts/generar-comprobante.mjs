/**
 * Genera comprobantes de prueba sintéticos (estilo Nequi / Bancolombia)
 * para verificar el OCR y el parser sin depender de capturas reales.
 *
 * Uso: node scripts/generar-comprobante.mjs <carpeta-salida>
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const destino = process.argv[2] ?? '/tmp/comprobantes';
fs.mkdirSync(destino, { recursive: true });

const plantillas = [
  {
    nombre: 'nequi-valido.png',
    titulo: 'Nequi',
    lineas: [
      ['¡Envío exitoso!', 28, 'bold'],
      ['$ 400.000', 46, 'bold'],
      ['', 10, ''],
      ['Número de transacción', 18, ''],
      ['M8765432109', 24, 'bold'],
      ['', 10, ''],
      ['Banco de origen', 18, ''],
      ['Nequi', 24, 'bold'],
      ['', 10, ''],
      ['Banco de destino', 18, ''],
      ['Bancolombia', 24, 'bold'],
      ['', 10, ''],
      ['Llave destino', 18, ''],
      ['@Plata3143817689', 22, 'bold'],
      ['', 10, ''],
      ['Fecha y hora', 18, ''],
      ['15 sep. 2026 - 10:24 a. m.', 22, 'bold'],
    ],
  },
  {
    nombre: 'nequi-llave-ajena.png',
    titulo: 'Nequi',
    lineas: [
      ['¡Envío exitoso!', 28, 'bold'],
      ['Valor enviado $ 195.000', 32, 'bold'],
      ['', 10, ''],
      ['Número de comprobante: M1112223334', 22, ''],
      ['Banco de origen: Daviplata', 22, ''],
      ['Banco de destino: Nequi', 22, ''],
      ['Llave destino: otracuenta@gmail.com', 22, ''],
      ['Fecha: 20/09/2026 3:15 p. m.', 22, ''],
    ],
  },
  {
    nombre: 'nequi-abono.png',
    titulo: 'Nequi',
    lineas: [
      ['¡Envío exitoso!', 28, 'bold'],
      ['$ 140.000', 46, 'bold'],
      ['', 10, ''],
      ['Número de transacción', 18, ''],
      ['M5544332211', 24, 'bold'],
      ['', 10, ''],
      ['Banco de origen', 18, ''],
      ['Daviplata', 24, 'bold'],
      ['', 10, ''],
      ['Llave destino', 18, ''],
      ['@Plata3143817689', 22, 'bold'],
      ['', 10, ''],
      ['Fecha y hora', 18, ''],
      ['22 sep. 2026 - 8:05 p. m.', 22, 'bold'],
    ],
  },
];

for (const plantilla of plantillas) {
  let y = 70;
  const cuerpo = plantilla.lineas
    .map(([texto, tamano, peso]) => {
      if (!texto) {
        y += tamano;
        return '';
      }
      y += tamano + 12;
      const escapado = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return `<text x="40" y="${y}" font-family="Helvetica, Arial" font-size="${tamano}" font-weight="${peso || 'normal'}" fill="#111">${escapado}</text>`;
    })
    .join('\n');

  const alto = y + 60;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${alto}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <rect x="0" y="0" width="100%" height="56" fill="#20044a"/>
    <text x="40" y="38" font-family="Helvetica, Arial" font-size="26" font-weight="bold" fill="#ffffff">${plantilla.titulo}</text>
    ${cuerpo}
  </svg>`;

  const salida = path.join(destino, plantilla.nombre);
  await sharp(Buffer.from(svg)).png().toFile(salida);
  console.log(`generado ${salida}`);
}
