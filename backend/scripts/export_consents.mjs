import 'dotenv/config';
import { query } from '../src/db.js';
import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const consents = await query(`
    SELECT c.*, p.nombre_completo AS menor_nombre, p.tipo_documento AS menor_tipo_doc,
           p.documento AS menor_documento, p.fecha_nacimiento AS menor_fecha_nac,
           p.edad AS menor_edad, p.sexo AS menor_sexo
      FROM consentimientos_menores c
      JOIN personas p ON p.id = c.persona_id
     ORDER BY c.id
  `);
  await fs.mkdir('consentimientos_export', { recursive: true });
  // Save each signature as PNG and a JSON with data
  const manifest = [];
  for (const c of consents) {
    const sig = c.firma_base64;
    let sigFile = null;
    if (sig) {
      const m = sig.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (m) {
        const ext = m[1].split('/')[1].replace('jpeg','jpg');
        sigFile = `firma_${c.id}.png`;
        await fs.writeFile(path.join('consentimientos_export', sigFile), Buffer.from(m[2], 'base64'));
      }
    }
    manifest.push({
      id: c.id,
      persona_id: c.persona_id,
      menor_nombre: c.menor_nombre,
      menor_tipo_doc: c.menor_tipo_doc,
      menor_documento: c.menor_documento,
      menor_fecha_nac: c.menor_fecha_nac,
      menor_edad: c.menor_edad,
      menor_sexo: c.menor_sexo,
      departamento_municipio: c.departamento_municipio,
      fecha_diligenciamiento: c.fecha_diligenciamiento,
      nombre_representante: c.nombre_representante,
      tipo_documento_rep: c.tipo_documento_rep,
      documento_representante: c.documento_representante,
      congregacion: c.congregacion,
      destino: c.destino,
      telefono_emergencia: c.telefono_emergencia,
      acepta_consentimiento: c.acepta_consentimiento,
      documento_id: c.documento_id,
      firma_archivo: sigFile,
    });
  }
  await fs.writeFile('consentimientos_export/manifest.json', JSON.stringify(manifest, null, 2));
  console.log('exported', manifest.length, 'consents');
  // Also fetch associated document if any
  const docs = await query('SELECT * FROM documentos_consentimiento');
  for (const d of docs) {
    console.log('doc', d.id, d.archivo_nombre, d.archivo_ruta, d.archivo_mime);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
