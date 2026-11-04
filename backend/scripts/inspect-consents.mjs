import 'dotenv/config';
import { query } from '../src/db.js';

async function main() {
  const counts = await Promise.all([
    query('SELECT COUNT(*)::int AS n FROM documentos_consentimiento'),
    query('SELECT COUNT(*)::int AS n FROM consentimientos_menores'),
    query('SELECT COUNT(*)::int AS n FROM personas'),
    query('SELECT COUNT(*)::int AS n FROM inscripciones'),
  ]);
  console.log('documentos_consentimiento:', counts[0][0].n);
  console.log('consentimientos_menores:', counts[1][0].n);
  console.log('personas:', counts[2][0].n);
  console.log('inscripciones:', counts[3][0].n);

  const docs = await query('SELECT * FROM documentos_consentimiento ORDER BY id');
  console.log('DOCS:', JSON.stringify(docs, null, 2));

  const consents = await query('SELECT * FROM consentimientos_menores ORDER BY id');
  console.log('CONSENTS count:', consents.length);
  for (const c of consents) {
    console.log('CONSENT:', JSON.stringify({ ...c, firma_base64: c.firma_base64 ? c.firma_base64.slice(0, 80) + '...' : null }, null, 2));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });