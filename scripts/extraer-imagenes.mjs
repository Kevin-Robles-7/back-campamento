#!/usr/bin/env node
/**
 * Extrae las imágenes en base64 embebidas en un HTML y las guarda como
 * archivos sueltos, usando el atributo `alt` para nombrarlas.
 *
 * Uso: node scripts/extraer-imagenes.mjs <archivo.html> <carpeta-destino>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [entrada, destino] = process.argv.slice(2);

if (!entrada || !destino) {
  console.error('Uso: node extraer-imagenes.mjs <archivo.html> <carpeta-destino>');
  process.exit(1);
}

const html = fs.readFileSync(entrada, 'utf8');
fs.mkdirSync(destino, { recursive: true });

/** Convierte un texto a un nombre de archivo seguro. */
function aSlug(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Cada <img ...> completo, para poder leer src y alt juntos.
const etiquetas = html.match(/<img\b[^>]*>/gs) ?? [];
const hashes = new Set();
const usados = new Map();
let indice = 0;

for (const etiqueta of etiquetas) {
  const src = etiqueta.match(/src\s*=\s*"(data:image\/(\w+);base64,([^"]+))"/s);
  if (!src) continue;

  const extension = src[2] === 'jpeg' ? 'jpg' : src[2];
  const buffer = Buffer.from(src[3].replace(/\s/g, ''), 'base64');
  if (buffer.length < 5000) continue;

  const hash = crypto.createHash('sha1').update(buffer).digest('hex');
  if (hashes.has(hash)) continue;
  hashes.add(hash);

  const alt = etiqueta.match(/alt\s*=\s*"([^"]*)"/)?.[1] ?? '';
  const clase = etiqueta.match(/class\s*=\s*"([^"]*)"/)?.[1] ?? '';
  let base = aSlug(clase.includes('hero') ? 'hero' : alt) || `imagen-${++indice}`;

  const repetido = (usados.get(base) ?? 0) + 1;
  usados.set(base, repetido);
  const nombre = repetido > 1 ? `${base}-${repetido}.${extension}` : `${base}.${extension}`;

  fs.writeFileSync(path.join(destino, nombre), buffer);
  console.log(`${nombre.padEnd(28)} ${(buffer.length / 1024).toFixed(0)} kB`);
}

console.log(`\n${hashes.size} imágenes únicas extraídas en ${destino}`);
